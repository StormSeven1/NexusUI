/**
 * 地图实体 / 区域显示过滤
 *
 * 标准光电 `camera_NNN`：优先读 `app-config.json` → `cameraManagement` 对海/对空槽位白名单
 *（`loadResolvedAppConfig` 写入）；未加载前回退 **18.141 黑名单**（仅 001 + 004 可见）。
 * 8090 第三方相机（`camera-hs-*` 等）不受白名单限制。
 *
 * 修改后需重新构建前端。
 */

import { canonicalEntityId } from "@/lib/camera-entity-id";
import { isThirdPartyCameraEntityId } from "@/lib/eo-video/thirdPartyEntityId";
import { normalizeAssetType } from "@/lib/map-entity-model";

// ── 雷达：entityId 黑名单（供现场配置过滤不需要显示的雷达）──
export const EXCLUDE_RADAR_IDS = new Set<string>(["radar-004"]);

// ── 相机 / 电侦塔（18.141 无对应 id 黑名单；仅虚兵 deviceId 表，此处保留 id 黑名单供现场配置）──
/** 18.141 回退：未加载 app-config 前仅显示 001 + 004 */
export const EXCLUDE_CAMERA_IDS = new Set<string>(["camera_000","camera_002","camera_003","camera_005","camera_006","camera_007","camera_008","camera_009","camera_010","camera_011","camera_012","camera_013","camera_014","camera_015","camera_016","camera_017","camera_018","camera_019"]);

/** `cameraManagement` 解析后写入；28.9 典型为 `camera_004` + `camera_008` */
let mapFovCameraAllowlist: ReadonlySet<string> | null = null;

export function setMapFovCameraAllowlist(ids: ReadonlyArray<string> | null | undefined): void {
  if (!ids?.length) {
    mapFovCameraAllowlist = null;
    return;
  }
  const next = new Set<string>();
  for (const raw of ids) {
    const id = canonicalEntityId(String(raw ?? "").trim());
    if (id) next.add(id);
  }
  mapFovCameraAllowlist = next.size > 0 ? next : null;
}

export function getMapFovCameraAllowlist(): ReadonlySet<string> | null {
  return mapFovCameraAllowlist;
}

/** 标准光电是否允许上地图 / 图层面板 FOV（第三方相机另判） */
export function isStandardOptoCameraAllowedOnMap(entityId: string): boolean {
  const id = canonicalEntityId(String(entityId ?? "").trim());
  if (!id) return false;
  if (mapFovCameraAllowlist) return mapFovCameraAllowlist.has(id);
  return !EXCLUDE_CAMERA_IDS.has(id);
}

/** 与 `isStandardOptoCameraAllowedOnMap` 同义；保留旧名供图层面板/FOV 模块引用 */
export const isMapFovCameraAllowed = isStandardOptoCameraAllowedOnMap;

// ── 电侦塔：独立黑名单（如需与相机分开过滤可在此配置）──
export const EXCLUDE_TOWER_IDS = new Set<string>([]);

// ── 激光：entityId 黑名单（供现场配置过滤不需要显示的激光武器）──
export const EXCLUDE_LASER_IDS = new Set<string>([]);

// ── TDOA：entityId 黑名单（供现场配置过滤不需要显示的 TDOA 设备）──
export const EXCLUDE_TDOA_IDS = new Set<string>([]);

/** 机场：dockSn 黑名单（useUnifiedWsFeed 中 airportId = ap.dockSn；支持 `airport_${sn}` 写法） */
export const EXCLUDE_AIRPORT_IDS = new Set<string>(["whzdh01"]);

/** 无人机：deviceSn 黑名单（useUnifiedWsFeed 中 droneAssetId = dr.deviceSn，与机场用 dockSn 一致） */
export const EXCLUDE_DRONE_IDS = new Set<string>(["uav_jo-001"]);

/**
 * 无人机：**显示名**精确匹配则隐藏（与 entityStore `EXCLUDED_DRONE_NAMES` 一致）
 * 对应 WS/实体里 `name` / `droneName`。
 */
export const EXCLUDE_DRONE_NAMES = new Set<string>(["远遥码头"]);

function isExcludedAirportId(id: string): boolean {
  const tid = String(id).trim();
  if (!tid) return false;
  if (EXCLUDE_AIRPORT_IDS.has(tid)) return true;
  const p = /^airport_(.+)$/i.exec(tid);
  if (p) return EXCLUDE_AIRPORT_IDS.has(p[1]);
  return false;
}

/**
 * 是否显示该资产（id + 可选 name；无人机名称过滤需传入 `name`）
 */
export function shouldDisplayAssetId(assetType: string, id: string, name?: string | null): boolean {
  const tid = String(id).trim();
  if (!tid) return true;
  const atTrim = String(assetType ?? "").trim();
  if (!atTrim) return true; /* asset_type 为空时不过滤，由上游保证有值 */
  const t = normalizeAssetType(atTrim);
  if (t === "radar") return !EXCLUDE_RADAR_IDS.has(tid);
  if (t === "camera") {
    if (isThirdPartyCameraEntityId(tid)) return true;
    return isStandardOptoCameraAllowedOnMap(tid);
  }
  if (t === "tower") return !EXCLUDE_TOWER_IDS.has(tid);
  if (t === "laser") return !EXCLUDE_LASER_IDS.has(tid);
  if (t === "tdoa") return !EXCLUDE_TDOA_IDS.has(tid);
  if (t === "airport") return !isExcludedAirportId(tid);
  if (t === "drone") {
    if (EXCLUDE_DRONE_IDS.has(tid)) return false;
    const n = String(name ?? "").trim();
    if (n && EXCLUDE_DRONE_NAMES.has(n)) return false;
    return true;
  }
  return true;
}
