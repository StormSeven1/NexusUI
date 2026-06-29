/** 顶栏「日常查证」对应 LangGraph 业务工作流名（非 area_track/search 等助手指令工作流） */
export const AUTO_DUTY_WORKFLOW_NAME = "auto_duty_workflow";

const ACTIVE_STATUSES_SKIP = new Set([
  "cancelled",
  "completed",
  "failed",
  "error",
  "already_cleared",
  "cleared",
]);

export function isActiveWorkflowStatus(status: unknown): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  if (!s) return false;
  return !ACTIVE_STATUSES_SKIP.has(s);
}

export type WorkflowHistoryRow = {
  main_thread_id?: string;
  business_workflow_name?: string;
  status?: string;
};

/** 查询任务管理中仍在运行的 auto_duty_workflow 主 thread_id 列表 */
export async function fetchActiveAutoDutyThreadIds(
  origin: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const histUrl = `${origin.replace(/\/$/, "")}/api/v1/chat/workflows/history?page=1&page_size=100`;
  const histRes = await fetch(histUrl, { cache: "no-store", signal });
  if (!histRes.ok) {
    const text = await histRes.text().catch(() => "");
    throw new Error(`workflow history HTTP ${histRes.status}: ${text.slice(0, 200)}`);
  }
  const histJson = (await histRes.json()) as { data?: WorkflowHistoryRow[] };
  const out: string[] = [];
  for (const row of histJson.data ?? []) {
    if (row.business_workflow_name !== AUTO_DUTY_WORKFLOW_NAME) continue;
    if (!isActiveWorkflowStatus(row.status)) continue;
    const tid = String(row.main_thread_id ?? "").trim();
    if (tid) out.push(tid);
  }
  return out;
}
