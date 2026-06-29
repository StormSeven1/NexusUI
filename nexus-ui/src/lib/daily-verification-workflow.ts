import {
  CameraManagementClient,
  defaultSeaOwnerEntityId,
  defaultSkyOwnerEntityId,
} from "@/lib/camera-management-client";
import { getHttpChatConfig, type CameraManagementConfig } from "@/lib/map-app-config";
import {
  resolveQuickWorkflowPostUrl,
  resolveQuickWorkflowStopDailyUrl,
  resolveQuickWorkflowTerminateRequest,
} from "@/lib/quick-workflow-client";
import { useAssistantChatTabsStore } from "@/stores/assistant-chat-tabs-store";

/** 与 Qt `ThreatListTable::sendDailyHandleTask` 工作流模式 1 一致：`threadid_yyyyMMddhhmmss` */
export function buildDailyVerificationThreadId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `threadid_${ts}`;
}

export type DailyVerificationStartResult =
  | { ok: true; threadId: string }
  | { ok: false; error: string };

/**
 * 启动日常查证：POST `http.chat.quickWorkflowUrl`，载荷对齐 Qt `m_nWorkFlowMode == 1`。
 */
export async function startDailyVerificationWorkflow(args: {
  workflowId: string;
  schemaId: string;
  signal?: AbortSignal;
}): Promise<DailyVerificationStartResult> {
  const { quickWorkflowUrl, quickWorkflowTimeoutMs } = getHttpChatConfig();
  const upstreamUrl = quickWorkflowUrl?.trim();
  if (!upstreamUrl) {
    return { ok: false, error: "未配置 http.chat.quickWorkflowUrl" };
  }
  const url = resolveQuickWorkflowPostUrl(upstreamUrl);
  const schemaId = args.schemaId.trim();
  if (!schemaId) {
    return {
      ok: false,
      error: "未获取到激活告警方案 scheme_id（alarm_master_schemes.enabled=true）",
    };
  }
  const threadId = buildDailyVerificationThreadId();
  const body = {
    thread_id: threadId,
    workflow_id: args.workflowId.trim() || "auto_duty_workflow-quick-1",
    parameters: { schema_id: schemaId },
  };
  const ctrl = new AbortController();
  const to = window.setTimeout(() => ctrl.abort(), Math.max(3000, quickWorkflowTimeoutMs ?? 5000));
  if (args.signal) {
    if (args.signal.aborted) ctrl.abort();
    else args.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: t.slice(0, 240) || `HTTP ${res.status}` };
    }
    return { ok: true, threadId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  } finally {
    window.clearTimeout(to);
  }
}

/** 从助手 Tab 登记中收集可能的工作流 thread_id（含其它会话曾见过的） */
export function collectAssistantWorkflowThreadIds(): string[] {
  const tabs = useAssistantChatTabsStore.getState().tabs;
  const out = new Set<string>();
  for (const tab of tabs) {
    const tid = tab.langGraphThreadId?.trim();
    if (tid) out.add(tid);
  }
  return [...out];
}

export type StopDailyVerificationResult = {
  ok: boolean;
  terminated: string[];
  error?: string;
};

/**
 * 结束日常查证：查任务管理 `workflows/history` 中仍在运行的 `auto_duty_workflow`，
 * 并 terminate 全部相关 thread（与客户端是否本地启动无关）。
 */
export async function stopDailyVerificationWorkflow(args?: {
  localThreadIds?: string[];
  workflowName?: string;
}): Promise<StopDailyVerificationResult> {
  const localIds = new Set<string>();
  for (const id of args?.localThreadIds ?? []) {
    const tid = id.trim();
    if (tid) localIds.add(tid);
  }
  for (const tid of collectAssistantWorkflowThreadIds()) {
    localIds.add(tid);
  }

  const url = resolveQuickWorkflowStopDailyUrl();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadIds: [...localIds],
        workflowName: args?.workflowName?.trim() || "auto_duty_workflow",
      }),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as {
      terminated?: string[];
      error?: string;
      detail?: string;
    };
    if (!res.ok) {
      const err = json.error || json.detail || `HTTP ${res.status}`;
      return { ok: false, terminated: [], error: String(err).slice(0, 240) };
    }
    const terminated = Array.isArray(json.terminated)
      ? json.terminated.map((x) => String(x).trim()).filter(Boolean)
      : [];
    return { ok: true, terminated };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, terminated: [], error: msg };
  }
}

/** 对海/对空默认光电下发 CancelAllMetaTasks，尽快释放云台查证状态 */
export async function stopDailyVerificationCameras(cm: CameraManagementConfig): Promise<void> {
  const client = CameraManagementClient.fromConfig(cm);
  if (!client) return;
  const owners = [defaultSeaOwnerEntityId(cm), defaultSkyOwnerEntityId(cm)].filter(Boolean);
  for (const entityId of owners) {
    try {
      await client.cancelAllMetaTasks(entityId);
    } catch {
      /* 尽力停止 */
    }
  }
}

/** 结束日常查证：对每个 threadId POST terminate（遗留；优先用 `stopDailyVerificationWorkflow`） */
export async function terminateDailyVerificationThreads(threadIds: string[]): Promise<void> {
  const { quickWorkflowUrl } = getHttpChatConfig();
  const base = quickWorkflowUrl?.trim();
  if (!base || threadIds.length === 0) return;
  for (const id of threadIds) {
    const tid = id.trim();
    if (!tid) continue;
    const { url: termUrl, body: termBody } = resolveQuickWorkflowTerminateRequest(base, tid);
    if (!termUrl) continue;
    try {
      await fetch(termUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: termBody,
        cache: "no-store",
      });
    } catch {
      /* 尽力终止，不抛 */
    }
  }
}
