import type { AreaTableRow } from "@/lib/area-table-geometry";
import { dbAreaVisibilityKey } from "@/lib/area-table-geometry";
import { buildDbAreasFeatureCollection } from "@/lib/build-db-areas-geojson";
import { DEFAULT_AREA_LAYER_LINE_WIDTH } from "@/lib/distance-ring-settings";

/** 智能助手 chat_notification 触发的区域告警闪烁时长 */
export const AREA_ALERT_FLASH_MS = 20_000;

/** 闪烁高亮色（覆盖态势配色） */
export const AREA_ALERT_FLASH_COLOR = "#ff8c00";

export function normalizeAreaDisplayName(name: string): string {
  return name.trim();
}

/** 按 `area_name` 精确匹配（中文名） */
export function findDbAreaRowsByAreaName(
  rows: ReadonlyArray<AreaTableRow>,
  areaName: string,
): AreaTableRow[] {
  const target = normalizeAreaDisplayName(areaName);
  if (!target) return [];
  return rows.filter((r) => {
    const n = r.area_name != null ? String(r.area_name).trim() : "";
    return n.length > 0 && n === target;
  });
}

export function isDbAreaKeyFlashing(
  areaFlashUntil: Readonly<Record<string, number>>,
  groupId: number,
  areaId: number,
  now = Date.now(),
): boolean {
  const until = areaFlashUntil[dbAreaVisibilityKey(groupId, areaId)];
  return until != null && until > now;
}

export function hasAnyActiveAreaFlash(
  areaFlashUntil: Readonly<Record<string, number>>,
  now = Date.now(),
): boolean {
  for (const until of Object.values(areaFlashUntil)) {
    if (until > now) return true;
  }
  return false;
}

/** 800ms 周期脉冲，用于线框/标注透明度 */
export function computeAreaFlashPulseOpacity(elapsedMs: number): number {
  const period = 800;
  const phase = (elapsedMs % period) / period;
  return 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2));
}

export function buildDbAreasFlashFeatureCollection(
  rows: ReadonlyArray<AreaTableRow>,
  areaFlashUntil: Readonly<Record<string, number>>,
  now = Date.now(),
): GeoJSON.FeatureCollection {
  return buildDbAreasFeatureCollection(
    [...rows],
    (row) => isDbAreaKeyFlashing(areaFlashUntil, row.group_id, row.area_id, now),
    {
      lineColor: AREA_ALERT_FLASH_COLOR,
      lineOpacity: 1,
      labelOpacity: 1,
      lineWidth: DEFAULT_AREA_LAYER_LINE_WIDTH + 2,
      lineStyle: "solid",
      lineDash: null,
    },
    { applyStyleToRoutes: true },
  );
}
