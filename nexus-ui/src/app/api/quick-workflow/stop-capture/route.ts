import { NextResponse } from "next/server";
import {
  isUpstreamTerminateSuccess,
  isWorkflowNotFoundPayload,
  parseWorkflowControlSource,
  resolveWorkflowControlOriginsInOrder,
} from "@/lib/workflow-control-origin";

export const runtime = "nodejs";

const DEFAULT_TIMEOUT_MS = 8000;

type StopCaptureBody = {
  threadId?: unknown;
  source?: unknown;
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

  const source = parseWorkflowControlSource(body.source);
  const timeoutMs = Number(process.env.QUICK_WORKFLOW_BFF_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const timeout = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const origins = resolveWorkflowControlOriginsInOrder(source);

  let lastDetail = "";
  let lastStatus = 502;

  for (let i = 0; i < origins.length; i++) {
    const origin = origins[i]!;
    const upstreamUrl = `${origin}/api/v1/chat/workflows/${encodeURIComponent(threadId)}/stop-capture`;
    try {
      const upstream = await fetch(upstreamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
        signal: AbortSignal.timeout(timeout),
      });
      const text = await upstream.text().catch(() => "");
      let json: Record<string, unknown> | null = null;
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
      } catch {
        json = null;
      }
      if (isUpstreamTerminateSuccess(upstream.ok, text)) {
        return NextResponse.json({
          ok: true,
          success: true,
          message: typeof json?.message === "string" ? json.message : "已发送停止采集信号",
          origin,
          source,
          upstream: json,
        });
      }
      lastDetail = String(json?.message ?? json?.error ?? text).slice(0, 2000);
      lastStatus = upstream.status >= 400 ? upstream.status : 502;
      if (i < origins.length - 1 && isWorkflowNotFoundPayload(text)) continue;
      return NextResponse.json(
        { error: "upstream error", detail: lastDetail, origin, source },
        { status: lastStatus },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[quick-workflow/stop-capture] upstream failed:", upstreamUrl, msg);
      lastDetail = msg;
      lastStatus = 502;
      if (i < origins.length - 1) continue;
      return NextResponse.json(
        { error: "upstream fetch failed", detail: msg, origin, source },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(
    { error: "upstream error", detail: lastDetail, source },
    { status: lastStatus },
  );
}
