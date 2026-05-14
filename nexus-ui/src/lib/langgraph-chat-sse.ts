/**
 * 解析 LangGraph 聊天流（与 Qt `GPTInterfaceWgt.cpp` 中 `data: ` 行 JSON 一致）：
 * 每行 `data: {...}`，`event` / `thread_id` / `data` 内 `message`、`text` 等。
 */

export function extractLangGraphDisplayChunks(obj: Record<string, unknown>): string[] {
  const out: string[] = [];
  const event = String(obj.event ?? "");
  if (event === "tool_call" || event === "interrupt") return out;
  /** Qt 端不在流式阶段把 workflow 进度文案写入对话；避免「命令执行成功流程监控完成…」类噪声 */
  if (event === "workflow_update") return out;

  if (typeof obj.content === "string" && obj.content.trim()) {
    out.push(obj.content.trim());
  }

  const data = obj.data;
  if (!data || typeof data !== "object") return out;

  const d = data as Record<string, unknown>;
  const msg = typeof d.message === "string" ? d.message : "";
  if (msg.trim()) out.push(msg.trim());
  for (const k of ["text", "answer", "delta", "content"]) {
    const v = d[k];
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  }
  return out;
}

/** 从缓冲区拆出完整行（\n），返回 { lines, rest } */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let rest = buffer;
  let idx: number;
  while ((idx = rest.indexOf("\n")) >= 0) {
    lines.push(rest.slice(0, idx));
    rest = rest.slice(idx + 1);
  }
  return { lines, rest };
}

export function parseSseDataLine(trimmed: string): Record<string, unknown> | null {
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    const o = JSON.parse(payload) as unknown;
    return o && typeof o === "object" ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 与 Qt `WorkflowInterruptDialog` + `GPTInterfaceWgt` 解析 `event == "interrupt"` 一致 */
export type LangGraphInterruptUiPayload = {
  message: string;
  interruptId: string;
  mainInterruptId: string;
  threadId: string;
  nodeName?: string;
};

export function parseLangGraphInterruptEvent(obj: Record<string, unknown>): LangGraphInterruptUiPayload | null {
  if (String(obj.event ?? "") !== "interrupt") return null;
  const threadRaw = obj.thread_id;
  const threadId =
    typeof threadRaw === "string" && threadRaw.trim() ? threadRaw.trim() : "";
  const data = obj.data;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const mainRaw = d.id;
  const mainInterruptId =
    typeof mainRaw === "string" && mainRaw.trim()
      ? mainRaw.trim()
      : mainRaw != null && String(mainRaw).trim()
        ? String(mainRaw).trim()
        : "";
  const nodes = d.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  const node0 = nodes[0];
  if (!node0 || typeof node0 !== "object") return null;
  const n = node0 as Record<string, unknown>;
  const msgRaw = n.message;
  const message =
    typeof msgRaw === "string" && msgRaw.trim()
      ? msgRaw.trim()
      : "工作流需要您确认后继续。";
  const iidRaw = n.interrupt_id;
  const interruptId =
    typeof iidRaw === "string" && iidRaw.trim()
      ? iidRaw.trim()
      : iidRaw != null && String(iidRaw).trim()
        ? String(iidRaw).trim()
        : "";
  const nn = n.node_name;
  const nodeName = typeof nn === "string" && nn.trim() ? nn.trim() : undefined;
  if (!interruptId || !mainInterruptId) return null;
  return { message, interruptId, mainInterruptId, threadId, nodeName };
}

/**
 * 消费 LangGraph SSE 流（与 `ChatPanelLangGraph` / Qt `readyRead` 按行处理一致）。
 */
export async function forEachLangGraphSseLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onParsed: (parsed: Record<string, unknown>) => void | Promise<void>,
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
      if (parsed) await onParsed(parsed);
    }
  }
  const tail = buf.replace(/\r$/, "").trim();
  if (tail) {
    const parsed = parseSseDataLine(tail);
    if (parsed) await onParsed(parsed);
  }
}
