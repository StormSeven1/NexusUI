"use client";

import { getDroneTaskFlightParams } from "@/stores/drone-task-settings-store";

export type UavTrackFollowResult = {
  ok: boolean;
  status?: number;
  error?: string;
  detail?: string;
  url?: string;
  specification?: unknown;
};

/**
 * WatchSys `PtzMainWidget::SendUavFlightTask`（`rectID`/`rectType` 为 -1、`targetSourceId` 0/9）→ `MultiDroneTracking`。
 */
export async function postUavTrackFollowTask(args: {
  /** 机巢 / 机场 gateway SN（任务 JSON `specification.deviceSn`） */
  airportSN: string;
  trackId: number;
  latitude: number;
  longitude: number;
  targetSourceId: number;
  mode?: number;
  rectID?: number;
  rectType?: number;
  traceMode?: number;
}): Promise<UavTrackFollowResult> {
  const PATH = "/api/uav-task/track-follow";
  const { flightHeight } = getDroneTaskFlightParams();
  const clientBody = {
    airportSN: args.airportSN.trim(),
    trackId: args.trackId,
    latitude: args.latitude,
    longitude: args.longitude,
    targetSourceId: args.targetSourceId,
    mode: args.mode ?? 1,
    rectID: args.rectID ?? -1,
    rectType: args.rectType ?? -1,
    traceMode: args.traceMode ?? 0,
    height: flightHeight,
  };
  const abs = typeof window !== "undefined" ? `${window.location.origin}${PATH}` : PATH;
  console.info("[uav-track-follow] 浏览器 → Next API\n  URL:", abs, "\n  Body:", JSON.stringify(clientBody));

  const res = await fetch(PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(clientBody),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let json: UavTrackFollowResult | null = null;
  try {
    json = text ? (JSON.parse(text) as UavTrackFollowResult) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    console.error("[uav-track-follow] Next API 失败 HTTP", res.status, "raw:", text.slice(0, 500));
    const msg = json?.detail || json?.error || text.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (!json) throw new Error("uav_track_follow_invalid_response");
  if (json.ok !== true) {
    console.error("[uav-track-follow] 业务未成功", json);
    const msg =
      json.detail ||
      json.error ||
      `uav_track_follow_not_ok HTTP=${json.status ?? res.status} body=${text.slice(0, 200)}`;
    throw new Error(msg);
  }
  console.info(
    "[uav-track-follow] Next → 任务服务\n  上游 URL:",
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
