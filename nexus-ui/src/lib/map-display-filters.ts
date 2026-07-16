import { normalizeAssetType } from "@/lib/map-entity-model";
import type { AreaTableRow } from "@/lib/area-table-geometry";

export const EXCLUDE_RADAR_IDS = new Set<string>(["radar-004"]);

export const EXCLUDE_CAMERA_IDS = new Set<string>([
  "camera_000",
  "camera_002",
  "camera_003",
  "camera_005",
  "camera_006",
  "camera_007",
  "camera_009",
  "camera_010",
  "camera_011",
  "camera_012",
  "camera_013",
  "camera_014",
  "camera_015",
  "camera_016",
  "camera_017",
  "camera_018",
  "camera_019",
]);

export const EXCLUDE_TOWER_IDS = new Set<string>([]);
export const EXCLUDE_LASER_IDS = new Set<string>([]);
export const EXCLUDE_TDOA_IDS = new Set<string>([]);
export const EXCLUDE_AIRPORT_IDS = new Set<string>(["whzdh01"]);
export const EXCLUDE_DRONE_IDS = new Set<string>(["uav_jo-001"]);
export const EXCLUDE_DRONE_NAMES = new Set<string>(["远遥码头"]);
// 这里统一填写无人机实体 ID（asset.id / entityId）
export const HIDE_RENDER_DRONE_ENTITY_IDS = new Set<string>(["uav-005", "uav-006", "uav-007"]);

export function shouldHideDroneEntityId(entityId: string): boolean {
  const id = String(entityId ?? "").trim();
  if (!id) return false;
  return HIDE_RENDER_DRONE_ENTITY_IDS.has(id);
}

/**
 * 注册区域/航线显示过滤：
 * - 当前正式链路是 `Custombackend WS DbAreas -> db-area-store -> Map2D/Map3D`
 * - 这里只按 `area_name / group_name` 做白名单子串过滤
 * - 白名单为空时不过滤注册区域
 */
export const ZONE_NAME_SUBSTRING_ALLOWLIST: readonly string[] = ["港口防卫告警区"];

const zoneNameSubstringAllowSet =
  ZONE_NAME_SUBSTRING_ALLOWLIST.length > 0
    ? new Set(ZONE_NAME_SUBSTRING_ALLOWLIST.map((s) => String(s).trim()).filter(Boolean))
    : null;

function isExcludedAirportId(id: string): boolean {
  const tid = String(id).trim();
  if (!tid) return false;
  if (EXCLUDE_AIRPORT_IDS.has(tid)) return true;
  const p = /^airport_(.+)$/i.exec(tid);
  if (p) return EXCLUDE_AIRPORT_IDS.has(p[1]);
  return false;
}

export function shouldDisplayAssetId(assetType: string, id: string, name?: string | null): boolean {
  const tid = String(id).trim();
  if (!tid) return true;
  const atTrim = String(assetType ?? "").trim();
  if (!atTrim) return true;
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
 * 注册区域过滤只处理 `DbAreas` 行，不再处理旧 `zone/zones` 结构。
 */
export function shouldDisplayDbArea(row: Pick<AreaTableRow, "area_name" | "group_name">): boolean {
  const names = [String(row.area_name ?? "").trim(), String(row.group_name ?? "").trim()].filter(Boolean);
  if (names.length === 0) return true;
  if (!zoneNameSubstringAllowSet) return true;
  return names.some((name) => [...zoneNameSubstringAllowSet].some((item) => name.includes(item)));
}
