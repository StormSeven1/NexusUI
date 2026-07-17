/**
 * 解析 LangGraph 聊天流（与 Qt `GPTInterfaceWgt.cpp` 中 `data: ` 行 JSON 一致）：
 * 每行 `data: {...}`，`event` / `thread_id` / `data` 内 `message`、`text` 等。
 */

import {
  logLangGraphChatSseEvent,
  type LangGraphChatHttpLogKind,
} from "@/lib/langgraph-chat-http-log";
import { extractVerifyEntityIdsFromInterrupt } from "@/lib/langgraph-interrupt-verify-entity";

function pushUnique(out: string[], text: string) {
  const t = text.trim();
  if (!t) return;
  if (out[out.length - 1] === t) return;
  if (out.includes(t)) return;
  out.push(t);
}

function collectDisplayStringsFromRecord(d: Record<string, unknown>, out: string[], depth = 0) {
  if (depth > 3) return;
  for (const k of [
    "message",
    "text",
    "answer",
    "delta",
    "content",
    "chunk",
    "error",
    "description",
    "title",
    "detail",
    "summary",
  ]) {
    const v = d[k];
    if (typeof v === "string") pushUnique(out, v);
  }
  // chat_notification.details 里也可能有中文说明
  const details = d.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    collectDisplayStringsFromRecord(details as Record<string, unknown>, out, depth + 1);
  }
}

/**
 * 从任意 LangGraph SSE 事件提取应写入智能助手气泡的中文/可读文案。
 * 覆盖：workflow_update / message_chunk / chat_notification 等。
 */
export function extractLangGraphDisplayChunks(obj: Record<string, unknown>): string[] {
  const out: string[] = [];
  const event = String(obj.event ?? "");
  if (event === "tool_call" || event === "interrupt") return out;

  if (typeof obj.content === "string") pushUnique(out, obj.content);

  const data = obj.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;

    if (event === "workflow_update") {
      const err = typeof d.error === "string" ? d.error.trim() : "";
      const msg = typeof d.message === "string" ? d.message.trim() : "";
      const status = typeof d.status === "string" ? d.status.trim() : "";
      const node =
        (typeof d.node === "string" && d.node.trim()) ||
        (typeof d.node_name === "string" && d.node_name.trim()) ||
        "";

      if (err) {
        pushUnique(out, `${status.toLowerCase() === "failed" ? "❌ " : ""}${err}`);
      } else if (msg) {
        pushUnique(out, msg);
      } else if (
        status &&
        !["running", "workflow_running", "started", "workflow_started"].includes(status.toLowerCase())
      ) {
        pushUnique(out, node ? `[${node}] ${status}` : status);
      }
      // workflow_started 仍有 message「开始工作流执行」时上面已取 msg
      return out;
    }

    collectDisplayStringsFromRecord(d, out);
  }

  return out;
}

/** @deprecated 使用 extractLangGraphDisplayChunks（已覆盖 workflow_update） */
export function extractLangGraphWorkflowUpdateMessage(obj: Record<string, unknown>): string | null {
  if (String(obj.event ?? "") !== "workflow_update") return null;
  const chunks = extractLangGraphDisplayChunks(obj);
  return chunks[0] ?? null;
}

