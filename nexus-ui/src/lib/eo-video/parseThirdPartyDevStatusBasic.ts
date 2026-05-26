/**
 * UDP `MSG_DEV_STATUS_BASIC`（0x1001）JSON 基础状态。
 * 对齐 Qt `HighSpeedCameraController`：`pan` / `tilt` / 可选 `zoom`。
 */

export type ThirdPartyDevStatusBasic = {
  pan: number;
  tilt: number;
  /** 载车/平台真北方位角（度），地图视场扇形朝向以此为准 */
  panVehicle?: number;
  /** JSON 无 zoom 或无效时为 undefined（沿用本地默认） */
  zoom?: number;
};

function num(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 从 0x1001 载荷解析 pan/tilt/panVehicle/zoom；无任何可识别键时返回 undefined */
export function parseThirdPartyDevStatusBasicFromPayload(
  d: Record<string, unknown>,
): ThirdPartyDevStatusBasic | undefined {
  const hasPan = "pan" in d;
  const hasTilt = "tilt" in d;
  const hasPanVehicle = "panVehicle" in d;
  if (!hasPan && !hasTilt && !hasPanVehicle) return undefined;
  const pan = num(d.pan) ?? 0;
  const tilt = num(d.tilt) ?? 0;
  const panVehicleRaw = num(d.panVehicle);
  const panVehicle = panVehicleRaw !== undefined ? panVehicleRaw : undefined;
  const zoomRaw = num(d.zoom);
  const zoom = zoomRaw !== undefined && zoomRaw >= 0 ? zoomRaw : undefined;
  return { pan, tilt, panVehicle, zoom };
}
