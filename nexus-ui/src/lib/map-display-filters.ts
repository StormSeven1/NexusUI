/**
 * 地图实体 / 区域显示过滤（硬编码，不读 app-config.json）
 *
 * 对齐 **18.141**：
 * - `front/src/stores/entityStore.js`：`EXCLUDED_DRONE_NAMES` / `EXCLUDED_AIRPORT_SNS`（入口过滤）
 * - `front/src/App.vue`（`Zones`）：按区域 **name** 子串白名单
 *
 * `DroneRenderer.js` 无「按 id 隐藏」列表；`ALERT_DRONE_SNS` 仅用于告警机关联机蓝色图标，不参与过滤。
 *
 * 修改后需重新构建前端。
 */

import { normalizeAssetType } from "@/lib/map-entity-model";

// ── 雷达：entityId 黑名单（供现场配置过滤不需要显示的雷达）──
export const EXCLUDE_RADAR_IDS = new Set<string>(["radar-004"]);

// ── 相机 / 电侦塔（18.141 无对应 id 黑名单；仅虚兵 deviceId 表，此处保留 id 黑名单供现场配置）──
export const EXCLUDE_CAMERA_IDS = new Set<string>(["camera_000","camera_002","camera_003","camera_005","camera_006","camera_007","camera_008","camera_009","camera_010","camera_011","camera_012","camera_013","camera_014","camera_015","camera_016","camera_017","camera_018","camera_019"]);

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

/**
 * 区域：**id** 白名单；空数组表示不按 id 过滤。
 * 若与非空 `ZONE_NAME_SUBSTRING_ALLOWLIST` 联用，需**同时**满足。
 */
export const ZONE_ID_ALLOWLIST: readonly string[] = [];

/**
 * 区域：**名称**需包含以下子串之一才显示（与 App.vue `Zones` 一致）。
 * 空数组表示**不按名称**过滤（仍可按 `ZONE_ID_ALLOWLIST` 过滤）。
 * 若需与 18.141 完全一致，保留默认两项；若需显示全部区域，改为 `[]`。
 */
export const ZONE_NAME_SUBSTRING_ALLOWLIST: readonly string[] = ["港外航道监控区"];

const zoneIdAllowSet =
  ZONE_ID_ALLOWLIST.length > 0 ? new Set(ZONE_ID_ALLOWLIST.map((s) => String(s).trim()).filter(Boolean)) : null;

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
  if (t === "camera") return !EXCLUDE_CAMERA_IDS.has(tid);
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

/**
 * 是否显示该区域（id + name；与 18.141 区域名过滤一致）
 */
export function shouldDisplayZone(z: { id: string; name?: string | null }): boolean {
  const zid = String(z.id).trim();
  if (!zid) return true;
  if (zoneIdAllowSet && !zoneIdAllowSet.has(zid)) return false;
  const subs = ZONE_NAME_SUBSTRING_ALLOWLIST;
  if (subs.length > 0) {
    const n = String(z.name ?? "");
    if (!subs.some((s) => s && n.includes(s))) return false;
  }
  return true;
}