/** 是否应在文案前加换行（进度/通知类）；message_chunk 为流式片段不加 */
export function shouldPrefixedNewlineForLangGraphEvent(event: string): boolean {
  const ev = event.toLowerCase();
  return (
    ev === "workflow_update" ||
    ev === "chat_notification" ||
    ev === "workflow_start" ||
    ev === "workflow_started" ||
    ev === "error"
  );
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

/** 上游可能发 [DONE] 或带 event 的结束帧；interrupt 需由调用方单独处理（不关流） */
export function isLangGraphSseTerminalEvent(obj: Record<string, unknown>): boolean {
  const ev = String(obj.event ?? "").toLowerCase();
  if (ev === "error" || ev === "done" || ev === "stream_end" || ev === "complete" || ev === "end") {
    return true;
  }
  const data = obj.data;
  if (data && typeof data === "object") {
    const st = String((data as Record<string, unknown>).status ?? "").toLowerCase();
    if (
      st === "completed" ||
      st === "failed" ||
      st === "workflow_completed" ||
      st === "done"
    ) {
      return true;
    }
  }
  return false;
}

/** 与 Qt `WorkflowInterruptDialog` + `GPTInterfaceWgt` 解析 `event == "interrupt"` 一致 */
export type LangGraphInterruptUiPayload = {
  message: string;
  interruptId: string;
  mainInterruptId: string;
  threadId: string;
  nodeName?: string;
  /** 弹窗确认后用于查证 SSE 路由（无人机管理软件常不带 taskID） */
  verifyEntityIds: string[];
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
  const verifyEntityIds = extractVerifyEntityIdsFromInterrupt(obj, message);
  return { message, interruptId, mainInterruptId, threadId, nodeName, verifyEntityIds };
}

export type LangGraphSseConsumeResult = {
  reason: "http_done" | "idle_timeout" | "terminal_event" | "interrupt" | "cancelled";
  eventCount: number;
};

export type ConsumeLangGraphSseOptions = {
  kind?: LangGraphChatHttpLogKind;
  /** 与 logLangGraphChatRequest 返回的序号一致 */
  logSeq?: number;
  /** 距上次收到数据超过该毫秒则结束流；≤0 表示禁用空闲超时 */
  idleTimeoutMs?: number;
  signal?: AbortSignal;
};

/**
 * 消费 LangGraph SSE 流（与 Qt readyRead 按行处理一致）。
 * 若上游长期不关闭连接，空闲超时后 cancel reader，便于发起下一次 chat。
 */
export async function consumeLangGraphSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onParsed: (parsed: Record<string, unknown>) => void | Promise<void>,
  opts?: ConsumeLangGraphSseOptions,
): Promise<LangGraphSseConsumeResult> {
  const dec = new TextDecoder();
  /** ≤0 表示不启用空闲超时（工作流中断恢复后节点间隔可能很长） */
  const idleMs = opts?.idleTimeoutMs ?? 8_000;
  const idleEnabled = idleMs > 0;
  const logSeq = opts?.logSeq;
  let buf = "";
  let eventCount = 0;
  let stopReason: LangGraphSseConsumeResult["reason"] = "http_done";
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let cancelledByIdle = false;

  const clearIdle = () => {
    if (idleTimer != null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const armIdle = () => {
    if (!idleEnabled) return;
    clearIdle();
    idleTimer = setTimeout(() => {
      cancelledByIdle = true;
      stopReason = "idle_timeout";
      void reader.cancel().catch(() => {});
    }, idleMs);
  };

  const cancelReader = async () => {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  };

  if (idleEnabled) armIdle();
  try {
    if (opts?.signal?.aborted) {
      stopReason = "cancelled";
      return { reason: stopReason, eventCount };
    }

    while (true) {
      if (opts?.signal?.aborted) {
        stopReason = "cancelled";
        break;
      }

      let done = false;
      let value: Uint8Array | undefined;
      try {
        const chunk = await reader.read();
        done = chunk.done;
        value = chunk.value;
      } catch {
        if (cancelledByIdle || opts?.signal?.aborted) {
          stopReason = cancelledByIdle ? "idle_timeout" : "cancelled";
          break;
        }
        throw new Error("SSE read failed");
      }

      if (done) {
        if (cancelledByIdle) {
          stopReason = "idle_timeout";
        }
        break;
      }

      armIdle();
      buf += dec.decode(value, { stream: true });
      const { lines, rest } = splitLines(buf);
      buf = rest;

      for (const raw of lines) {
        const line = raw.replace(/\r$/, "").trim();
        if (!line) continue;
        if (line === "data: [DONE]" || line === "data:[DONE]") {
          stopReason = "terminal_event";
          clearIdle();
          await cancelReader();
          return { reason: stopReason, eventCount };
        }

        const parsed = parseSseDataLine(line);
        if (!parsed) continue;

        eventCount += 1;
        if (logSeq != null) {
          logLangGraphChatSseEvent(logSeq, eventCount, parsed, line);
        }

        if (String(parsed.event ?? "") === "interrupt") {
          await onParsed(parsed);
          stopReason = "interrupt";
          clearIdle();
          // 不要 reader.cancel()：强制掐断会让任务管理丢掉等待中的 interrupt 状态，
          // 随后 interrupt_feedback 会一直挂起、无 SSE（与 Qt 保持原连接不同）。
          // 由调用方在恢复成功后再 abort 原 AbortController。
          return { reason: stopReason, eventCount };
        }

        if (isLangGraphSseTerminalEvent(parsed)) {
          await onParsed(parsed);
          stopReason = "terminal_event";
          clearIdle();
          await cancelReader();
          return { reason: stopReason, eventCount };
        }

        await onParsed(parsed);
      }
    }
  } finally {
    clearIdle();
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }

  return { reason: stopReason, eventCount };
}

/** @deprecated 使用 consumeLangGraphSseStream（含空闲超时与结束检测） */
export async function forEachLangGraphSseLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onParsed: (parsed: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
  await consumeLangGraphSseStream(reader, onParsed);
}
