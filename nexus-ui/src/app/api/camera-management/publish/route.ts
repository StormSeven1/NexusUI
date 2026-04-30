import { NextRequest, NextResponse } from "next/server";

/** 与 `NEXT_PUBLIC_NEXUS_CAMERA_MANAGEMENT_URL` 同源才允许转发，减轻 SSRF */
function allowedCameraOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_NEXUS_CAMERA_MANAGEMENT_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * 浏览器 HTTPS 页面向 HTTP 相机管理转发元任务，避免 Mixed Content。
 * Body: `{ "publishUrl": "http://host:port/...", "task": { ... } }`
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const o = body as { publishUrl?: unknown; task?: unknown };
  const publishUrl = String(o.publishUrl ?? "").trim();
  const task = o.task;
  if (!publishUrl || task == null || typeof task !== "object" || Array.isArray(task)) {
    return NextResponse.json({ error: "need publishUrl and task object" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(publishUrl);
  } catch {
    return NextResponse.json({ error: "invalid publishUrl" }, { status: 400 });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json({ error: "only http(s) publishUrl" }, { status: 400 });
  }

  const allowed = allowedCameraOrigin();
  if (allowed && target.origin !== allowed) {
    return NextResponse.json(
      { error: "publishUrl origin mismatch env", expected: allowed, got: target.origin },
      { status: 403 },
    );
  }

  try {
    const upstream = await fetch(publishUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(task),
      cache: "no-store",
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      },
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "camera proxy fetch failed", detail }, { status: 502 });
  }
}
