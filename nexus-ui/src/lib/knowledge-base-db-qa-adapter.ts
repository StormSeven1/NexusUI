/**
 * 知识库 `route === "db_qa"` 专用适配（见 external-platform-db-qa-sse-integration.md）。
 * 仅在 chat_answer 带 `payload.db_event_type`（或 raw.type）时启用；其它路由不受影响。
 */

export const DB_QA_PROGRESS_TEXT = "正在查询数据库问答服务...";
export const DB_QA_FAILURE_TEXT = "数据库问答未返回最终结果，请重试。";

export type DbQaStreamState = {
  answerBuffer: string;
  progressEmitted: boolean;
  finalSeen: boolean;
};

export type DbQaUpsertAction =
  | { kind: "noop" }
  | { kind: "set_content"; content: string; status: "running" | "completed" | "failed" };

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function createDbQaStreamState(): DbQaStreamState {
  return { answerBuffer: "", progressEmitted: false, finalSeen: false };
}

/** 仅当 route=db_qa 且事件带有 db_event_type（或 payload.raw.type） */
export function isDbQaRoutedChatAnswer(data: Record<string, unknown>): boolean {
  if (String(data.route ?? "").trim() !== "db_qa") return false;
  const payload = asRecord(data.payload);
  if (!payload) return false;
  if (typeof payload.db_event_type === "string" && payload.db_event_type.trim()) return true;
  const raw = asRecord(payload.raw);
  return typeof raw?.type === "string" && Boolean(String(raw.type).trim());
}

export function pickDbQaAnswerId(data: Record<string, unknown>): string {
  const id = data.answer_id;
  if (typeof id === "string" && id.trim()) return id.trim();
  return "_default";
}

export function resolveDbQaEventType(data: Record<string, unknown>): string {
  const payload = asRecord(data.payload);
  const fromPayload =
    typeof payload?.db_event_type === "string" ? payload.db_event_type.trim() : "";
  if (fromPayload) return fromPayload;
  const raw = asRecord(payload?.raw);
  const fromRaw = typeof raw?.type === "string" ? raw.type.trim() : "";
  if (fromRaw) return fromRaw;
  return typeof data.type === "string" ? data.type.trim() : "";
}

/** 原样取 content，不做 trim（避免 answer.delta 分片边界被改写） */
export function pickDbQaRawContent(data: Record<string, unknown>): string {
  if (typeof data.content === "string") return data.content;
  const payload = asRecord(data.payload);
  const raw = asRecord(payload?.raw);
  if (typeof raw?.content === "string") return raw.content;
  return "";
}

function hasDbQaError(data: Record<string, unknown>): boolean {
  if (data.error != null && data.error !== false && data.error !== "") return true;
  if (String(data.status ?? "").trim().toLowerCase() === "failed") return true;
  const payload = asRecord(data.payload);
  const raw = asRecord(payload?.raw);
  if (raw?.error != null && raw.error !== false && raw.error !== "") return true;
  return false;
}

/**
 * 处理一条已确认的 db_qa chat_answer。
 * 会就地更新 `state`；调用方应按返回动作原位 set 同一条助手消息。
 */
export function handleDbQaChatAnswerEvent(
  state: DbQaStreamState,
  data: Record<string, unknown>,
): DbQaUpsertAction {
  const eventType = resolveDbQaEventType(data);

  const emitProgressOnce = (): DbQaUpsertAction | null => {
    if (state.progressEmitted) return null;
    state.progressEmitted = true;
    return { kind: "set_content", content: DB_QA_PROGRESS_TEXT, status: "running" };
  };

  if (eventType.startsWith("step.")) {
    return emitProgressOnce() ?? { kind: "noop" };
  }

  if (eventType === "answer.delta") {
    if (!state.progressEmitted) state.progressEmitted = true;
    state.answerBuffer += pickDbQaRawContent(data);
    return { kind: "set_content", content: state.answerBuffer, status: "running" };
  }

  if (eventType === "answer.done") {
    // 禁止复用上一事件 content；继续等 final
    return { kind: "noop" };
  }

  if (eventType === "final") {
    if (!state.progressEmitted) state.progressEmitted = true;
    const content = pickDbQaRawContent(data) || state.answerBuffer;
    state.answerBuffer = content;
    state.finalSeen = true;
    return {
      kind: "set_content",
      content,
      status: hasDbQaError(data) ? "failed" : "completed",
    };
  }

  if (eventType === "done") {
    if (state.finalSeen) return { kind: "noop" };
    state.finalSeen = true;
    return {
      kind: "set_content",
      content: state.answerBuffer || DB_QA_FAILURE_TEXT,
      status: "failed",
    };
  }

  return emitProgressOnce() ?? { kind: "noop" };
}

/** SSE 结束仍未见 final 时，将占位消息标为失败（未进入过 db_qa 则 noop） */
export function finalizeDbQaStreamIfNeeded(state: DbQaStreamState): DbQaUpsertAction {
  if (!state.progressEmitted && !state.answerBuffer && !state.finalSeen) {
    return { kind: "noop" };
  }
  if (state.finalSeen) return { kind: "noop" };
  state.finalSeen = true;
  return {
    kind: "set_content",
    content: state.answerBuffer || DB_QA_FAILURE_TEXT,
    status: "failed",
  };
}
