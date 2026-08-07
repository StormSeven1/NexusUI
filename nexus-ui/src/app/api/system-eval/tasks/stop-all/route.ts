import { NextRequest, NextResponse } from "next/server";

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

/** 转发到 Custombackend `POST /api/system-eval/tasks/stop-all` */
export async function POST(req: NextRequest) {
  const backendBase = resolveBackendBase();
  const url = `${backendBase}/api/system-eval/tasks/stop-all`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: "{}",
      cache: "no-store",
      signal: req.signal,
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
        message: `无法连接 Custombackend: ${backendBase}`,
        backend: backendBase,
        detail: msg,
      },
      { status: 502 },
    );
  }
}
