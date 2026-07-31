/**
 * 知识库问答 SSE（融控任务管理 `/api/v1/chat/stream`）：
 * - `chat_answer` / `interrupt` / `map_command` / `error`
 * - 工作流类事件（`workflow_update` / `message_chunk` / `chat_notification`）与智能助手共用
 *   `consumeLangGraphSseStream` 消费；本模块仍提供 interrupt / map_command 解析与兼容旧事件。
 */

import { splitLines } from "@/lib/langgraph-chat-sse";

export type KnowledgeBaseChatAnswerPayload = {
  dispatched?: boolean;
  cancelled?: boolean;
  partial_success?: boolean;
  [key: string]: unknown;
};

export type KnowledgeBaseChatAnswerEvent = {
  type: "chat_answer";
  text: string;
  threadId?: string;
  status?: string;
  route?: string;
  payload?: KnowledgeBaseChatAnswerPayload;
  raw: Record<string, unknown>;
};

export type KnowledgeBaseInterruptOption = {
  label: string;
  value: string;
  type?: "select" | "text";
};

export type KnowledgeBaseInterruptNode = {
  node_name: string;
  message: string;
  interrupt_id: string;
  options: KnowledgeBaseInterruptOption[];
};

export type KnowledgeBasePendingInterrupt = {
  threadId: string;
  interruptId: string;
  nodes: KnowledgeBaseInterruptNode[];
};

export type KnowledgeBaseInterruptEvent = {
  type: "interrupt";
  pending: KnowledgeBasePendingInterrupt;
  raw: Record<string, unknown>;
};

export type KnowledgeBaseMapCommandEvent = {
  type: "map_command";
  command: TaskManagerMapCommand;
  raw: Record<string, unknown>;
};

export type KnowledgeBaseErrorEvent = {
  type: "error";
  message: string;
  raw: Record<string, unknown>;
};

export type KnowledgeBaseAnswerDeltaEvent = { type: "answer_delta"; content: string };
export type KnowledgeBaseAnswerDoneEvent = { type: "answer_done" };
export type KnowledgeBaseStepChunkEvent = { type: "step_chunk"; content: string };

export type KnowledgeBaseLegacyStepEvent = { type: "step"; content: string };
export type KnowledgeBaseLegacyFinalEvent = {
  type: "final";
  content: string;
  convUid?: string;
};
export type KnowledgeBaseLegacyDoneEvent = { type: "done" };

export type KnowledgeBaseSseEvent =
  | KnowledgeBaseChatAnswerEvent
  | KnowledgeBaseInterruptEvent
  | KnowledgeBaseMapCommandEvent
  | KnowledgeBaseErrorEvent
  | KnowledgeBaseAnswerDeltaEvent
  | KnowledgeBaseAnswerDoneEvent
  | KnowledgeBaseStepChunkEvent
  | KnowledgeBaseLegacyStepEvent
  | KnowledgeBaseLegacyFinalEvent
  | KnowledgeBaseLegacyDoneEvent;

