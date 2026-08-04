import { NextResponse } from "next/server";
import {
  isUpstreamTerminateSuccess,
  isWorkflowNotFoundPayload,
  parseWorkflowControlSource,
  resolveWorkflowControlOriginsInOrder,
} from "@/lib/workflow-control-origin";

export const runtime = "nodejs";

const DEFAULT_TIMEOUT_MS = 8000;

type TerminateBody = {
  threadId?: unknown;
  /** 会话来源：knowledge-base → DbQa 主机；assistant → 任务管理 */
  source?: unknown;
};

/** BFF：代理工作流终止 → `POST …/workflows/{threadId}/terminate` */
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

  const source = parseWorkflowControlSource(body.source);
  const timeoutMs = Number(process.env.QUICK_WORKFLOW_BFF_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const timeout = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const origins = resolveWorkflowControlOriginsInOrder(source);

  let lastDetail = "";
  let lastStatus = 502;

  for (let i = 0; i < origins.length; i++) {
    const origin = origins[i]!;
    const upstreamUrl = `${origin}/api/v1/chat/workflows/${encodeURIComponent(threadId)}/terminate`;
    try {
      const upstream = await fetch(upstreamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
        signal: AbortSignal.timeout(timeout),
      });
      const text = await upstream.text().catch(() => "");
      if (isUpstreamTerminateSuccess(upstream.ok, text)) {
        return NextResponse.json({ ok: true, origin, source });
      }
      lastDetail = text.slice(0, 2000) || `HTTP ${upstream.status}`;
      lastStatus = upstream.status >= 400 ? upstream.status : 502;
      // 本机未找到时尝试另一侧（知识库 / 智能助手主机不同）
      const canFallback =
        i < origins.length - 1 && isWorkflowNotFoundPayload(text);
      if (canFallback) continue;
      return NextResponse.json(
        { error: "upstream error", detail: lastDetail, origin, source },
        { status: lastStatus },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[quick-workflow/terminate] upstream failed:", upstreamUrl, msg);
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
