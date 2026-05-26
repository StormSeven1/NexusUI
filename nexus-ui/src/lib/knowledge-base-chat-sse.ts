/**
 * watchsystem 数据库问答 SSE（`POST /api/v1/chat/react-agent`，stream: true）
 * 事件：type=step | final | done
 */

import { parseSseDataLine, splitLines } from "@/lib/langgraph-chat-sse";

export type DbQaSseEvent =
  | { type: "step"; content: string }
  | { type: "final"; content: string; convUid?: string }
  | { type: "done" };

export function parseDbQaSseEvent(obj: Record<string, unknown>): DbQaSseEvent | null {
  const type = String(obj.type ?? "").trim();
  if (type === "done") return { type: "done" };
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

export async function forEachDbQaSseLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (ev: DbQaSseEvent) => void | Promise<void>,
): Promise<void> {
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const { lines, rest } = splitLines(buf);
    buf = rest;
    for (const raw of lines) {
      const line = raw.replace(/\r$/, "").trim();
      if (!line) continue;
      const parsed = parseSseDataLine(line);
      if (!parsed) continue;
      const ev = parseDbQaSseEvent(parsed);
      if (ev) await onEvent(ev);
    }
  }
  const tail = buf.replace(/\r$/, "").trim();
  if (tail) {
    const parsed = parseSseDataLine(tail);
    if (parsed) {
      const ev = parseDbQaSseEvent(parsed);
      if (ev) await onEvent(ev);
    }
  }
}
