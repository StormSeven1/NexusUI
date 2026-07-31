/**
 * 知识库问答上游根地址（与智能助手任务管理地址分离）。
 * - 对话：`/api/knowledge-base-chat` → 本地址
 * - 停止工作流：仍走 `NEXUS_TASK_MANAGEMENT_URL`（智能助手侧 terminate）
 */
export const DEFAULT_KNOWLEDGE_BASE_CHAT_ORIGIN = "http://192.168.18.103:21914";

function readKnowledgeBaseUrlRaw(): string {
  return (
    process.env.NEXT_PUBLIC_NEXUS_KNOWLEDGE_BASE_URL?.trim() ||
    process.env.NEXUS_KNOWLEDGE_BASE_URL?.trim() ||
    ""
  );
}

/**
 * 知识库问答 HTTP 根地址（无尾斜杠），默认 `http://192.168.18.103:21914`。
 * 优先显式 `NEXUS_KNOWLEDGE_BASE_URL`，否则 `WatchSystemDbQaIp`+`Port`。
 * 不回退到任务管理地址，避免知识库模式误打智能助手。
 */
export function resolveKnowledgeBaseChatOrigin(): string {
  const raw = readKnowledgeBaseUrlRaw();
  if (raw) {
    try {
      const withProto = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
      const u = new URL(withProto);
      return `${u.protocol}//${u.host}`;
    } catch {
      /* fall through */
    }
  }

  const ip =
    process.env.WatchSystemDbQaIp?.trim() ||
    process.env.WATCHSYSTEM_DB_QA_IP?.trim() ||
    "192.168.18.103";
  const portRaw =
    process.env.WatchSystemDbQaPort?.trim() ||
    process.env.WATCHSYSTEM_DB_QA_PORT?.trim() ||
    "21914";
  const port = /^\d+$/.test(portRaw) ? portRaw : "21914";
  return `http://${ip}:${port}`;
}

/** `POST {origin}/api/v1/chat/stream` */
export function resolveKnowledgeBaseChatStreamUrl(): string {
  return `${resolveKnowledgeBaseChatOrigin()}/api/v1/chat/stream`;
}
