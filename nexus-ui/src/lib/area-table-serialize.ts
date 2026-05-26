/**
 * 将地图绘制结果序列化为 `area_table` 字段（lat,lng 顺序与 WatchSys / C++ 一致）。
 */

export type AreaDrawShape = "rect" | "circle" | "polygon" | "route";

export type LngLat = { lng: number; lat: number };

/** area_type：1 矩形，2 圆，3 多边形，4 航线 */
export const ROUTE_AREA_TYPE = 4;

export function shapeToAreaType(shape: AreaDrawShape): 1 | 2 | 3 | 4 {
  switch (shape) {
    case "rect":
      return 1;
    case "circle":
      return 2;
    case "polygon":
      return 3;
    case "route":
      return 4;
  }
}

/** 航线固定分组 */
export const ROUTE_AREA_GROUP_ID = 0;

/** 圆形存库：area_rect / area_points 固定占位（与桌面端约定一致） */
export const CIRCLE_AREA_RECT_ZEROS = "0.00000,0.00000,0.00000,0.00000";
export const CIRCLE_AREA_POINTS_ZERO = "0";
/** 圆形默认边色（RGB，写入 line_color 列） */
export const CIRCLE_AREA_LINE_COLOR = "255,255,0";

function fmt(n: number): string {
  return Number(n.toFixed(8)).toString();
}

/** 矩形对角：lat1,lng1,lat2,lng2 */
export function serializeAreaRect(a: LngLat, b: LngLat): string {
  return `${fmt(a.lat)},${fmt(a.lng)},${fmt(b.lat)},${fmt(b.lng)}`;
}

/** 圆心 + 圆周点：各为 lat,lng */
export function serializeCircle(center: LngLat, edge: LngLat): { start_point: string; end_point: string } {
  return {
    start_point: `${fmt(center.lat)},${fmt(center.lng)}`,
    end_point: `${fmt(edge.lat)},${fmt(edge.lng)}`,
  };
}

/** 多边形：N,lat1,lng1,... */
export function serializeAreaPoints(points: LngLat[]): string {
  const n = points.length;
  const parts: string[] = [String(n)];
  for (const p of points) {
    parts.push(fmt(p.lat), fmt(p.lng));
  }
  return parts.join(",");
}

/** 航线：首点 start_point + 全路径 area_points（N,lat,lng,...） */
export function serializeRoute(points: LngLat[]): { start_point: string; area_points: string } {
  const first = points[0]!;
  return {
    start_point: `${fmt(first.lat)},${fmt(first.lng)}`,
    area_points: serializeAreaPoints(points),
  };
}

export type AreaGeometryPayload =
  | { area_type: 1; area_rect: string }
  | {
      area_type: 2;
      start_point: string;
      end_point: string;
      area_rect: string;
      area_points: string;
    }
  | { area_type: 3; area_points: string }
  | { area_type: 4; start_point: string; area_points: string };

export function buildAreaGeometryPayload(shape: AreaDrawShape, points: LngLat[]): AreaGeometryPayload | null {
  if (shape === "rect") {
    if (points.length < 2) return null;
    const a = points[0]!;
    const b = points[1]!;
    return { area_type: 1, area_rect: serializeAreaRect(a, b) };
  }
  if (shape === "circle") {
    if (points.length < 2) return null;
    const { start_point, end_point } = serializeCircle(points[0]!, points[1]!);
    return {
      area_type: 2,
      start_point,
      end_point,
      area_rect: CIRCLE_AREA_RECT_ZEROS,
      area_points: CIRCLE_AREA_POINTS_ZERO,
    };
  }
  if (shape === "route") {
    if (points.length < 2) return null;
    return { area_type: 4, ...serializeRoute(points) };
  }
  if (points.length < 3) return null;
  return { area_type: 3, area_points: serializeAreaPoints(points) };
}

/** 从现有行推算下一 area_id（保存前默认名用） */
export function nextAreaIdForGroup(rows: { group_id: number; area_id: number }[], groupId: number): number {
  let max = 0;
  for (const r of rows) {
    if (r.group_id === groupId && r.area_id > max) max = r.area_id;
  }
  return max + 1;
}

/** 从现有行推算下一 group_id（新建分组） */
export function nextGroupId(rows: { group_id: number }[]): number {
  let max = 0;
  for (const r of rows) {
    if (r.group_id > max) max = r.group_id;
  }
  return max + 1;
}

/** 无自定义 `area_name` 时的展示名：区域 `区域-{groupId}-{areaId}`，航线 `航线-{groupId}-{areaId}` */
export function mapAreaFallbackLabel(groupId: number, areaId: number, areaType: number): string {
  return areaType === ROUTE_AREA_TYPE
    ? `航线-${groupId}-${areaId}`
    : `区域-${groupId}-${areaId}`;
}

/** 标绘保存弹窗默认名称（按形状推断 area_type） */
export function defaultAreaDisplayName(
  groupId: number,
  areaId: number,
  shape?: AreaDrawShape,
): string {
  return mapAreaFallbackLabel(groupId, areaId, shape === "route" ? ROUTE_AREA_TYPE : 1);
}
