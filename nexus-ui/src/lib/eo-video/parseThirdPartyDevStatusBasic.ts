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
  /** `params.lat` / `params.lon`（8090 坐标系） */
  lat?: number;
  lng?: number;
};

function num(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * 现场 0x1001 常见形态：`{ entityId, params: { pan, tilt, panVehicle, ... } }`；
 * 旧版/Qt 仍可能把 pan/tilt 放在根级，根级键优先于 `params`。
 */
function mergeDevStatusFields(d: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...asRecord(d.params) };
  for (const k of ["pan", "tilt", "panVehicle", "tiltVehicle", "zoom"] as const) {
    if (k in d) merged[k] = d[k];
  }
  return merged;
}

/** 从 0x1001 载荷解析 pan/tilt/panVehicle/zoom；无任何可识别键时返回 undefined */
export function parseThirdPartyDevStatusBasicFromPayload(
  d: Record<string, unknown>,
): ThirdPartyDevStatusBasic | undefined {
  const src = mergeDevStatusFields(d);
  const hasPan = "pan" in src;
  const hasTilt = "tilt" in src;
  const hasPanVehicle = "panVehicle" in src;
  if (!hasPan && !hasTilt && !hasPanVehicle) return undefined;
  const pan = num(src.pan) ?? 0;
  const tilt = num(src.tilt) ?? 0;
  const panVehicleRaw = num(src.panVehicle);
  const panVehicle = panVehicleRaw !== undefined ? panVehicleRaw : undefined;
  const zoomRaw = num(src.zoom);
  const zoom = zoomRaw !== undefined && zoomRaw >= 0 ? zoomRaw : undefined;
  const lat = num(src.lat);
  const lng = num(src.lon ?? src.lng);
  return {
    pan,
    tilt,
    panVehicle,
    zoom,
    ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
  };
}
