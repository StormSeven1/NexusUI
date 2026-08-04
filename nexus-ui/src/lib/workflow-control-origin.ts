/**
 * 工作流 terminate / stop-capture 上游选择。
 * 知识库模式会话建在 WatchSystemDbQa；智能助手建在任务管理——必须打到建流那一侧。
 */
import { resolveKnowledgeBaseChatOrigin } from "@/lib/knowledge-base-chat-url";
import { resolveTaskManagementOrigin } from "@/lib/task-management-url";

export type WorkflowControlSource = "assistant" | "knowledge-base";

export function resolveWorkflowControlOrigin(source: WorkflowControlSource): string {
  if (source === "knowledge-base") {
    return resolveKnowledgeBaseChatOrigin();
  }
  return resolveTaskManagementOrigin();
}

/** 首选 source，另一侧作回退（避免切模式后 terminate 打错主机） */
export function resolveWorkflowControlOriginsInOrder(
  source: WorkflowControlSource,
): string[] {
  const primary = resolveWorkflowControlOrigin(source);
  const fallback =
    source === "knowledge-base"
      ? resolveTaskManagementOrigin()
      : resolveKnowledgeBaseChatOrigin();
  if (primary === fallback) return [primary];
  return [primary, fallback];
}

export function parseWorkflowControlSource(raw: unknown): WorkflowControlSource {
  return String(raw ?? "").trim() === "knowledge-base" ? "knowledge-base" : "assistant";
}

export function isWorkflowNotFoundPayload(text: string): boolean {
  if (!text) return false;
  if (/未找到对应的工作流/.test(text)) return true;
  try {
    const j = JSON.parse(text) as { success?: boolean; message?: string };
    if (j.success === false && /未找到/.test(String(j.message ?? ""))) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** 上游 HTTP 成功但 body.success===false 时视为失败 */
export function isUpstreamTerminateSuccess(httpOk: boolean, bodyText: string): boolean {
  if (!httpOk) return false;
  if (!bodyText.trim()) return true;
  try {
    const j = JSON.parse(bodyText) as { success?: boolean };
    if (j.success === false) return false;
  } catch {
    /* 非 JSON 且 HTTP ok → 视为成功 */
  }
  return true;
}
