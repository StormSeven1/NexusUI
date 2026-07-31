import { NextRequest, NextResponse } from "next/server";
import { getDronePlatformBaseUrl } from "@/lib/drone-platform-base-url";
import {
  resolveDroneFlightHeightFromBody,
  resolveDroneFlightSpeedFromBody,
} from "@/lib/drone-task-settings";
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

type FlyWaypoint = { longitude: number; latitude: number; height: number; speed: number };

function parseWaypointsFromBody(
  body: Record<string, unknown>,
  height: number,
  speed: number,
): FlyWaypoint[] | null {
  const raw = body.waypoints;
  if (Array.isArray(raw) && raw.length > 0) {
    const out: FlyWaypoint[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const lat = typeof o.latitude === "number" ? o.latitude : Number(o.latitude);
      const lon = typeof o.longitude === "number" ? o.longitude : Number(o.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const h =
        o.height != null && Number.isFinite(Number(o.height)) ? Number(o.height) : height;
      const s =
        o.speed != null && Number.isFinite(Number(o.speed)) ? Number(o.speed) : speed;
      out.push({
        longitude: Math.round(lon * 1e6) / 1e6,
        latitude: Math.round(lat * 1e6) / 1e6,
        height: h,
        speed: s,
      });
    }
    return out.length > 0 ? out : null;
  }

  const lat = typeof body.latitude === "number" ? body.latitude : Number(body.latitude);
  const lon = typeof body.longitude === "number" ? body.longitude : Number(body.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return [
    {
      longitude: Math.round(lon * 1e6) / 1e6,
      latitude: Math.round(lat * 1e6) / 1e6,
      height,
      speed,
    },
  ];
}

/**
 * WatchSys `uavctrlboard::sendSpotFlightRequest3`：
 * POST `UAV_TRACE_TASK`（即 `NEXUS_UAV_TASK_API_BASE_URL/api/v1/tasks`），`type.casia.tasks.v1.DroneFlyTo`。
 * 高度默认 100、速度默认 15（对应 C++ `m_nHeight` / `m_nSpeed`）。
 * `specification.deviceSn` 填 **机场（机巢）gateway SN**（与 WatchSys 一致），非机体 SN。
 * 支持单点（`latitude`/`longitude`）或折线（`waypoints: [{latitude,longitude},...]`）。
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

  if (!airportSN) {
    return NextResponse.json({ ok: false, error: "airportSN_required" }, { status: 400 });
  }
  if (airportSN === "whzdh01") {
    return NextResponse.json({ ok: false, error: "whzdh01_skipped" }, { status: 400 });
  }

  const taskBase = getUavTaskApiBase();
  if (!taskBase) {
    return NextResponse.json(
      { ok: false, error: "missing_NEXUS_UAV_TASK_API_BASE_URL" },
      { status: 503 },
    );
  }

  const height = resolveDroneFlightHeightFromBody(body, readEnvInt("NEXUS_UAV_SPOT_FLY_HEIGHT_M", 100));
  const speed = resolveDroneFlightSpeedFromBody(body, readEnvInt("NEXUS_UAV_SPOT_FLY_SPEED", 15));
  const taskWorkMode = readEnvInt("NEXUS_UAV_SPOT_FLY_TASK_WORK_MODE", 0);

  const waypoints = parseWaypointsFromBody(body, height, speed);
  if (!waypoints) {
    return NextResponse.json({ ok: false, error: "invalid_lat_lon_or_waypoints" }, { status: 400 });
  }

  const taskId = `flightsubtask_${tsFlightsubtask()}`;

  const taskJson: Record<string, unknown> = {
    taskId,
    parentTaskId: "",
    version: { definitionVersion: 1, statusVersion: 1 },
    displayName: "无人机多点飞行任务",
    taskType: "AUTOMATIC",
    maxExecutionTimeMs: 10000,
    specification: {
      "@type": "type.casia.tasks.v1.DroneFlyTo",
      waypoints,
      deviceSn: airportSN,
      transition_distance: 5,
      mode: 1,
      taskWorkMode,
    },
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
      "[api/uav-task/spot-fly] 转发任务服务 POST",
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
      "uav_spot_fly_task",
    );
    const txt = await res.text().catch(() => "");
    const ok = isUavTaskServiceResponseOk(res.ok, txt);
    if (!ok) {
      console.warn("[api/uav-task/spot-fly] 任务服务拒绝或失败 HTTP=", res.status, txt.slice(0, 500));
    } else {
      console.info("[api/uav-task/spot-fly] 任务服务 HTTP", res.status, "响应前 400 字:", txt.slice(0, 400));
    }
    return NextResponse.json(
      {
        ok,
        status: res.status,
        detail: txt.slice(0, 800),
        url,
        /** 便于浏览器控制台对照：与发往任务服务的 specification 一致（非完整 envelope） */
        specification: taskJson.specification,
      },
      { status: ok ? 200 : 502 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "uav_spot_fly_exception", detail: msg }, { status: 500 });
  }
}
