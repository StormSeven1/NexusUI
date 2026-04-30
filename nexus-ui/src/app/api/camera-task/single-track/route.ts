import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL?.trim() ?? "";

/**
 * 转发到 Custombackend（若存在 `POST /api/camera-tasks/single-track`）。
 */
export async function POST(req: NextRequest) {
  if (!BACKEND_URL) {
    return NextResponse.json({ error: "missing BACKEND_URL" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND_URL.replace(/\/$/, "")}/api/camera-tasks/single-track`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
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
    return NextResponse.json({ error: "backend proxy failed", backend: BACKEND_URL, detail: msg }, { status: 502 });
  }
}
