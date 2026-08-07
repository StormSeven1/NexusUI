import { NextRequest, NextResponse } from "next/server";
import {
  custombackendProxyHeaders,
  resolveCustombackendBase,
} from "@/lib/server/custombackend-proxy";

export async function GET(req: NextRequest) {
  const backendBase = resolveCustombackendBase();
  const q = req.nextUrl.searchParams.toString();
  const url = `${backendBase}/api/system-eval/camera/pointing-accuracy${q ? `?${q}` : ""}`;
  try {
    const res = await fetch(url, {
      headers: custombackendProxyHeaders(req, { Accept: "application/json" }),
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
