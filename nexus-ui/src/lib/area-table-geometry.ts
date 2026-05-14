/**
 * 解析 WatchSys `area_table` 中与 C++ `AreaInfo` 一致的几何字段（lat,lng 顺序与桌面端约定一致）。
 * - area_type 1：area_rect = lat1,lng1,lat2,lng2（矩形对角）
 * - area_type 2：start_point = 圆心 lat,lng；end_point = 圆周上一点 lat,lng
 * - area_type 3：area_points = N,lat1,lng1,...（首段为点数）
 */

import { geoCircleCoords } from "@/lib/map-icons";

export type AreaTableRow = {
  group_id: number;
  area_id: number;
  area_name?: string | null;
  group_name?: string | null;
  area_type: number;
  start_point?: string | null;
  end_point?: string | null;
  area_rect?: string | null;
  area_points?: string | null;
  line_color?: string | null;
  line_width?: number | null;
};

function parseNums(s: string | null | undefined): number[] {
  if (s == null || !String(s).trim()) return [];
  return String(s)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));
}

/** 单点 "lat,lng" */
export function parseLatLngPair(s: string | null | undefined): { lat: number; lng: number } | null {
  const nums = parseNums(s);
  if (nums.length < 2) return null;
  return { lat: nums[0], lng: nums[1] };
}

/** GeoJSON 外环 [lng,lat][]，自动闭合 */
function closeRing(ring: [number, number][]): [number, number][] {
  if (ring.length === 0) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return ring;
  return [...ring, a];
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLng = (lng2 - lng1) * toR;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 矩形：lat1,lng1,lat2,lng2 → 轴对齐矩形环（WGS84 小范围近似） */
export function ringFromAreaRect(areaRect: string | null | undefined): [number, number][] | null {
  const nums = parseNums(areaRect);
  if (nums.length < 4) return null;
  const lat1 = nums[0];
  const lng1 = nums[1];
  const lat2 = nums[2];
  const lng2 = nums[3];
  const minLat = Math.min(lat1, lat2);
  const maxLat = Math.max(lat1, lat2);
  const minLng = Math.min(lng1, lng2);
  const maxLng = Math.max(lng1, lng2);
  return closeRing([
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
  ]);
}

/** 圆：圆心 + 边缘一点 → 近似圆（64 段） */
export function ringFromCircle(
  startPoint: string | null | undefined,
  endPoint: string | null | undefined,
): [number, number][] | null {
  const c = parseLatLngPair(startPoint);
  const e = parseLatLngPair(endPoint);
  if (!c || !e) return null;
  const radiusKm = haversineKm(c.lat, c.lng, e.lat, e.lng);
  if (!(radiusKm > 0)) return null;
  return closeRing(geoCircleCoords(c.lng, c.lat, radiusKm, 64));
}

/** 多边形：N,lat1,lng1,... */
export function ringFromAreaPoints(areaPoints: string | null | undefined): [number, number][] | null {
  const nums = parseNums(areaPoints);
  if (nums.length < 3) return null;
  const n = Math.floor(nums[0]);
  if (n < 3 || nums.length < 1 + n * 2) return null;
  const ring: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const lat = nums[1 + i * 2];
    const lng = nums[2 + i * 2];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    ring.push([lng, lat]);
  }
  return closeRing(ring);
}

export function areaRowToPolygonRing(row: AreaTableRow): [number, number][] | null {
  switch (row.area_type) {
    case 1:
      return ringFromAreaRect(row.area_rect);
    case 2:
      return ringFromCircle(row.start_point, row.end_point);
    case 3:
      return ringFromAreaPoints(row.area_points);
    default:
      return null;
  }
}

export function dbAreaFeatureId(row: Pick<AreaTableRow, "group_id" | "area_id">): string {
  return `db-area-${row.group_id}-${row.area_id}`;
}

/** 面板与显隐 store 用：`group_id` + `area_id` 唯一（API/JSON 可能给字符串，统一成数字键避免读写对不上） */
export function dbAreaVisibilityKey(groupId: number | string, areaId: number | string): string {
  const g = Number(groupId);
  const a = Number(areaId);
  if (Number.isFinite(g) && Number.isFinite(a)) return `${g}:${a}`;
  return `${String(groupId)}:${String(areaId)}`;
}
