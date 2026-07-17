/**
 * 知识库问答 SSE：
 * - 任务管理 stream（21914）：`event: chat_answer` / `map_command`
 * - react-agent 5670 兼容：`answer.delta` / `final` / `step.*` / `done`
 * - 旧 DB-GPT：`type: step | final | done`
 */

import { splitLines } from "@/lib/langgraph-chat-sse";

export type KnowledgeBaseChatAnswerEvent = {
  type: "chat_answer";
  text: string;
  threadId?: string;
  raw: Record<string, unknown>;
};

export type KnowledgeBaseMapCommandEvent = {
  type: "map_command";
  command: TaskManagerMapCommand;
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
  | KnowledgeBaseMapCommandEvent
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

function pickTextFromChatAnswer(data: Record<string, unknown>): string {
  if (typeof data.content === "string" && data.content.trim()) return data.content.trim();
  if (typeof data.text === "string" && data.text.trim()) return data.text.trim();
  if (typeof data.answer === "string" && data.answer.trim()) return data.answer.trim();
  if (typeof data.message === "string" && data.message.trim()) return data.message.trim();

  const nested = data.data;
  if (nested && typeof nested === "object") {
    const d = nested as Record<string, unknown>;
    for (const k of ["content", "text", "answer", "message", "delta"]) {
      const v = d[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "";
}

function normalizeMapCommand(data: Record<string, unknown>): TaskManagerMapCommand | null {
  const payload =
    data.data && typeof data.data === "object" ? (data.data as Record<string, unknown>) : data;
  const mapCmd =
    payload.map_command && typeof payload.map_command === "object"
      ? (payload.map_command as Record<string, unknown>)
      : payload;
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
    const convRaw = obj.conv_uid ?? (obj.data as Record<string, unknown> | undefined)?.conv_uid;
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
    const text = pickTextFromChatAnswer(data);
    const threadRaw = data.thread_id ?? (data.data as Record<string, unknown> | undefined)?.thread_id;
    const threadId =
      typeof threadRaw === "string" && threadRaw.trim() ? threadRaw.trim() : undefined;
    return { type: "chat_answer", text, threadId, raw: data };
  }
  if (ev === "map_command") {
    const command = normalizeMapCommand(data);
    if (!command) return null;
    return { type: "map_command", command, raw: data };
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
      ev.type === "map_command" ||
      ev.type === "answer_delta" ||
      ev.type === "answer_done" ||
      ev.type === "step_chunk"
    ) {
      return;
    }
    return onEvent(ev);
  });
}
