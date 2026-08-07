import { NextRequest, NextResponse } from "next/server";
import {
  custombackendProxyHeaders,
  resolveCustombackendBase,
} from "@/lib/server/custombackend-proxy";

export async function POST(req: NextRequest) {
  const backendBase = resolveCustombackendBase();
  const url = `${backendBase}/api/system-eval/camera/pointing-accuracy/trigger`;
  const body = await req.text();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: custombackendProxyHeaders(req, {
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body,
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
