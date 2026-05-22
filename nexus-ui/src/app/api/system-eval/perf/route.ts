import { NextRequest, NextResponse } from "next/server";

/** 与 task-status-http-listener 一致：Docker/裸跑均可解析到 Custombackend */
function resolveBackendBase(): string {
  const fromEnv = process.env.BACKEND_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const port = process.env.BACKEND_PORT?.trim() || "27003";
  const host =
    process.env.NEXUS_BACKEND_HOST?.trim() ||
    process.env.APP_CONFIG_LAN_HOST?.trim() ||
    "192.168.18.141";
  return `http://${host}:${port}`;
}

/**
 * 转发到 Custombackend `GET /api/system-eval/perf`（再调 system-evaluation-server gRPC）。
 */
export async function GET(req: NextRequest) {
  const backendBase = resolveBackendBase();
  const limit = req.nextUrl.searchParams.get("limit") ?? "10";
  const url = `${backendBase}/api/system-eval/perf?limit=${encodeURIComponent(limit)}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/json; charset=utf-8",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: "backend proxy failed",
        message: `无法连接 Custombackend: ${backendBase}（请确认 Custombackend 已启动且含 /api/system-eval/perf）`,
        backend: backendBase,
        detail: msg,
      },
      { status: 502 },
    );
  }
}
