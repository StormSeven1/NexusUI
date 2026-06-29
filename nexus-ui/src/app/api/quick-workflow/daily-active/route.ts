import { NextResponse } from "next/server";
import { fetchActiveAutoDutyThreadIds } from "@/lib/auto-duty-workflow-history.server";
import { resolveTaskManagementOrigin } from "@/lib/task-management-url";

export const runtime = "nodejs";

const DEFAULT_TIMEOUT_MS = 8000;

/** BFF：仅 `auto_duty_workflow` 是否在运行（不含智能助手区域航迹/搜索查证等工作流） */
export async function GET() {
  const timeoutMs = Number(process.env.QUICK_WORKFLOW_BFF_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const signal = AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS);
  const origin = resolveTaskManagementOrigin();

  try {
    const threadIds = await fetchActiveAutoDutyThreadIds(origin, signal);
    return NextResponse.json({ active: threadIds.length > 0, threadIds });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[quick-workflow/daily-active]", msg);
    return NextResponse.json({ active: false, threadIds: [], error: msg.slice(0, 240) });
  }
}
