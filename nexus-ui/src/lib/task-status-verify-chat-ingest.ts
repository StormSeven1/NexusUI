"use client";

import { generateId } from "ai";
import { formatTaskStatusAssistantMarkdown, taskStatusVerifySessionKey } from "@/lib/task-status-chat-format";
import type { TaskStatusChatPayload } from "@/lib/task-status-types";
import { resolveVerifyTargetIdFromPayload } from "@/lib/task-status-verify-target-id";
import {
  buildVerifyReportFromPayload,
  isVerifyJudgmentDescriptionFragment,
  mergeVerifyReportJudgment,
  verifyReportToMessagePart,
  type VerifyReportViewModel,
} from "@/lib/task-status-verify-report-model";
import {
  DUTY_CHAT_TAB_ID,
  useAssistantChatTabsStore,
} from "@/stores/assistant-chat-tabs-store";

function normalizeTaskStatusPayload(raw: TaskStatusChatPayload): TaskStatusChatPayload {
  const ts = Number(raw.taskStatus);
  const cameraIndex =
    raw.cameraIndex != null &&
    String(raw.cameraIndex).trim() !== "" &&
    Number.isFinite(Number(raw.cameraIndex))
      ? Number(raw.cameraIndex)
      : undefined;
  const entityId = typeof raw.entityId === "string" ? raw.entityId.trim() : "";
  const verifyTargetId = resolveVerifyTargetIdFromPayload(raw);
  return {
    ...raw,
    taskStatus: Number.isFinite(ts) ? ts : raw.taskStatus,
    verifyTargetId,
    uniqueId: verifyTargetId ?? raw.uniqueId,
    entityId: entityId || undefined,
    cameraIndex,
    alarmId: String(raw.alarmId ?? "").trim(),
  };
}

type TabVerifyState = {
  verifySessionByKey: Map<string, string>;
  verifyFourBubbleIds: Set<string>;
  reportByBubbleId: Map<string, VerifyReportViewModel>;
  judgmentFragmentsByBubbleId: Map<string, string[]>;
};

function emptyTabVerifyState(): TabVerifyState {
  return {
    verifySessionByKey: new Map(),
    verifyFourBubbleIds: new Set(),
    reportByBubbleId: new Map(),
    judgmentFragmentsByBubbleId: new Map(),
  };
}

const verifyStateByTab = new Map<string, TabVerifyState>();

function getTabVerifyState(tabId: string): TabVerifyState {
  let st = verifyStateByTab.get(tabId);
  if (!st) {
    st = emptyTabVerifyState();
    verifyStateByTab.set(tabId, st);
  }
  return st;
}

function rewriteVerifyAssistantBubble(tabId: string, assistantId: string, report: VerifyReportViewModel) {
  const patchTabMessages = useAssistantChatTabsStore.getState().patchTabMessages;
  patchTabMessages(tabId, (msgs) =>
    msgs.map((msg) => {
      if (msg.id !== assistantId) return msg;
      return {
        ...msg,
        parts: [verifyReportToMessagePart(report)],
      };
    }),
  );
}


/** 值班助手固定承接的 parentTaskId 前缀 */
const DUTY_ASSISTANT_VERIFY_PARENT_PREFIXES = [
  "auto_duty_workflow",
  /** 地图双击航迹 → TargetCollectionIMChildTask（与 camera-management-client taskKey 一致） */
  "alarm_im_collectoin_",
];

/** 查证消息是否固定进值班助手（日常 CameraVerification、地图双击 IM 查证等） */
export function isDailyVerificationParentTaskId(parentTaskId: string | undefined): boolean {
  const t = parentTaskId?.trim().toLowerCase();
  if (!t) return true;
  return DUTY_ASSISTANT_VERIFY_PARENT_PREFIXES.some((p) => t.startsWith(p));
}

/** 相机 parentTaskId 尚未匹配到 chat_notification thread_id 时暂存 */
const pendingVerifyByParentTaskId = new Map<string, TaskStatusChatPayload[]>();

