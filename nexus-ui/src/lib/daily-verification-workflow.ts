import { getHttpChatConfig } from "@/lib/map-app-config";

/** 与 Qt `ThreatListTable::sendDailyHandleTask` 工作流模式 1 一致：`threadid_yyyyMMddhhmmss` */
export function buildDailyVerificationThreadId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `threadid_${ts}`;
}

/**
 * 由 `quickWorkflowUrl`（…/quick-workflow）推导终止 URL，与 Qt
 * `http://{ip}:{port}/api/v1/chat/workflows/{threadId}/terminate` 一致。
 */
export function deriveQuickWorkflowTerminateUrl(quickWorkflowUrl: string, threadId: string): string {
  const base = quickWorkflowUrl.trim();
  if (!base) return "";
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    return "";
  }
  const path = u.pathname.replace(/\/?$/, "");
  const termPath = path.endsWith("/quick-workflow")
    ? `${path.slice(0, -"/quick-workflow".length)}/workflows/${encodeURIComponent(threadId)}/terminate`
    : `${path}/workflows/${encodeURIComponent(threadId)}/terminate`;
  return `${u.origin}${termPath}`;
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
  const url = quickWorkflowUrl?.trim();
  if (!url) {
    return { ok: false, error: "未配置 http.chat.quickWorkflowUrl" };
  }
  const schemaId = args.schemaId.trim();
  if (!schemaId) {
    return { ok: false, error: "未配置 http.chat.dailyVerificationSchemaId（对应 Qt 库中激活方案 ID）" };
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

/** 结束日常查证：对每个 threadId POST terminate（与 Qt `stopDailyHandleTask` 模式 1 一致） */
export async function terminateDailyVerificationThreads(threadIds: string[]): Promise<void> {
  const { quickWorkflowUrl } = getHttpChatConfig();
  const base = quickWorkflowUrl?.trim();
  if (!base || threadIds.length === 0) return;
  for (const id of threadIds) {
    const tid = id.trim();
    if (!tid) continue;
    const termUrl = deriveQuickWorkflowTerminateUrl(base, tid);
    if (!termUrl) continue;
    try {
      await fetch(termUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
      });
    } catch {
      /* 尽力终止，不抛 */
    }
  }
}
