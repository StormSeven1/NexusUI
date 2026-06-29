import { NextResponse } from "next/server";
import { resolveTaskManagementOrigin } from "@/lib/task-management-url";

export const runtime = "nodejs";

const DEFAULT_TIMEOUT_MS = 8000;

type TerminateBody = {
  threadId?: unknown;
};

/** BFF：代理日常查证终止 → `POST …/workflows/{threadId}/terminate` */
export async function POST(req: Request) {
  let body: TerminateBody;
  try {
    body = (await req.json()) as TerminateBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
  if (!threadId) {
    return NextResponse.json({ error: "missing threadId" }, { status: 400 });
  }

  const timeoutMs = Number(process.env.QUICK_WORKFLOW_BFF_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const upstreamUrl = `${resolveTaskManagementOrigin()}/api/v1/chat/workflows/${encodeURIComponent(threadId)}/terminate`;
  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS),
    });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: "upstream error", detail: text.slice(0, 2000) },
        { status: upstream.status >= 400 ? upstream.status : 502 },
      );
    }
    await upstream.body?.cancel().catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[quick-workflow/terminate] upstream failed:", upstreamUrl, msg);
    return NextResponse.json({ error: "upstream fetch failed", detail: msg }, { status: 502 });
  }
}
