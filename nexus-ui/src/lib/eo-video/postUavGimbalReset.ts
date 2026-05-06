"use client";

/** 与 Qt `PtzMainWidget::onUavCamCtrl` 特殊机型一致 */
const SPECIAL_DRONE_SN = "1581F6QAD241200BWX4E";

export function uavMainPayloadIndexForDrone(droneSn: string): string {
  const dr = droneSn.trim();
  return dr === SPECIAL_DRONE_SN ? "80-0-0" : "81-0-0";
}

export type PostUavGimbalResetResult = {
  ok: boolean;
  message?: string;
  detail?: string;
  error?: string;
};

/**
 * 云台回中/向下（`reset_mode`：0 回中，1 向下）。
 * `deviceSn` 对齐 C++ `m_droneSNAndAirportSNMap[..].back()`，一般为机场网关 SN。
 */
export async function postUavGimbalReset(args: {
  deviceSn: string;
  payloadIndex: string;
  resetMode: 0 | 1;
}): Promise<PostUavGimbalResetResult> {
  const res = await fetch("/api/uav-live/gimbal-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      deviceSn: args.deviceSn.trim(),
      payloadIndex: args.payloadIndex.trim(),
      resetMode: args.resetMode,
    }),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let json: PostUavGimbalResetResult | null = null;
  try {
    json = text ? (JSON.parse(text) as PostUavGimbalResetResult) : null;
  } catch {
    json = { ok: false, detail: text.slice(0, 400) };
  }
  if (!json) return { ok: false, detail: text.slice(0, 400) };
  return json;
}
