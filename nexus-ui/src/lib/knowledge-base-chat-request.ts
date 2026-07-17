/**
 * 知识库问答请求体规范化（客户端 / 服务端代理共用）。
 * 上游为任务管理 `POST /api/v1/chat/stream`：`messages` / `thread_id` / `user_context` / `debug`。
 */

export function extractLastUserMessageText(body: Record<string, unknown>): string {
  const messages = body.messages;
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const item = messages[i];
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    if (String(m.role ?? "").trim().toLowerCase() !== "user") continue;
    const content = m.content;
    if (typeof content === "string" && content.trim()) return content.trim();
  }
  return "";
}

/** 转发前补齐 `messages`，去掉 react-agent 遗留字段 */
export function normalizeKnowledgeBaseUpstreamBody(bodyText: string): string {
  try {
    const o = JSON.parse(bodyText) as Record<string, unknown>;
    const text =
      extractLastUserMessageText(o) ||
      (typeof o.question === "string" && o.question.trim() ? o.question.trim() : "");
    if (text && (!Array.isArray(o.messages) || o.messages.length === 0)) {
      o.messages = [{ role: "user", content: text }];
    }
    delete o.question;
    delete o.stream;
    return JSON.stringify(o);
  } catch {
    return bodyText;
  }
}
