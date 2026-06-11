import type { AreaTableRow } from "@/lib/area-table-geometry";

/**
 * 区域/航线面板辅助函数。
 *
 * 这个文件只负责“面板是否要展示这条数据库区域记录”，
 * 不负责几何解析、不负责地图绘制、不负责显隐状态存储。
 */
export function isDbAreaListable(row: AreaTableRow | null | undefined): boolean {
  if (!row) return false;
  if (!Number.isFinite(Number(row.group_id))) return false;
  if (!Number.isFinite(Number(row.area_id))) return false;
  const areaType = Number(row.area_type);
  if (!Number.isFinite(areaType)) return false;
  return areaType >= 1 && areaType <= 4;
}
