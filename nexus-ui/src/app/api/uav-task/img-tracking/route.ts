import { NextRequest, NextResponse } from "next/server";
import { getDronePlatformBaseUrl } from "@/lib/drone-platform-base-url";
import { resolveDroneFlightHeightFromBody } from "@/lib/drone-task-settings";
import {
  fetchWithTimeout,
  getUavTaskApiBase,
  getUavTaskServiceFetchTimeoutMs,
  loginAndGetSession,
} from "@/lib/server/uav-platform-server-session";
import { isUavTaskServiceResponseOk } from "@/lib/server/uav-task-service-response";

export const runtime = "nodejs";

function readEnvInt(key: string, fallback: number): number {
  const v = process.env[key]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function tsFlightsubtask(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * WatchSys `PtzMainWidget::SendUavFlightTask`（`rectID`>0）→
 * `type.casia.tasks.v1.DroneIMGTracking`（双击检测框单目标图像跟踪）。
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const rawAirport =
    typeof body.airportSN === "string"
      ? body.airportSN.trim()
      : typeof body.deviceSN === "string"
        ? body.deviceSN.trim()
        : "";
  const airportSN = rawAirport;
  const rectId = typeof body.rectId === "number" ? body.rectId : Number(body.rectId ?? body.rectID);
  const videoDetectType =
    typeof body.videoDetectType === "number"
      ? body.videoDetectType
      : Number(body.videoDetectType ?? body.rectType ?? 0);

  if (!airportSN || airportSN === "whzdh01") {
    return NextResponse.json({ ok: false, error: "invalid_or_skipped_airport_sn" }, { status: 400 });
  }
  if (!Number.isFinite(rectId) || rectId <= 0) {
    return NextResponse.json({ ok: false, error: "rectId_required" }, { status: 400 });
  }
  if (!Number.isFinite(videoDetectType) || (videoDetectType !== 0 && videoDetectType !== 1)) {
    return NextResponse.json({ ok: false, error: "invalid_videoDetectType" }, { status: 400 });
  }

  const taskBase = getUavTaskApiBase();
  if (!taskBase) {
    return NextResponse.json(
      { ok: false, error: "missing_NEXUS_UAV_TASK_API_BASE_URL" },
      { status: 503 },
    );
  }

  const height = resolveDroneFlightHeightFromBody(body, readEnvInt("NEXUS_UAV_TRACK_FOLLOW_HEIGHT_M", 100));
  const taskId = `flightsubtask_${tsFlightsubtask()}`;

  const specification: Record<string, unknown> = {
    "@type": "type.casia.tasks.v1.DroneIMGTracking",
    deviceSn: airportSN,
    height,
    rectID: Math.trunc(rectId),
    videoDetectType: Math.trunc(videoDetectType),
    isCircleTrace: 1,
  };

  const taskJson: Record<string, unknown> = {
    taskId,
    parentTaskId: "",
    version: { definitionVersion: 1, statusVersion: 1 },
    displayName: "无人机跟踪任务",
    taskType: "AUTOMATIC",
    maxExecutionTimeMs: 10000,
    specification,
    createdBy: {
      system: {
        serviceName: "display_control_service",
        entityId: "zk_001",
        managesOwnScheduling: true,
        priority: 1,
      },
    },
    owner: { entityId: "task_manager_service" },
  };

  const url = `${taskBase}/api/v1/tasks`;

  try {
    const base = getDronePlatformBaseUrl();
    const session = await loginAndGetSession(base);
    const outbound = JSON.stringify(taskJson);
    const taskTimeoutMs = getUavTaskServiceFetchTimeoutMs();
    console.info("[api/uav-task/img-tracking] POST", url, `(timeout=${taskTimeoutMs}ms)\nBody:`, outbound);
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
      "uav_img_tracking_task",
    );
    const txt = await res.text().catch(() => "");
    const ok = isUavTaskServiceResponseOk(res.ok, txt);
    if (!ok) {
      console.warn("[api/uav-task/img-tracking] 失败 HTTP=", res.status, txt.slice(0, 500));
    }
    return NextResponse.json(
      {
        ok,
        status: res.status,
        detail: txt.slice(0, 800),
        url,
        taskId,
        specification,
      },
      { status: ok ? 200 : 502 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "uav_img_tracking_exception", detail: msg }, { status: 500 });
  }
}
