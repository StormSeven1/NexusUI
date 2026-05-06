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