/** LangGraph chat_notification 登记 thread_id → 工作流 Tab，并回放暂存查证 */
export function registerWorkflowVerifyThreadId(threadId: string, tabId: string): void {
  const tid = threadId.trim();
  if (!tid || !tabId) return;
  const store = useAssistantChatTabsStore.getState();
  store.registerTaskIdsForTab(tabId, [tid]);
  store.setTabBusinessWorkflowThreadId(tabId, tid);
  const pending = pendingVerifyByParentTaskId.get(tid);
  if (pending?.length) {
    pendingVerifyByParentTaskId.delete(tid);
    for (const p of pending) ingestTaskStatusChatPayload(p);
  }
}

function enqueuePendingVerify(payload: TaskStatusChatPayload, parentTaskId: string): void {
  const list = pendingVerifyByParentTaskId.get(parentTaskId) ?? [];
  list.push(payload);
  pendingVerifyByParentTaskId.set(parentTaskId, list);
}

function resolveVerifyParentTaskId(payload: TaskStatusChatPayload): string | undefined {
  const parent = payload.parentTaskId?.trim();
  return parent || undefined;
}

function buildPayloadSessionKey(payload: TaskStatusChatPayload): string | null {
  const targetId = resolveVerifyTargetIdFromPayload(payload);
  const base = taskStatusVerifySessionKey(targetId, {
    entityId: payload.entityId,
    cameraIndex: payload.cameraIndex,
  });
  if (!base) return null;
  const parentTaskId = resolveVerifyParentTaskId(payload);
  if (parentTaskId && !isDailyVerificationParentTaskId(parentTaskId)) {
    return `${parentTaskId}::${base}`;
  }
  return base;
}

/**
 * 查证 SSE 路由：
 * - auto_duty_workflow_* / alarm_im_collectoin_*（地图双击）→ 值班助手
 * - 其它 parentTaskId → 匹配 chat_notification 已登记的 thread_id；未登记则暂存
 */
function resolveIngestTabId(payload: TaskStatusChatPayload): string | null {
  const store = useAssistantChatTabsStore.getState();
  const parentTaskId = resolveVerifyParentTaskId(payload);

  if (!parentTaskId) {
    return DUTY_CHAT_TAB_ID;
  }

  if (isDailyVerificationParentTaskId(parentTaskId)) {
    return DUTY_CHAT_TAB_ID;
  }

  return store.resolveTabIdForTaskId(parentTaskId);
}

function reportHasJudgmentContent(
  tabVerify: TabVerifyState,
  bubbleId: string,
  report: VerifyReportViewModel,
): boolean {
  const frags = tabVerify.judgmentFragmentsByBubbleId.get(bubbleId) ?? [];
  if (frags.length > 0) return true;
  if (report.judgmentBasis?.trim()) return true;
  if (report.environment && Object.values(report.environment).some(Boolean)) return true;
  const tgt = report.target;
  if (
    tgt &&
    (tgt.name !== undefined ||
      Object.entries(tgt).some(([k, v]) => k !== "name" && Boolean(v)))
  ) {
    return true;
  }
  return false;
}

/** status5 的 target_id 偶发与 status4/7 不一致时，合并到同实体待研判气泡 */
function findBubbleAwaitingJudgment(tabVerify: TabVerifyState, entityId: string): string | null {
  const id = entityId.trim();
  if (!id) return null;
  let last: string | null = null;
  for (const [bubbleId, report] of tabVerify.reportByBubbleId) {
    if (report.entityId !== id) continue;
    if (!report.analyzing && !report.imageUrl) continue;
    if (reportHasJudgmentContent(tabVerify, bubbleId, report)) continue;
    last = bubbleId;
  }
  return last;
}

