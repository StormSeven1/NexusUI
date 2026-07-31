import { NextResponse } from "next/server";
import { normalizeKnowledgeBaseUpstreamBody } from "@/lib/knowledge-base-chat-request";
import { resolveKnowledgeBaseChatStreamUrl } from "@/lib/knowledge-base-chat-url";

export const runtime = "nodejs";

/**
 * 代理知识库入口 → `POST {WatchSystemDbQa 上游}/api/v1/chat/stream`
 * 与智能助手 `/api/langgraph-chat` 入口分离；停止工作流仍走任务管理 terminate。
 * 请求体：
 * - 普通：`messages` / `thread_id` / `user_context`
 * - 中断恢复：`thread_id` / `interrupt_id` / `interrupt_feedback`（无 messages）
 */
export async function POST(req: Request) {
  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const upstreamBody = normalizeKnowledgeBaseUpstreamBody(bodyText);
  const upstreamUrl = resolveKnowledgeBaseChatStreamUrl();
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: upstreamBody,
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "upstream fetch failed", detail: msg }, { status: 502 });
  }

  const ct = upstream.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const errText = await upstream.text().catch(() => "");
    let detail = errText.slice(0, 2000);
    try {
      const j = JSON.parse(errText) as { err_msg?: string; error?: string; success?: boolean };
      if (j.success === false || j.err_msg) {
        detail = (j.err_msg ?? j.error ?? detail).trim();
      }
    } catch {
      /* keep raw */
    }
    return NextResponse.json(
      { error: "upstream error", detail: detail || "upstream returned JSON error" },
      { status: upstream.ok ? 502 : upstream.status >= 400 ? upstream.status : 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: "upstream error", detail: errText.slice(0, 2000) },
      { status: upstream.status >= 400 ? upstream.status : 502 },
    );
  }

  const streamCt = upstream.headers.get("content-type") ?? "text/event-stream";
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": streamCt.includes("application/json") ? "text/event-stream" : streamCt,
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
