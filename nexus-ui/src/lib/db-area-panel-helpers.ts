import type { AreaTableRow } from "@/lib/area-table-geometry";
import { areaRowToPolygonRing, dbAreaVisibilityKey, lineFromAreaRoute } from "@/lib/area-table-geometry";

/** 面状区域（矩形/圆/多边形）是否可上图 */
export function isDbAreaDrawable(row: AreaTableRow): boolean {
  const ring = areaRowToPolygonRing(row);
  return Boolean(ring && ring.length >= 4);
}

/** 列表/树是否展示（含航线折线） */
export function isDbAreaListable(row: AreaTableRow): boolean {
  if (row.area_type === 4) {
    const line = lineFromAreaRoute(row);
    return Boolean(line && line.length >= 2);
  }
  return isDbAreaDrawable(row);
}

/** 总开关开时，当前应绘制的区域条数（与地图一致） */
export function countVisibleDbAreaLeaves(
  rows: ReadonlyArray<AreaTableRow>,
  areaVisibility: Readonly<Record<string, boolean>>,
  layerMasterOn: boolean,
): number {
  if (!layerMasterOn) return 0;
  let n = 0;
  for (const r of rows) {
    if (!isDbAreaDrawable(r)) continue;
    if (areaVisibility[dbAreaVisibilityKey(r.group_id, r.area_id)] === false) continue;
    n += 1;
  }
  return n;
}

/**
 * 图层面板「区域图层」块行数：总开关 1 + 每组 1 行 + 每条可绘区域 1 行。
 */
export function countDbAreaPanelUiRows(rows: ReadonlyArray<AreaTableRow>): number {
  const drawable = rows.filter(isDbAreaDrawable);
  if (drawable.length === 0) return 0;
  const groupCount = new Set(drawable.map((r) => r.group_id)).size;
  return 1 + groupCount + drawable.length;
}
