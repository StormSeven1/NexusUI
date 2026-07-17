/** 知识库 / 融控问答任务管理默认根地址（与融控地图指令对接说明一致） */
export const DEFAULT_KNOWLEDGE_BASE_CHAT_ORIGIN = "http://192.168.18.103:21914";

function readKnowledgeBaseUrlRaw(): string {
  return (
    process.env.NEXT_PUBLIC_NEXUS_KNOWLEDGE_BASE_URL?.trim() ||
    process.env.NEXUS_KNOWLEDGE_BASE_URL?.trim() ||
    ""
  );
}

/** 知识库问答 HTTP 根地址（无尾斜杠），默认 `http://192.168.18.103:21914` */
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
