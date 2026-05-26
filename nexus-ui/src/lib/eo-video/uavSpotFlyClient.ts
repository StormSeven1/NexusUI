"use client";

import { getDroneTaskFlightParams } from "@/stores/drone-task-settings-store";

export type UavSpotFlyResult = {
  ok: boolean;
  status?: number;
  error?: string;
  detail?: string;
  url?: string;
  /** Next 回传的 specification，便于与任务服务对照 */
  specification?: unknown;
};

const SPOT_FLY_RELATIVE_PATH = "/api/uav-task/spot-fly";

/** WatchSys `uavctrlboard::sendSpotFlightRequest3`：POST `{NEXUS_UAV_TASK_API_BASE_URL}/api/v1/tasks`，DroneFlyTo；`specification.deviceSn` 为机场 SN */
export async function postUavSpotFlyToTask(args: {
  latitude: number;
  longitude: number;
  /** 机巢 / 机场 gateway SN（写入任务 JSON 的 `deviceSn` 字段） */
  airportSN: string;
}): Promise<UavSpotFlyResult> {
  const { flightSpeed, flightHeight } = getDroneTaskFlightParams();
  const clientBody = {
    latitude: args.latitude,
    longitude: args.longitude,
    airportSN: args.airportSN.trim(),
    speed: flightSpeed,
    height: flightHeight,
  };
  const abs = typeof window !== "undefined" ? `${window.location.origin}${SPOT_FLY_RELATIVE_PATH}` : SPOT_FLY_RELATIVE_PATH;
  console.info("[uav-spot-fly] 浏览器 → Next API\n  URL:", abs, "\n  Body:", JSON.stringify(clientBody));

  const res = await fetch(SPOT_FLY_RELATIVE_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(clientBody),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let json: UavSpotFlyResult | null = null;
  try {
    json = text ? (JSON.parse(text) as UavSpotFlyResult) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    console.error("[uav-spot-fly] Next API 失败 HTTP", res.status, "raw:", text.slice(0, 500));
    const msg = json?.detail || json?.error || text.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (!json) throw new Error("uav_spot_fly_invalid_response");
  /** 上游或网关偶发 200 但体无 `ok` 字段时，原先 `Boolean(undefined)` 会在菜单里误判为失败且无日志 */
  if (json.ok !== true) {
    console.error("[uav-spot-fly] 业务未成功", json);
    const msg =
      json.detail || json.error || `uav_spot_fly_not_ok HTTP=${json.status ?? res.status} body=${text.slice(0, 200)}`;
    throw new Error(msg);
  }
  console.info(
    "[uav-spot-fly] Next → 任务服务（DroneFlyTo）\n  上游 URL:",
    json.url ?? "(无)",
    "\n  上游 HTTP:",
    json.status,
    "\n  specification:",
    json.specification != null ? JSON.stringify(json.specification) : "(无)",
    "\n  上游响应摘要:",
    (json.detail ?? text).slice(0, 600),
  );
  return json;
}
