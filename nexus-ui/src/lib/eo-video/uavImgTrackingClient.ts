"use client";

import { getDroneTaskFlightParams } from "@/stores/drone-task-settings-store";

export type UavImgTrackingResult = {
  ok: boolean;
  status?: number;
  error?: string;
  detail?: string;
  url?: string;
  taskId?: string;
  specification?: unknown;
};

/**
 * WatchSys `PtzMainWidget::SendUavFlightTask`（`rectID`>0）→ `type.casia.tasks.v1.DroneIMGTracking`。
 * `videoDetectType`：0 海上 / 1 空中（与 Qt `rectType` 入参一致）。
 */
export async function postUavImgTrackingTask(args: {
  airportSN: string;
  rectId: number;
  videoDetectType: 0 | 1;
}): Promise<UavImgTrackingResult> {
  const PATH = "/api/uav-task/img-tracking";
  const { flightHeight } = getDroneTaskFlightParams();
  const clientBody = {
    airportSN: args.airportSN.trim(),
    rectId: args.rectId,
    videoDetectType: args.videoDetectType,
    height: flightHeight,
  };
  const res = await fetch(PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(clientBody),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let json: UavImgTrackingResult | null = null;
  try {
    json = text ? (JSON.parse(text) as UavImgTrackingResult) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = json?.detail || json?.error || text.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (!json) throw new Error("uav_img_tracking_invalid_response");
  if (json.ok !== true) {
    throw new Error(json.detail || json.error || "uav_img_tracking_not_ok");
  }
  return json;
}
