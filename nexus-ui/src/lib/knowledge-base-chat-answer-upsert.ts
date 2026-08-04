/**
 * 知识库 / 快照型 `chat_answer` 适配（见 chat_stream_external_platform_ai_implementation_guide.md）。
 * 同一 `answer_id` 的 content 是完整快照 → 必须替换，禁止追加。
 */

export type ChatAnswerSnapshotStatus = "running" | "completed" | "failed" | "cancelled" | string;

export type ChatAnswerSnapshot = {
  answerId: string;
  route: string;
  status: ChatAnswerSnapshotStatus;
  content: string;
  display: string;
  payload?: Record<string, unknown>;
  threadId?: string;
};

export type ChatAnswerUpsertAction = {
  kind: "set_content";
  answerId: string;
  content: string;
  status: ChatAnswerSnapshotStatus;
  terminal: boolean;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 知识库问答等「多帧 running 快照」路由 */
export function isKnowledgeQaSnapshotRoute(route: string): boolean {
  const r = route.trim().toLowerCase();
  if (!r) return false;
  if (r === "knowledge_qa_placeholder") return true;
  if (r.startsWith("knowledge_qa")) return true;
  if (r === "knowledge_base" || r === "knowledge") return true;
  return false;
}

/**
 * 是否应按 answer_id 做快照替换。
 * - 知识库问答路由：始终替换
 * - 其它路由：仅当本流已见过该 answer_id（避免误伤单次 completed 指令终态）
 */
export function shouldUpsertChatAnswerSnapshot(
  data: Record<string, unknown>,
  seenAnswerIds: ReadonlySet<string>,
): boolean {
  const answerId =
    typeof data.answer_id === "string" && data.answer_id.trim() ? data.answer_id.trim() : "";
  if (!answerId) return false;
  const route = typeof data.route === "string" ? data.route : "";
  if (isKnowledgeQaSnapshotRoute(route)) return true;
  if (seenAnswerIds.has(answerId)) return true;
  const status = String(data.status ?? "")
    .trim()
    .toLowerCase();
  // 首帧即为 running：按快照流处理
  return status === "running";
}

export function parseChatAnswerSnapshot(
  envelope: Record<string, unknown>,
  data: Record<string, unknown>,
): ChatAnswerSnapshot | null {
  const answerId =
    typeof data.answer_id === "string" && data.answer_id.trim() ? data.answer_id.trim() : "";
  if (!answerId) return null;

  const content = typeof data.content === "string" ? data.content : "";
  const statusRaw = typeof data.status === "string" ? data.status.trim() : "running";
  const route = typeof data.route === "string" ? data.route.trim() : "";
  const display = typeof data.display === "string" ? data.display.trim() : "markdown";
  const payload = asRecord(data.payload) ?? undefined;
  const threadRaw = envelope.thread_id ?? data.thread_id;
  const threadId =
    typeof threadRaw === "string" && threadRaw.trim() ? threadRaw.trim() : undefined;

  return {
    answerId,
    route,
    status: statusRaw || "running",
    content,
    display,
    payload,
    threadId,
  };
}

export function isChatAnswerTerminalStatus(status: string): boolean {
  const s = status.trim().toLowerCase();
  return s === "completed" || s === "failed" || s === "cancelled";
}

/** 快照替换：content 全量覆盖，不追加 */
export function applyChatAnswerSnapshot(snapshot: ChatAnswerSnapshot): ChatAnswerUpsertAction {
  return {
    kind: "set_content",
    answerId: snapshot.answerId,
    content: snapshot.content ?? "",
    status: snapshot.status,
    terminal: isChatAnswerTerminalStatus(String(snapshot.status)),
  };
}
