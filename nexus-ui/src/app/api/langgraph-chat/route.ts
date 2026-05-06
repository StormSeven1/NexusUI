import { NextResponse } from "next/server";

export const runtime = "nodejs";

function assistantUpstreamBase(): string {
  const ip =
    process.env.LangGraphIp?.trim() ||
    process.env.LANGGRAPH_IP?.trim() ||
    "192.168.18.103";
  const portRaw =
    process.env.LangGraphPort?.trim() ||
    process.env.LANGGRAPH_PORT?.trim() ||
    "8000";
  const port = /^\d+$/.test(portRaw) ? portRaw : "8000";
  return `http://${ip}:${port}`;
}

/**
 * 代理助手对话流式接口 → `POST {upstream}/api/v1/chat/stream`
 * 地址由服务端环境变量 LangGraphIp / LangGraphPort（或 LANGGRAPH_*）配置。
 */
export async function POST(req: Request) {
  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const upstreamUrl = `${assistantUpstreamBase()}/api/v1/chat/stream`;
  let upstream: Response;
  try {
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
    return NextResponse.json({ error: "upstream fetch failed", detail: msg }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: "upstream error", detail: errText.slice(0, 2000) },
      { status: upstream.status >= 400 ? upstream.status : 502 },
    );
  }

  const ct = upstream.headers.get("content-type") ?? "text/event-stream";
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": ct.includes("application/json") ? "text/event-stream" : ct,
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
