import { NextResponse } from "next/server";
import { resolveTaskManagementOrigin } from "@/lib/task-management-url";

export const runtime = "nodejs";

const DEFAULT_TIMEOUT_MS = 8000;

type StopCaptureBody = {
  threadId?: unknown;
};

/** BFF：代理探鸟雷达等 → `POST …/workflows/{threadId}/stop-capture` */
export async function POST(req: Request) {
  let body: StopCaptureBody;
  try {
    body = (await req.json()) as StopCaptureBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
  if (!threadId) {
    return NextResponse.json({ error: "missing threadId" }, { status: 400 });
  }

  const timeoutMs = Number(process.env.QUICK_WORKFLOW_BFF_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const upstreamUrl = `${resolveTaskManagementOrigin()}/api/v1/chat/workflows/${encodeURIComponent(threadId)}/stop-capture`;
  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS),
    });
    const text = await upstream.text().catch(() => "");
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    if (!upstream.ok) {
      return NextResponse.json(
        {
          error: "upstream error",
          detail: (json?.message ?? json?.error ?? text).toString().slice(0, 2000),
        },
        { status: upstream.status >= 400 ? upstream.status : 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      success: json?.success !== false,
      message: typeof json?.message === "string" ? json.message : "已发送停止采集信号",
      upstream: json,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[quick-workflow/stop-capture] upstream failed:", upstreamUrl, msg);
    return NextResponse.json({ error: "upstream fetch failed", detail: msg }, { status: 502 });
  }
}
