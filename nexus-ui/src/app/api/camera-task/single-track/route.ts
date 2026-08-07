import { NextRequest, NextResponse } from "next/server";
import {
  custombackendProxyHeaders,
  resolveCustombackendBase,
} from "@/lib/server/custombackend-proxy";

/**
 * 转发到 Custombackend（若存在 `POST /api/camera-tasks/single-track`）。
 */
export async function POST(req: NextRequest) {
  const backendBase = resolveCustombackendBase();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const res = await fetch(`${backendBase}/api/camera-tasks/single-track`, {
      method: "POST",
      headers: custombackendProxyHeaders(req, {
        "Content-Type": "application/json",
        Accept: "application/json",
      }),
      body: JSON.stringify(body),
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
      { error: "backend proxy failed", backend: backendBase, detail: msg },
      { status: 502 },
    );
  }
}
