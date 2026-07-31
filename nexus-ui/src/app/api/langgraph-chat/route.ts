import { NextResponse } from "next/server";
import { logLangGraphChatUpstreamProxy } from "@/lib/langgraph-chat-http-log";
import { resolveTaskManagementOrigin } from "@/lib/task-management-url";

export const runtime = "nodejs";

/**
 * 把上游 SSE body 泵给浏览器；客户端 abort 时 cancel reader。
 * 上游异常时尽量 controller.close()，避免 chunked 半截断开 → ERR_INCOMPLETE_CHUNKED_ENCODING。
 */
function pipeUpstreamSse(
  upstreamBody: ReadableStream<Uint8Array>,
  clientSignal: AbortSignal,
): ReadableStream<Uint8Array> {
  const reader = upstreamBody.getReader();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const abortUpstream = () => {
        void reader.cancel().catch(() => {});
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      if (clientSignal.aborted) {
        abortUpstream();
        return;
      }
      clientSignal.addEventListener("abort", abortUpstream, { once: true });

      try {
        while (true) {
          if (clientSignal.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      } catch {
        // 宁可正常结束帧，也不要把半截 chunked 甩给浏览器
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      } finally {
        clientSignal.removeEventListener("abort", abortUpstream);
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
      }
    },
    cancel() {
      void reader.cancel().catch(() => {});
    },
  });
}

/**
 * 代理助手对话流式接口 → `POST {upstream}/api/v1/chat/stream`
 * 地址与处置/快捷工作流同源：`NEXT_PUBLIC_NEXUS_TASK_MANAGEMENT_URL`（或 `NEXUS_TASK_MANAGEMENT_URL`、LangGraphIp/Port）。
 */
export async function POST(req: Request) {
  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const upstreamUrl = `${resolveTaskManagementOrigin()}/api/v1/chat/stream`;
  let upstream: Response;
  try {
    // 不把 req.signal 直接绑到 upstream fetch：浏览器 abort 原 SSE 时若连带取消
    // interrupt_feedback 的上游，会在 nginx 上表现为 ERR_INCOMPLETE_CHUNKED_ENCODING。
    // 客户端断开改由 pipeUpstreamSse 里 cancel reader 清理。
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: bodyText,
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (req.signal.aborted || (e instanceof Error && e.name === "AbortError")) {
      return new Response(null, { status: 499 });
    }
    logLangGraphChatUpstreamProxy(upstreamUrl, bodyText, 0, false, msg);
    return NextResponse.json({ error: "upstream fetch failed", detail: msg }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    logLangGraphChatUpstreamProxy(upstreamUrl, bodyText, upstream.status, false, errText.slice(0, 2000));
    return NextResponse.json(
      { error: "upstream error", detail: errText.slice(0, 2000) },
      { status: upstream.status >= 400 ? upstream.status : 502 },
    );
  }

  logLangGraphChatUpstreamProxy(upstreamUrl, bodyText, upstream.status, true);

  const ct = upstream.headers.get("content-type") ?? "text/event-stream";
  return new Response(pipeUpstreamSse(upstream.body, req.signal), {
    status: upstream.status,
    headers: {
      "Content-Type": ct.includes("application/json") ? "text/event-stream" : ct,
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
