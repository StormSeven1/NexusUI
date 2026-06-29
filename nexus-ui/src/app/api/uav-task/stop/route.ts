import { NextRequest, NextResponse } from "next/server";
import { getDronePlatformBaseUrl } from "@/lib/drone-platform-base-url";
import {
  fetchWithTimeout,
  getUavTaskApiBase,
  getUavTaskServiceFetchTimeoutMs,
  loginAndGetSession,
} from "@/lib/server/uav-platform-server-session";
import { isUavTaskServiceResponseOk } from "@/lib/server/uav-task-service-response";

export const runtime = "nodejs";

/** WatchSys `PtzMainWidget::SendUavStopTask` → `POST {taskBase}/api/v1/tasks/stop` */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const raw = body.taskIds ?? body.taskId;
  const taskIds: string[] = Array.isArray(raw)
    ? raw.map((x) => String(x).trim()).filter(Boolean)
    : typeof raw === "string" && raw.trim()
      ? [raw.trim()]
      : [];

  if (!taskIds.length) {
    return NextResponse.json({ ok: false, error: "taskIds_required" }, { status: 400 });
  }

  const taskBase = getUavTaskApiBase();
  if (!taskBase) {
    return NextResponse.json(
      { ok: false, error: "missing_NEXUS_UAV_TASK_API_BASE_URL" },
      { status: 503 },
    );
  }

  const url = `${taskBase}/api/v1/tasks/stop`;
  const outbound = JSON.stringify({ taskIds });

  try {
    const base = getDronePlatformBaseUrl();
    const session = await loginAndGetSession(base);
    const taskTimeoutMs = getUavTaskServiceFetchTimeoutMs();
    console.info("[api/uav-task/stop] POST", url, outbound);
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-auth-token": session.token,
        },
        body: outbound,
        cache: "no-store",
      },
      taskTimeoutMs,
      "uav_task_stop",
    );
    const txt = await res.text().catch(() => "");
    const ok = isUavTaskServiceResponseOk(res.ok, txt);
    return NextResponse.json(
      { ok, status: res.status, detail: txt.slice(0, 800), url },
      { status: ok ? 200 : 502 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "uav_task_stop_exception", detail: msg }, { status: 500 });
  }
}