export type TaskManagerMapCommand = {
  tool_name: string;
  arguments: Record<string, unknown>;
  expects_result?: boolean;
  argument_schema?: unknown;
};

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  const payload = raw.trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    const o = JSON.parse(payload) as unknown;
    return o && typeof o === "object" ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickTextFromChatAnswer(data: Record<string, unknown>): string {
  if (typeof data.content === "string" && data.content.trim()) return data.content.trim();
  if (typeof data.text === "string" && data.text.trim()) return data.text.trim();
  if (typeof data.answer === "string" && data.answer.trim()) return data.answer.trim();
  if (typeof data.message === "string" && data.message.trim()) return data.message.trim();

  const nested = asRecord(data.data);
  if (nested) {
    for (const k of ["content", "text", "answer", "message", "delta"]) {
      const v = nested[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "";
}

function pickChatAnswerInner(data: Record<string, unknown>): Record<string, unknown> {
  return asRecord(data.data) ?? data;
}

function normalizeMapCommand(data: Record<string, unknown>): TaskManagerMapCommand | null {
  const payload = asRecord(data.data) ?? data;
  const mapCmd =
    asRecord(payload.map_command) ?? payload;
  const toolName = String(mapCmd.tool_name ?? mapCmd.command ?? "").trim();
  if (!toolName) return null;
  const argsRaw = mapCmd.arguments ?? mapCmd.params;
  const argumentsObj =
    argsRaw && typeof argsRaw === "object" && !Array.isArray(argsRaw)
      ? (argsRaw as Record<string, unknown>)
      : {};
  return {
    tool_name: toolName,
    arguments: argumentsObj,
    expects_result: mapCmd.expects_result === true,
    argument_schema: mapCmd.argument_schema,
  };
}

/** 从 SSE envelope（`event=map_command`）解析地图指令 */
export function parseTaskManagerMapCommandFromSse(
  envelope: Record<string, unknown>,
): TaskManagerMapCommand | null {
  if (String(envelope.event ?? "").trim().toLowerCase() !== "map_command") return null;
  return normalizeMapCommand(envelope);
}

function parseInterruptOption(raw: unknown): KnowledgeBaseInterruptOption | null {
  const o = asRecord(raw);
  if (!o) return null;
  const value = String(o.value ?? "").trim();
  if (!value) return null;
  const label = String(o.label ?? value).trim() || value;
  const typeRaw = String(o.type ?? "select").trim().toLowerCase();
  const type: "select" | "text" = typeRaw === "text" ? "text" : "select";
  return { label, value, type };
}

function parseInterruptNode(raw: unknown): KnowledgeBaseInterruptNode | null {
  const n = asRecord(raw);
  if (!n) return null;
  const interruptId = String(n.interrupt_id ?? "").trim();
  if (!interruptId) return null;
  const optionsRaw = Array.isArray(n.options) ? n.options : [];
  const options = optionsRaw
    .map(parseInterruptOption)
    .filter((x): x is KnowledgeBaseInterruptOption => x != null);
  if (options.length === 0) return null;
  const nodeName = String(n.node_name ?? "").trim() || interruptId;
  const message =
    (typeof n.message === "string" && n.message.trim()) ||
    `请选择：${nodeName}`;
  return {
    node_name: nodeName,
    message,
    interrupt_id: interruptId,
    options,
  };
}

export function parseKnowledgeBaseInterrupt(
  envelope: Record<string, unknown>,
): KnowledgeBasePendingInterrupt | null {
  const threadId = String(envelope.thread_id ?? "").trim();
  const data = asRecord(envelope.data);
  if (!threadId || !data) return null;
  const interruptId = String(data.id ?? "").trim();
  if (!interruptId) return null;
  const nodesRaw = Array.isArray(data.nodes) ? data.nodes : [];
  const nodes = nodesRaw
    .map(parseInterruptNode)
    .filter((x): x is KnowledgeBaseInterruptNode => x != null);
  if (nodes.length === 0) return null;
  return { threadId, interruptId, nodes };
}

/** 根据 chat_answer 的 status / payload 生成面向用户的补充说明（可为空） */
export function formatKnowledgeBaseChatAnswerSuffix(ev: KnowledgeBaseChatAnswerEvent): string {
  const payload = ev.payload ?? {};
  const status = (ev.status ?? "").trim().toLowerCase();
  const parts: string[] = [];

  if (payload.cancelled === true) {
    parts.push("已取消，未下发。");
  } else if (payload.dispatched === true) {
    parts.push("平台已接受下发（不等于设备动作已完成）。");
  } else if (payload.dispatched === false && status === "completed") {
    parts.push("未下发。");
  }

  if (payload.partial_success === true) {
    parts.push("部分子任务成功、部分失败（不会自动回滚已成功项）。");
  }

  if (status === "failed" && payload.partial_success !== true) {
    parts.push("执行失败。");
  }

  return parts.join(" ");
}

function parseReactAgentEvent(obj: Record<string, unknown>): KnowledgeBaseSseEvent | null {
  const type = String(obj.type ?? "").trim();
  if (type === "done") return { type: "done" };

  if (type === "answer.delta") {
    const content = typeof obj.content === "string" ? obj.content : "";
    if (content) return { type: "answer_delta", content };
    return null;
  }
  if (type === "answer.done") return { type: "answer_done" };

  if (type === "step.chunk") {
    const content = typeof obj.content === "string" ? obj.content : "";
    if (content) return { type: "step_chunk", content };
    return null;
  }

  if (type === "step.start" || type === "step.meta") {
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    const phase = typeof obj.phase === "string" ? obj.phase.trim() : "";
    const action = typeof obj.action === "string" ? obj.action.trim() : "";
    const hint = [phase, title, action].filter(Boolean).join(" · ");
    if (hint) return { type: "step_chunk", content: `▸ ${hint}\n` };
    return null;
  }

  const content = typeof obj.content === "string" ? obj.content : "";
  if (type === "step" && content) return { type: "step", content };
  if (type === "final") {
    const convRaw = obj.conv_uid ?? asRecord(obj.data)?.conv_uid;
    const convUid =
      typeof convRaw === "string" && convRaw.trim() ? convRaw.trim() : undefined;
    return { type: "final", content, convUid };
  }
  return null;
}

function parseNamedSseEvent(
  eventName: string,
  data: Record<string, unknown>,
): KnowledgeBaseSseEvent | null {
  const ev = eventName.trim().toLowerCase();

  if (ev === "chat_answer") {
    const inner = pickChatAnswerInner(data);
    const text = pickTextFromChatAnswer(data);
    const threadRaw = data.thread_id ?? inner.thread_id;
    const threadId =
      typeof threadRaw === "string" && threadRaw.trim() ? threadRaw.trim() : undefined;
    const status = typeof inner.status === "string" ? inner.status.trim() : undefined;
    const route = typeof inner.route === "string" ? inner.route.trim() : undefined;
    const payload = asRecord(inner.payload) ?? undefined;
    return {
      type: "chat_answer",
      text,
      threadId,
      status,
      route,
      payload: payload as KnowledgeBaseChatAnswerPayload | undefined,
      raw: data,
    };
  }

  if (ev === "interrupt") {
    const pending = parseKnowledgeBaseInterrupt(data);
    if (!pending) return null;
    return { type: "interrupt", pending, raw: data };
  }

  if (ev === "map_command") {
    const command = normalizeMapCommand(data);
    if (!command) return null;
    return { type: "map_command", command, raw: data };
  }

  if (ev === "error") {
    const inner = pickChatAnswerInner(data);
    const message =
      pickTextFromChatAnswer(data) ||
      (typeof inner.error === "string" ? inner.error.trim() : "") ||
      (typeof data.error === "string" ? data.error.trim() : "") ||
      "任务管理返回错误";
    return { type: "error", message, raw: data };
  }

  return null;
}

function parseSseBlock(block: string): KnowledgeBaseSseEvent | null {
  const lines = block.split("\n");
  let eventName = "";
  let dataLine = "";
  for (const line of lines) {
    const trimmed = line.replace(/\r$/, "");
    if (trimmed.startsWith("event:")) {
      eventName = trimmed.slice("event:".length).trim();
    } else if (trimmed.startsWith("data:")) {
      dataLine += (dataLine ? "\n" : "") + trimmed.slice("data:".length).trim();
    }
  }

  const parsed = dataLine ? parseJsonRecord(dataLine) : null;
  if (!parsed) return null;

  if (eventName) {
    const named = parseNamedSseEvent(eventName, parsed);
    if (named) return named;
  }

  const react = parseReactAgentEvent(parsed);
  if (react) return react;

  if (typeof parsed.event === "string") {
    const fromJsonEvent = parseNamedSseEvent(String(parsed.event), parsed);
    if (fromJsonEvent) return fromJsonEvent;
  }

  const fallbackText = pickTextFromChatAnswer(parsed);
  if (fallbackText) {
    return { type: "chat_answer", text: fallbackText, raw: parsed };
  }

  return null;
}

export async function forEachKnowledgeBaseSseEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (ev: KnowledgeBaseSseEvent) => void | Promise<void>,
): Promise<void> {
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });

    let sepIdx: number;
    while ((sepIdx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, sepIdx);
      buf = buf.slice(sepIdx + 2);
      const ev = parseSseBlock(block);
      if (ev) await onEvent(ev);
    }

    const { lines, rest } = splitLines(buf);
    buf = rest;
    for (const raw of lines) {
      const line = raw.replace(/\r$/, "").trim();
      if (!line.startsWith("data:")) continue;
      const parsed = parseJsonRecord(line.slice(5));
      if (!parsed) continue;
      const react = parseReactAgentEvent(parsed);
      if (react) {
        await onEvent(react);
        continue;
      }
      const fromJsonEvent =
        typeof parsed.event === "string" ? parseNamedSseEvent(String(parsed.event), parsed) : null;
      if (fromJsonEvent) await onEvent(fromJsonEvent);
    }
  }

  const tail = buf.trim();
  if (tail) {
    const ev = parseSseBlock(tail);
    if (ev) await onEvent(ev);
  }
}

/** @deprecated 使用 forEachKnowledgeBaseSseEvent */
export type DbQaSseEvent = KnowledgeBaseLegacyStepEvent | KnowledgeBaseLegacyFinalEvent | KnowledgeBaseLegacyDoneEvent;

/** @deprecated 使用 forEachKnowledgeBaseSseEvent */
export async function forEachDbQaSseLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (ev: DbQaSseEvent) => void | Promise<void>,
): Promise<void> {
  await forEachKnowledgeBaseSseEvent(reader, (ev) => {
    if (
      ev.type === "chat_answer" ||
      ev.type === "interrupt" ||
      ev.type === "map_command" ||
      ev.type === "error" ||
      ev.type === "answer_delta" ||
      ev.type === "answer_done" ||
      ev.type === "step_chunk"
    ) {
      return;
    }
    return onEvent(ev);
  });
}
