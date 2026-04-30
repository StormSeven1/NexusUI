import { NextRequest, NextResponse } from "next/server";

/** 仅允许内网 IPv4，降低开放代理 SSRF 风险 */
function isAllowedZlmHost(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const [a0, b0, c0, d0] = parts.map((p) => Number(p));
  if ([a0, b0, c0, d0].some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const a = a0;
  const b = b0;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 0 && b === 0 && c0 === 0 && d0 === 0) return false;
  return false;
}

/**
 * 浏览器同源 POST → Next 服务端转发到 ZLM `/index/api/webrtc`，避免跨域。
 * Query: host, port, app, stream, type（与 ZLM 文档一致）
 */
export async function POST(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const host = sp.get("host");
  const port = sp.get("port") ?? "80";
  const app = sp.get("app") ?? "live";
  const stream = sp.get("stream");
  const type = sp.get("type") ?? "play";

  if (!host?.trim() || !stream?.trim()) {
    return NextResponse.json({ error: "missing host or stream", code: -1 }, { status: 400 });
  }
  if (!isAllowedZlmHost(host.trim())) {
    return NextResponse.json({ error: "host not allowed (private IPv4 only)", code: -1 }, { status: 403 });
  }

  const target = new URL(`http://${host.trim()}:${port.trim()}/index/api/webrtc`);
  target.searchParams.set("app", app);
  target.searchParams.set("stream", stream.trim());
  target.searchParams.set("type", type);

  const sdp = await req.text();
  if (!sdp.trim()) {
    return NextResponse.json({ error: "empty SDP body", code: -1 }, { status: 400 });
  }

  try {
    const res = await fetch(target.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
        Accept: "application/json,*/*",
      },
      body: sdp,
      cache: "no-store",
    });
    const body = await res.text();
    const ct = res.headers.get("content-type") ?? "application/json; charset=utf-8";
    return new NextResponse(body, {
      status: res.status,
      headers: { "Content-Type": ct },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ code: -1, msg: `proxy fetch failed: ${msg}` }, { status: 502 });
  }
}