function resolveVerifyBubbleId(
  tabVerify: TabVerifyState,
  sessionKey: string | null,
  payload: TaskStatusChatPayload,
  ts: number,
): string | undefined {
  if (sessionKey) {
    const byKey = tabVerify.verifySessionByKey.get(sessionKey);
    if (byKey) return byKey;
  }
  if ((ts === 5 || ts === 6 || ts === 7 || ts === 8) && payload.entityId) {
    const pending = findBubbleAwaitingJudgment(tabVerify, payload.entityId);
    if (pending) {
      if (sessionKey) tabVerify.verifySessionByKey.set(sessionKey, pending);
      if (process.env.NODE_ENV === "development") {
        const expected = sessionKey ?? "(none)";
        console.warn("[task-status-verify-ingest] status", ts, "target_id 与图不一致，合并到待研判气泡", {
          entityId: payload.entityId,
          sessionKey: expected,
          bubbleId: pending,
          targetId: resolveVerifyTargetIdFromPayload(payload),
        });
      }
      return pending;
    }
  }
  return undefined;
}

function appendJudgmentFragment(tabVerify: TabVerifyState, bubbleId: string, fragment: string) {
  const f = fragment.trim();
  if (!f || !isVerifyJudgmentDescriptionFragment(f)) return;
  const prev = tabVerify.judgmentFragmentsByBubbleId.get(bubbleId) ?? [];
  tabVerify.judgmentFragmentsByBubbleId.set(bubbleId, [...prev, f]);
}

function buildReportForBubble(
  tabVerify: TabVerifyState,
  bubbleId: string,
  payload: TaskStatusChatPayload,
): VerifyReportViewModel {
  const base = buildVerifyReportFromPayload(payload);
  const prev = tabVerify.reportByBubbleId.get(bubbleId);
  const fragments = tabVerify.judgmentFragmentsByBubbleId.get(bubbleId) ?? [];
  let report: VerifyReportViewModel = {
    ...(prev ?? {}),
    ...base,
    imageUrl: base.imageUrl ?? prev?.imageUrl,
    imageMediaType: base.imageMediaType ?? prev?.imageMediaType,
    imageFileName: base.imageFileName ?? prev?.imageFileName,
    trackId: base.trackId ?? prev?.trackId,
    entityId: base.entityId ?? prev?.entityId,
    longitudeDeg: base.longitudeDeg ?? prev?.longitudeDeg,
    latitudeDeg: base.latitudeDeg ?? prev?.latitudeDeg,
    distanceNm: base.distanceNm ?? prev?.distanceNm,
    azimuthDegrees: base.azimuthDegrees ?? prev?.azimuthDegrees,
    speedMps: base.speedMps ?? prev?.speedMps,
    shipArchiveInfo: base.shipArchiveInfo ?? prev?.shipArchiveInfo,
    environment: prev?.environment,
    target: prev?.target,
    judgmentBasis: prev?.judgmentBasis,
    featureTarget: prev?.featureTarget,
    targetFound: prev?.targetFound,
    visitHistory: prev?.visitHistory,
    analyzing: payload.taskStatus === 4 ? true : prev?.analyzing ?? base.analyzing,
  };
  if (fragments.length > 0) {
    report = mergeVerifyReportJudgment(report, fragments);
  }
  if (payload.taskStatus === 4) {
    report.analyzing = true;
  } else if (payload.taskStatus === 5 || payload.taskStatus === 6 || payload.taskStatus === 7) {
    report.analyzing = false;
  }
  if (payload.taskStatus === 8) {
    const vh = payload.description?.trim();
    if (vh) report.visitHistory = vh;
  }
  tabVerify.reportByBubbleId.set(bubbleId, report);
  return report;
}

/** 清空查证会话索引（与 ChatPanel「清空」一致） */
export function clearTaskStatusVerifyChatSession(tabId?: string): void {
  if (tabId) {
    verifyStateByTab.delete(tabId);
    return;
  }
  verifyStateByTab.clear();
  pendingVerifyByParentTaskId.clear();
}

