"use client";

import { generateId } from "ai";
import type { FileUIPart, UIMessage } from "ai";
import {
  buildTaskStatusVerifyBannerMarkdown,
  formatTaskStatusAssistantMarkdown,
  taskStatusImageFilePart,
  taskStatusVerifySessionKey,
} from "@/lib/task-status-chat-format";
import {
  mergeVerifyJudgmentState,
  type TaskVerifyJudgmentState,
} from "@/lib/task-status-judgment-ui";
import type { TaskStatusChatPayload } from "@/lib/task-status-types";
import { resolveVerifyTargetIdFromPayload } from "@/lib/task-status-verify-target-id";
import { useAssistantPanelSessionStore } from "@/stores/assistant-panel-session-store";

/** 上游 JSON 偶发把 taskStatus/trackID 等打成字符串，与严格 `=== 4` 分支对齐 */
function normalizeTaskStatusPayload(raw: TaskStatusChatPayload): TaskStatusChatPayload {
  const ts = Number(raw.taskStatus);
  const _rawTrackID = Number(raw.trackID);
  const trackID =
    raw.trackID != null &&
    String(raw.trackID).trim() !== "" &&
    Number.isFinite(_rawTrackID) &&
    _rawTrackID > 0
      ? _rawTrackID
      : undefined;
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
    trackID,
    verifyTargetId,
    uniqueId: verifyTargetId ?? raw.uniqueId,
    entityId: entityId || undefined,
    cameraIndex,
    alarmId: String(raw.alarmId ?? "").trim(),
  };
}

function rewriteVerifyAssistantBubble(
  assistantId: string,
  banner: string,
  judgment: TaskVerifyJudgmentState,
  extraImage?: FileUIPart | null,
) {
  const patchMessages = useAssistantPanelSessionStore.getState().patchMessages;
  const jt = judgment.body?.trim() ?? "";
  patchMessages("chat", (msgs) =>
    msgs.map((msg) => {
      if (msg.id !== assistantId) return msg;
      const existingFiles = msg.parts.filter((p) => p.type === "file") as FileUIPart[];
      const seen = new Set(existingFiles.map((f) => f.url));
      const extra: FileUIPart[] =
        extraImage && !seen.has(extraImage.url) ? [extraImage] : [];
      const parts: UIMessage["parts"] = [{ type: "text", text: banner }, ...existingFiles, ...extra];
      if (jt) parts.push({ type: "text", text: judgment.body });
      return { ...msg, parts };
    }),
  );
}

/** 查证助手会话：`trackId_entityId`（优先）或 `trackId_cameraIndex` */
const verifySessionByKey = new Map<string, string>();
const verifyFourBubbleIds = new Set<string>();
const verifyBannerByBubbleId = new Map<string, string>();
const judgmentStateByBubbleId = new Map<string, TaskVerifyJudgmentState>();

/** 清空查证会话索引（与 ChatPanel「清空」一致） */
export function clearTaskStatusVerifyChatSession(): void {
  verifySessionByKey.clear();
  verifyFourBubbleIds.clear();
  verifyBannerByBubbleId.clear();
  judgmentStateByBubbleId.clear();
}

/**
 * 将相机查证 taskStatus 写入智能助手会话（不切换右侧面板）。
 * 由 `TaskStatusVerifyChatHost` 常驻订阅；ChatPanel 仅负责展示。
 */
export function ingestTaskStatusChatPayload(raw: TaskStatusChatPayload): void {
  try {
    const payload = normalizeTaskStatusPayload(raw);
    const sessionKey = taskStatusVerifySessionKey(
      payload.verifyTargetId ?? payload.uniqueId ?? payload.trackID ?? undefined,
      {
        entityId: payload.entityId,
        cameraIndex: payload.cameraIndex,
      },
    );
    const patchMessages = useAssistantPanelSessionStore.getState().patchMessages;
    const ts = payload.taskStatus;

    if (sessionKey && ts === 4) {
      const banner = buildTaskStatusVerifyBannerMarkdown(payload);
      const img = taskStatusImageFilePart(payload);
      const reuseId = verifySessionByKey.get(sessionKey);
      const fromTargetInfo = reuseId ? verifyFourBubbleIds.has(reuseId) : false;

      if (reuseId && !fromTargetInfo) {
        verifyFourBubbleIds.add(reuseId);
        verifyBannerByBubbleId.set(reuseId, banner);
        const jst = judgmentStateByBubbleId.get(reuseId) ?? { introShown: false, body: "" };
        judgmentStateByBubbleId.set(reuseId, jst);
        rewriteVerifyAssistantBubble(reuseId, banner, jst, img);
        return;
      }

      const asstId = generateId();
      verifySessionByKey.set(sessionKey, asstId);
      verifyFourBubbleIds.add(asstId);
      verifyBannerByBubbleId.set(asstId, banner);
      judgmentStateByBubbleId.set(asstId, { introShown: false, body: "" });
      const parts: UIMessage["parts"] = [{ type: "text", text: banner }];
      if (img) parts.push(img);
      patchMessages("chat", (m) => [...m, { id: asstId, role: "assistant", parts }]);
      return;
    }

    if (sessionKey && (ts === 5 || ts === 6 || ts === 7)) {
      const img = taskStatusImageFilePart(payload);
      let bubbleId = verifySessionByKey.get(sessionKey);
      if (!bubbleId) {
        bubbleId = generateId();
        verifySessionByKey.set(sessionKey, bubbleId);
        const fb = buildTaskStatusVerifyBannerMarkdown(payload);
        verifyBannerByBubbleId.set(bubbleId, fb);
        judgmentStateByBubbleId.set(bubbleId, { introShown: false, body: "" });
        patchMessages("chat", (m) => [
          ...m,
          { id: bubbleId!, role: "assistant", parts: [{ type: "text", text: fb }] },
        ]);
      }

      const banner = buildTaskStatusVerifyBannerMarkdown(payload);
      verifyBannerByBubbleId.set(bubbleId, banner);
      const merged = mergeVerifyJudgmentState(
        judgmentStateByBubbleId.get(bubbleId),
        payload.description ?? "",
      );
      judgmentStateByBubbleId.set(bubbleId, merged);
      rewriteVerifyAssistantBubble(bubbleId, banner, merged, img);
      return;
    }

    if (ts === 5 || ts === 6 || ts === 7) return;

    const text = formatTaskStatusAssistantMarkdown(payload);
    const asstId = generateId();
    const parts: UIMessage["parts"] = [{ type: "text", text }];
    const imgOther = taskStatusImageFilePart(payload);
    if (imgOther) parts.push(imgOther);
    patchMessages("chat", (m) => [...m, { id: asstId, role: "assistant", parts }]);
  } catch {
    /* ignore malformed */
  }
}
