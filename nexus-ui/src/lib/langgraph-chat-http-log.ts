/**
 * 智能助手 LangGraph chat 请求/响应结构控制台日志（对齐 Qt `GPTInterfaceWgt` 中 qDebug 请求 JSON）。
 */

export type LangGraphChatHttpLogKind = "chat" | "interrupt_resume";

export type LangGraphChatHttpRequestLog = {
  kind: LangGraphChatHttpLogKind;
  /** 浏览器侧为 `/api/langgraph-chat`；服务端代理日志为上游完整 URL */
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  /** 可选：本次用户输入摘要 */
  userTextPreview?: string;
};

export type LangGraphChatHttpResponseLog = {
  kind: LangGraphChatHttpLogKind;
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  /** 与请求日志对应的序号 */
  seq?: number;
  durationMs?: number;
  /** 失败时截断的错误正文 */
  errorDetail?: string;
};

export type LangGraphChatStreamEndLog = {
  kind: LangGraphChatHttpLogKind;
  seq: number;
  reason: string;
  eventCount: number;
  durationMs: number;
};

const LOG_PREFIX = "[智能助手 HTTP]";

let requestSeq = 0;

function shouldLog(): boolean {
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_LANGGRAPH_CHAT_HTTP_LOG === "false") {
    return false;
  }
  return true;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** 分配本次 chat 请求序号（与 Qt 多次 post 可对比） */
export function nextLangGraphChatRequestSeq(): number {
  requestSeq += 1;
  return requestSeq;
}

/** 记录即将发出的 chat POST 结构（对齐 Qt `LANGGRAGH_CHAT 请求JSON`） */
export function logLangGraphChatRequest(entry: LangGraphChatHttpRequestLog): number {
  const seq = nextLangGraphChatRequestSeq();
  if (!shouldLog()) return seq;

  const tag = entry.kind === "interrupt_resume" ? "中断恢复" : "发送对话";
  const bodyJson = JSON.stringify(entry.body, null, 2);

  console.groupCollapsed(`${LOG_PREFIX} #${seq} ${tag} → ${entry.method} ${entry.url} @ ${nowIso()}`);
  console.log("序号 seq:", seq);
  console.log("Headers:", { ...entry.headers });
  console.log("Body (JSON，与 Qt 一致):", bodyJson);
  console.log("Body (object):", entry.body);
  if (entry.userTextPreview) {
    console.log("user_input:", entry.userTextPreview);
  }
  console.groupEnd();

  return seq;
}

/** 记录 chat 响应状态；失败时附带 detail */
export function logLangGraphChatResponse(entry: LangGraphChatHttpResponseLog): void {
  if (!shouldLog()) return;
  const tag = entry.kind === "interrupt_resume" ? "中断恢复" : "发送对话";
  const level = entry.ok ? "log" : "warn";
  const seqLabel = entry.seq != null ? `#${entry.seq} ` : "";
  console[level](
    `${LOG_PREFIX} ${seqLabel}${tag} ← HTTP ${entry.status} ${entry.statusText} @ ${nowIso()}`,
    {
      url: entry.url,
      ok: entry.ok,
      durationMs: entry.durationMs,
      ...(entry.errorDetail ? { errorDetail: entry.errorDetail } : {}),
    },
  );
}

/** 记录 SSE 单行事件（默认仅前 30 条，避免刷屏） */
export function logLangGraphChatSseEvent(
  seq: number,
  index: number,
  parsed: Record<string, unknown>,
  rawLine?: string,
): void {
  if (!shouldLog()) return;
  if (index > 30) return;
  const ev = String(parsed.event ?? "(无 event)");
  console.log(`${LOG_PREFIX} #${seq} SSE[${index}] event=${ev}`, {
    thread_id: parsed.thread_id,
    data: parsed.data,
    ...(rawLine && index <= 5 ? { rawLine: rawLine.slice(0, 500) } : {}),
  });
}

export function logLangGraphChatStreamEnd(entry: LangGraphChatStreamEndLog): void {
  if (!shouldLog()) return;
  const tag = entry.kind === "interrupt_resume" ? "中断恢复" : "发送对话";
  console.log(`${LOG_PREFIX} #${entry.seq} ${tag} 流结束`, {
    reason: entry.reason,
    eventCount: entry.eventCount,
    durationMs: entry.durationMs,
  });
}

/** 发送被拦截时（便于排查「第二次点不了」） */
export function logLangGraphChatSendBlocked(reason: string, extra?: Record<string, unknown>): void {
  if (!shouldLog()) return;
  console.warn(`${LOG_PREFIX} 发送被拦截: ${reason}`, extra ?? {});
}

/** Next.js 代理层：记录转发的上游 URL 与请求体 */
export function logLangGraphChatUpstreamProxy(
  upstreamUrl: string,
  bodyText: string,
  responseStatus: number,
  responseOk: boolean,
  errorDetail?: string,
): void {
  if (!shouldLog()) return;
  let bodyObj: unknown = bodyText;
  try {
    bodyObj = JSON.parse(bodyText) as unknown;
  } catch {
    /* keep raw string */
  }
  console.log(`${LOG_PREFIX} [服务端代理] → POST ${upstreamUrl} @ ${nowIso()}`, {
    requestBody: bodyObj,
    responseStatus,
    responseOk,
    ...(errorDetail ? { errorDetail } : {}),
  });
}
