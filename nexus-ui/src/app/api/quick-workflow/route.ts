import { NextResponse } from "next/server";
import { queryActiveAlarmSchemeId } from "@/lib/alarm-master-scheme-db.server";
import { resolveTaskManagementOrigin } from "@/lib/task-management-url";
import { resolvePostgresConnectionString } from "@/lib/postgres-connection.server";

export const runtime = "nodejs";

/** 等待任务管理返回 SSE 响应头的超时（毫秒） */
const DEFAULT_HEADER_TIMEOUT_MS = 15_000;
/** 后台消费 SSE 的最长时间（毫秒）；日常查证 dispatch_tasks 约 3s，留足余量 */
const DEFAULT_DRAIN_TIMEOUT_MS = 120_000;

/** 后台读完上游 SSE，避免 `cancel()` 在 dispatch_tasks 前断开连接导致相机不动 */
function drainUpstreamSse(body: ReadableStream<Uint8Array> | null, threadId: string): void {
  if (!body) return;
  const drainMs = Number(process.env.QUICK_WORKFLOW_BFF_DRAIN_TIMEOUT_MS ?? DEFAULT_DRAIN_TIMEOUT_MS);
  void (async () => {
    const reader = body.getReader();
    const timer =
      Number.isFinite(drainMs) && drainMs > 0
        ? setTimeout(() => reader.cancel().catch(() => {}), drainMs)
        : null;
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch (e) {
      console.warn(
        "[quick-workflow] upstream drain ended",
        threadId,
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
}

type QuickWorkflowBody = {
  thread_id?: unknown;
  workflow_id?: unknown;
  parameters?: unknown;
};

/**
 * BFF：代理快捷/日常查证工作流启动 → `POST {upstream}/api/v1/chat/quick-workflow`
 * `parameters.schema_id` 由 Postgres `alarm_master_schemes.enabled=true` 覆盖（忽略 app-config 硬编码）。
 */
export async function POST(req: Request) {
  if (!resolvePostgresConnectionString()) {
    return NextResponse.json(
      { error: "数据库未配置（NEXUS_POSTGRES_URL）" },
      { status: 503 },
    );
  }

  let raw: QuickWorkflowBody;
  try {
    raw = JSON.parse(await req.text()) as QuickWorkflowBody;
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const baseParams =
    typeof raw.parameters === "object" && raw.parameters != null && !Array.isArray(raw.parameters)
      ? { ...(raw.parameters as Record<string, unknown>) }
      : {};
  const wfId = typeof raw.workflow_id === "string" ? raw.workflow_id.trim() : "";
  const needsScheme =
    wfId.includes("auto_duty") || "schema_id" in baseParams || "scheme_id" in baseParams;

  let schemeId: string | null = null;
  if (needsScheme) {
    schemeId = await queryActiveAlarmSchemeId();
    if (!schemeId) {
      return NextResponse.json(
        { error: "alarm_master_schemes 中无 enabled=true 的记录" },
        { status: 503 },
      );
    }
    baseParams.schema_id = schemeId;
  }
  const bodyText = JSON.stringify({ ...raw, parameters: baseParams });

  const headerTimeoutMs = Number(
    process.env.QUICK_WORKFLOW_BFF_HEADER_TIMEOUT_MS ??
      process.env.QUICK_WORKFLOW_BFF_TIMEOUT_MS ??
      DEFAULT_HEADER_TIMEOUT_MS,
  );
  const upstreamUrl = `${resolveTaskManagementOrigin()}/api/v1/chat/quick-workflow`;
  const threadId = typeof raw.thread_id === "string" ? raw.thread_id.trim() : "";
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: bodyText,
      cache: "no-store",
      signal: AbortSignal.timeout(
        Number.isFinite(headerTimeoutMs) ? headerTimeoutMs : DEFAULT_HEADER_TIMEOUT_MS,
      ),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[quick-workflow] upstream failed:", upstreamUrl, msg);
    return NextResponse.json({ error: "upstream fetch failed", detail: msg }, { status: 502 });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: "upstream error", detail: text.slice(0, 2000) },
      { status: upstream.status >= 400 ? upstream.status : 502 },
    );
  }

  drainUpstreamSse(upstream.body, threadId || "(unknown)");
  console.info("[quick-workflow] started", {
    workflow_id: raw.workflow_id,
    schema_id: schemeId,
    thread_id: raw.thread_id,
  });
  return NextResponse.json({ ok: true, scheme_id: schemeId });
}
