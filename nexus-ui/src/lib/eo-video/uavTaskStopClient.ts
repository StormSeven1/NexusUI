"use client";

export type UavTaskStopResult = {
  ok: boolean;
  status?: number;
  error?: string;
  detail?: string;
};

/** WatchSys `PtzMainWidget::SendUavStopTask` → `POST /api/v1/tasks/stop` */
export async function postUavTaskStop(args: { taskIds: string[] }): Promise<UavTaskStopResult> {
  const ids = args.taskIds.map((x) => x.trim()).filter(Boolean);
  if (!ids.length) throw new Error("taskIds_required");
  const res = await fetch("/api/uav-task/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskIds: ids }),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let json: UavTaskStopResult | null = null;
  try {
    json = text ? (JSON.parse(text) as UavTaskStopResult) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(json?.detail || json?.error || text.slice(0, 300) || `HTTP ${res.status}`);
  }
  if (!json?.ok) throw new Error(json?.detail || json?.error || "uav_task_stop_not_ok");
  return json;
}
