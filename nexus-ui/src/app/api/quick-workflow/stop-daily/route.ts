import { NextResponse } from "next/server";
import {
  AUTO_DUTY_WORKFLOW_NAME,
  fetchActiveAutoDutyThreadIds,
} from "@/lib/auto-duty-workflow-history.server";
import { resolveTaskManagementOrigin } from "@/lib/task-management-url";

export const runtime = "nodejs";

const DEFAULT_TIMEOUT_MS = 8000;

type StopDailyBody = {
  threadIds?: unknown;
  workflowName?: unknown;
};

function collectThreadIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const tid = typeof item === "string" ? item.trim() : "";
    if (tid) out.push(tid);
  }
  return out;
}

/** BFF：终止日常查证 — 合并客户端 threadId + 工作流历史中仍在运行的 auto_duty_workflow */
export async function POST(req: Request) {
  let body: StopDailyBody = {};
  try {
    body = (await req.json()) as StopDailyBody;
  } catch {
    /* 空 body 允许 */
  }

  const workflowName =
    typeof body.workflowName === "string" && body.workflowName.trim()
      ? body.workflowName.trim()
      : AUTO_DUTY_WORKFLOW_NAME;
  const threadIdSet = new Set<string>(collectThreadIds(body.threadIds));

  const timeoutMs = Number(process.env.QUICK_WORKFLOW_BFF_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const signal = AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS);
  const origin = resolveTaskManagementOrigin();

  if (workflowName === AUTO_DUTY_WORKFLOW_NAME) {
    try {
      for (const tid of await fetchActiveAutoDutyThreadIds(origin, signal)) {
        threadIdSet.add(tid);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[quick-workflow/stop-daily] history fetch failed:", msg);
    }
  }

  const terminated: string[] = [];
  const errors: string[] = [];

  for (const tid of threadIdSet) {
    const termUrl = `${origin}/api/v1/chat/workflows/${encodeURIComponent(tid)}/terminate`;
    try {
      const res = await fetch(termUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
        signal,
      });
      if (res.ok) {
        terminated.push(tid);
      } else {
        const t = await res.text().catch(() => "");
        errors.push(`${tid}: HTTP ${res.status} ${t.slice(0, 120)}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${tid}: ${msg}`);
    }
  }

  return NextResponse.json({
    ok: true,
    terminated,
    attempted: [...threadIdSet],
    errors: errors.slice(0, 8),
  });
}
