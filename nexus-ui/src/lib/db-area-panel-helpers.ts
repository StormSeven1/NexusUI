import type { AreaTableRow } from "@/lib/area-table-geometry";
import { areaRowToPolygonRing, dbAreaVisibilityKey, lineFromAreaRoute } from "@/lib/area-table-geometry";
import {
  dbAreaTargetVisibilityKey,
  isDbAreaTargetListable,
} from "@/lib/db-area-target-geometry";
import { syncMasterOffWhenAllLeavesOff } from "@/lib/panel-tree-visibility";

/** Postgres 区域子项是否可见（缺省 false，须用户在图层面板显式开启） */
export function isDbAreaLeafVisible(
  groupId: number,
  areaId: number,
  areaVisibility: Readonly<Record<string, boolean>>,
): boolean {
  return areaVisibility[dbAreaVisibilityKey(groupId, areaId)] === true;
}
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

/** 总开关开时，当前应绘制的区域条数（与地图一致，含航线） */
export function countVisibleDbAreaLeaves(
  rows: ReadonlyArray<AreaTableRow>,
  areaVisibility: Readonly<Record<string, boolean>>,
  layerMasterOn: boolean,
): number {
  if (!layerMasterOn) return 0;
  let n = 0;
  for (const r of rows) {
    if (!isDbAreaListable(r)) continue;
    if (areaVisibility[dbAreaVisibilityKey(r.group_id, r.area_id)] !== true) continue;
    n += 1;
  }
  return n;
}

/** 总开关开时，当前应绘制的固定目标条数 */
export function countVisibleDbAreaTargetLeaves(
  rows: ReadonlyArray<{
    id: string;
    area_type: number;
    start_point?: string | null;
    end_point?: string | null;
    area_rect?: string | null;
    area_points?: string | null;
    target_id?: number;
    area_name?: string;
  }>,
  targetVisibility: Readonly<Record<string, boolean>>,
  layerMasterOn: boolean,
): number {
  if (!layerMasterOn) return 0;
  let n = 0;
  for (const r of rows) {
    if (!isDbAreaTargetListable(r)) continue;
    if (targetVisibility[dbAreaTargetVisibilityKey(r.id)] !== true) continue;
    n += 1;
  }
  return n;
}

/**
 * 区域图层母开关与子项双向同步：
 * - 任一子项开启（含固定目标）→ 打开母开关（否则地图 `lyr-db-areas` 总闸会挡住 GeoJSON）
 * - 全部子项关闭 → 关闭母开关
 */
export function syncDbAreaLayerMasterFromLeaves(
  masterOn: boolean,
  rows: ReadonlyArray<AreaTableRow>,
  areaVisibility: Readonly<Record<string, boolean>>,
  setMasterOn: (on: boolean) => void,
  fixedTargetRows?: ReadonlyArray<{ id: string; area_type: number }>,
  targetVisibility?: Readonly<Record<string, boolean>>,
): void {
  const listable = rows.filter(isDbAreaListable);
  const anyAreaOn = listable.some((r) =>
    isDbAreaLeafVisible(r.group_id, r.area_id, areaVisibility),
  );
  let anyFixedOn = false;
  if (fixedTargetRows && targetVisibility) {
    for (const r of fixedTargetRows) {
      if (targetVisibility[dbAreaTargetVisibilityKey(r.id)] === true) {
        anyFixedOn = true;
        break;
      }
    }
  }
  const anyOn = anyAreaOn || anyFixedOn;
  if (listable.length === 0 && !(fixedTargetRows && fixedTargetRows.length > 0)) return;
  if (anyOn && !masterOn) setMasterOn(true);
  else syncMasterOffWhenAllLeavesOff(masterOn, anyOn, setMasterOn);
}

/**
 * 图层面板「区域图层」块行数：总开关 1 + 每组 1 行 + 每条可绘区域 1 行（不含固定目标）。
 */
export function countDbAreaPanelUiRows(rows: ReadonlyArray<AreaTableRow>): number {
  const listable = rows.filter(isDbAreaListable);
  if (listable.length === 0) return 0;
  const groupCount = new Set(listable.map((r) => r.group_id)).size;
  return 1 + groupCount + listable.length;
}

