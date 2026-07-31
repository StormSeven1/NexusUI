/**
 * 固定目标 `area_table_target` → 复用区域几何/GeoJSON 的适配。
 * 图层面板与显隐键独立于 `area_table`（`ft:<uuid>`）。
 */

import type { AreaTableRow } from "@/lib/area-table-geometry";
import { areaRowToPolygonRing } from "@/lib/area-table-geometry";
import type { AreaTableTargetRow } from "@/stores/db-area-target-store";

/** 伪 group_id，仅用于 GeoJSON feature id，避免与真实组别冲突 */
export const FIXED_TARGET_MAP_GROUP_ID = -1;

export function dbAreaTargetVisibilityKey(id: string): string {
  return `ft:${id}`;
}

/** 是否可上图（固定目标仅 1/2/3，无航线） */
export function isDbAreaTargetListable(row: {
  area_type: number;
  start_point?: string | null;
  end_point?: string | null;
  area_rect?: string | null;
  area_points?: string | null;
  target_id?: number;
  area_name?: string;
  id?: string;
}): boolean {
  const asArea = targetRowToAreaRow({
    id: row.id ?? "",
    area_name: row.area_name ?? "",
    target_id: row.target_id ?? 0,
    area_type: row.area_type,
    start_point: row.start_point,
    end_point: row.end_point,
    area_rect: row.area_rect,
    area_points: row.area_points,
  });
  const ring = areaRowToPolygonRing(asArea);
  return Boolean(ring && ring.length >= 4);
}

export function targetRowToAreaRow(row: AreaTableTargetRow): AreaTableRow {
  return {
    group_id: FIXED_TARGET_MAP_GROUP_ID,
    area_id: row.target_id,
    area_name: row.area_name,
    group_name: "固定目标",
    area_type: row.area_type,
    start_point: row.start_point,
    end_point: row.end_point,
    area_rect: row.area_rect,
    area_points: row.area_points,
  };
}

export function isDbAreaTargetLeafVisible(
  id: string,
  targetVisibility: Readonly<Record<string, boolean>>,
): boolean {
  return targetVisibility[dbAreaTargetVisibilityKey(id)] === true;
}
