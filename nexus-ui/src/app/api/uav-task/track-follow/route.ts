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
 * WatchSys `PtzMainWidget::SendUavFlightTask`（`rectID`/`rectType`≤0）：
 * - 对海 → `type.casia.tasks.v1.MultiDroneTracking`（`trackID_List`）
 * - 对空 → `type.casia.tasks.v1.DroneTracking`（`trackID`；C++ 对 radarid 7/8 同型）
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
  const rawTargetId = body.targetId ?? body.target_id ?? body.trackId;
  const targetId = typeof rawTargetId === "number" ? rawTargetId : Number(rawTargetId);
  const lat = typeof body.latitude === "number" ? body.latitude : Number(body.latitude);
  const lon = typeof body.longitude === "number" ? body.longitude : Number(body.longitude);
  const targetSourceId =
    typeof body.targetSourceId === "number" ? body.targetSourceId : Number(body.targetSourceId);
  const mode = typeof body.mode === "number" ? body.mode : Number(body.mode ?? 1);
  const rectID = typeof body.rectID === "number" ? body.rectID : Number(body.rectID ?? -1);
  const rectType = typeof body.rectType === "number" ? body.rectType : Number(body.rectType ?? -1);
  const traceMode = typeof body.traceMode === "number" ? body.traceMode : Number(body.traceMode ?? 0);
  const domainRaw = typeof body.domain === "string" ? body.domain.trim().toLowerCase() : "";
  /**
   * 显式 `domain=air|sea` 优先（地图右键按航迹 type）。
   * 未传 domain 时兜底：C++ radarid 7/8 → DroneTracking；targetSourceId=9（空中融合）亦按对空。
   */
  const isAirFollow =
    domainRaw === "air" ||
    (domainRaw !== "sea" &&
      (Math.trunc(targetSourceId) === 7 ||
        Math.trunc(targetSourceId) === 8 ||
        Math.trunc(targetSourceId) === 9));

  if (!airportSN || airportSN === "whzdh01") {
    return NextResponse.json({ ok: false, error: "invalid_or_skipped_airport_sn" }, { status: 400 });
  }
  if (!Number.isFinite(targetId) || targetId === 0) {
    return NextResponse.json({ ok: false, error: "targetId_required" }, { status: 400 });
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ ok: false, error: "invalid_lat_lon" }, { status: 400 });
  }
  if (!Number.isFinite(targetSourceId)) {
    return NextResponse.json({ ok: false, error: "invalid_targetSourceId" }, { status: 400 });
  }

  const taskBase = getUavTaskApiBase();
  if (!taskBase) {
    return NextResponse.json(
      { ok: false, error: "missing_NEXUS_UAV_TASK_API_BASE_URL" },
      { status: 503 },
    );
  }

  const height = resolveDroneFlightHeightFromBody(body, readEnvInt("NEXUS_UAV_TRACK_FOLLOW_HEIGHT_M", 100));
  const taskWorkMode = readEnvInt("NEXUS_UAV_TRACK_FOLLOW_TASK_WORK_MODE", 0);

  const latR = Math.round(lat * 1e6) / 1e6;
  const lonR = Math.round(lon * 1e6) / 1e6;
  const taskId = `flightsubtask_${tsFlightsubtask()}`;
  const tid = Math.trunc(targetId);
  const modeN = Number.isFinite(mode) ? mode : 1;
  const rectIdN = Number.isFinite(rectID) ? rectID : -1;
  const traceModeN = Number.isFinite(traceMode) ? traceMode : 0;
  const srcId = Math.trunc(targetSourceId);

  const specification: Record<string, unknown> = isAirFollow
    ? {
        "@type": "type.casia.tasks.v1.DroneTracking",
        transition_distance: 20,
        trackID: tid,
        isAutoImgTrace: 1,
        traceMode: traceModeN,
        lon: lonR,
        lat: latR,
        deviceSn: airportSN,
        height,
        mode: modeN,
        rectID: rectIdN,
        targetSourceId: srcId,
        taskWorkMode,
      }
    : {
        "@type": "type.casia.tasks.v1.MultiDroneTracking",
        transition_distance: 200,
        trackID_List: [tid],
        lon: lonR,
        lat: latR,
        deviceSn: airportSN,
        height,
        mode: modeN,
        rectID: rectIdN,
        rectType: Number.isFinite(rectType) ? rectType : -1,
        traceMode: traceModeN,
        targetSourceId: srcId,
        taskWorkMode,
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
    console.info(
      "[api/uav-task/track-follow] 转发任务服务 POST",
      url,
      `(timeout=${taskTimeoutMs}ms)\nBody:`,
      outbound,
    );
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-auth-token": session.token,
        },
        body: JSON.stringify(taskJson),
        cache: "no-store",
      },
      taskTimeoutMs,
      "uav_track_follow_task",
    );
    const txt = await res.text().catch(() => "");
    const ok = isUavTaskServiceResponseOk(res.ok, txt);
    if (!ok) {
      console.warn("[api/uav-task/track-follow] 任务服务拒绝或失败 HTTP=", res.status, txt.slice(0, 500));
    } else {
      console.info("[api/uav-task/track-follow] 任务服务 HTTP", res.status, "响应前 400 字:", txt.slice(0, 400));
    }
    return NextResponse.json(
      {
        ok,
        status: res.status,
        detail: txt.slice(0, 800),
        url,
        specification,
      },
      { status: ok ? 200 : 502 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "uav_track_follow_exception", detail: msg }, { status: 500 });
  }
}
