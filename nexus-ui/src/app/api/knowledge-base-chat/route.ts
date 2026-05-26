import { NextResponse } from "next/server";

export const runtime = "nodejs";

function dbQaUpstreamBase(): string {
  const ip =
    process.env.WatchSystemDbQaIp?.trim() ||
    process.env.WATCHSYSTEM_DB_QA_IP?.trim() ||
    "192.168.18.103";
  const portRaw =
    process.env.WatchSystemDbQaPort?.trim() ||
    process.env.WATCHSYSTEM_DB_QA_PORT?.trim() ||
    "5670";
  const port = /^\d+$/.test(portRaw) ? portRaw : "5670";
  return `http://${ip}:${port}`;
}

/**
 * 代理 watchsystem 数据库问答 → `POST {upstream}/api/v1/chat/react-agent`
 * 地址由 WatchSystemDbQaIp / WatchSystemDbQaPort（或 WATCHSYSTEM_DB_QA_*）配置。
 */
export async function POST(req: Request) {
  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const upstreamUrl = `${dbQaUpstreamBase()}/api/v1/chat/react-agent`;
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