/** 清空全部 Tab 查证索引 */
export function clearAllTaskStatusVerifyChatSessions(): void {
  verifyStateByTab.clear();
  pendingVerifyByParentTaskId.clear();
}

/**
 * 将相机查证 taskStatus 写入智能助手对应会话 Tab。
 * 路由按 parentTaskId（工作流 thread_id）：日常 CameraVerification → 值班助手；其它 → 对应工作流会话。
 */
export function ingestTaskStatusChatPayload(raw: TaskStatusChatPayload): void {
  try {
    const payload = normalizeTaskStatusPayload(raw);
    const tabId = resolveIngestTabId(payload);
    if (tabId === null) {
      const parentTaskId = resolveVerifyParentTaskId(payload);
      if (parentTaskId) enqueuePendingVerify(payload, parentTaskId);
      return;
    }
    const sessionKey = buildPayloadSessionKey(payload);
    const tabVerify = getTabVerifyState(tabId);

    const patchTabMessages = useAssistantChatTabsStore.getState().patchTabMessages;
    const ts = payload.taskStatus;

    if (sessionKey && ts === 4) {
      const reuseId = tabVerify.verifySessionByKey.get(sessionKey);
      /** 同一 sessionKey 重复 status 4：复用气泡并更新图片，不新建 */
      if (reuseId) {
        tabVerify.verifyFourBubbleIds.add(reuseId);
        const report = buildReportForBubble(tabVerify, reuseId, payload);
        rewriteVerifyAssistantBubble(tabId, reuseId, report);
        return;
      }

      const asstId = generateId();
      tabVerify.verifySessionByKey.set(sessionKey, asstId);
      tabVerify.verifyFourBubbleIds.add(asstId);
      tabVerify.judgmentFragmentsByBubbleId.set(asstId, []);
      const report = buildReportForBubble(tabVerify, asstId, payload);
      patchTabMessages(tabId, (m) => [
        ...m,
        {
          id: asstId,
          role: "assistant",
          parts: [verifyReportToMessagePart(report)],
        },
      ]);
      return;
    }

    if (sessionKey && (ts === 5 || ts === 6 || ts === 7 || ts === 8)) {
      let bubbleId = resolveVerifyBubbleId(tabVerify, sessionKey, payload, ts);
      if (!bubbleId) {
        bubbleId = generateId();
        tabVerify.verifySessionByKey.set(sessionKey, bubbleId);
        tabVerify.judgmentFragmentsByBubbleId.set(bubbleId, []);
        const seed = buildReportForBubble(tabVerify, bubbleId, payload);
        patchTabMessages(tabId, (m) => [
          ...m,
          {
            id: bubbleId!,
            role: "assistant",
            parts: [verifyReportToMessagePart(seed)],
          },
        ]);
      } else if (!tabVerify.judgmentFragmentsByBubbleId.has(bubbleId)) {
        tabVerify.judgmentFragmentsByBubbleId.set(bubbleId, []);
      }

      if (ts === 8) {
        const report = buildReportForBubble(tabVerify, bubbleId, payload);
        rewriteVerifyAssistantBubble(tabId, bubbleId, report);
        return;
      }

      appendJudgmentFragment(tabVerify, bubbleId, payload.description ?? "");
      const report = buildReportForBubble(tabVerify, bubbleId, payload);
      rewriteVerifyAssistantBubble(tabId, bubbleId, report);
      return;
    }

    /** 与旧版一致：无 sessionKey 的 5/6/7/8 不单独落气泡，避免图/研判拆成两条 */
    if (ts === 5 || ts === 6 || ts === 7 || ts === 8) return;

    const text = formatTaskStatusAssistantMarkdown(payload);
    const asstId = generateId();
    patchTabMessages(tabId, (m) => [
      ...m,
      { id: asstId, role: "assistant", parts: [{ type: "text", text }] },
    ]);
  } catch {
    /* ignore malformed */
  }
}
