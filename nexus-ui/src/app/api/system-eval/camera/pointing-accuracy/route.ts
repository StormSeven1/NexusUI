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

export async function GET(req: NextRequest) {
  const backendBase = resolveBackendBase();
  const q = req.nextUrl.searchParams.toString();
  const url = `${backendBase}/api/system-eval/camera/pointing-accuracy${q ? `?${q}` : ""}`;
  try {
    const res = await fetch(url, {
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
        message: `无法连接 Custombackend: ${backendBase}`,
        backend: backendBase,
        detail: msg,
      },
      { status: 502 },
    );
  }
}
