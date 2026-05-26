import { pointAtBearingMeters } from "@/components/map/modules/radar-range-rings-maplibre";

/** 相邻顶点目标弦长（米），用于按周长自适应分段 */
const TARGET_CHORD_METERS = 60;
const MIN_SEGMENTS = 180;
const MAX_SEGMENTS = 720;

/** 按半径计算分段数，大圆更多顶点以保持视觉圆滑 */
export function geodesicCircleSegmentCount(radiusM: number): number {
  if (!Number.isFinite(radiusM) || radiusM <= 0) return MIN_SEGMENTS;
  const circumferenceM = 2 * Math.PI * radiusM;
  const n = Math.ceil(circumferenceM / TARGET_CHORD_METERS);
  return Math.min(MAX_SEGMENTS, Math.max(MIN_SEGMENTS, n));
}

/** 大地线闭合圆环 [lng, lat][]（首尾重复一点，适合 LineString / polyline） */
export function geodesicCircleLngLatRing(
  centerLng: number,
  centerLat: number,
  radiusM: number,
  segments?: number,
): Array<[number, number]> {
  const n = segments ?? geodesicCircleSegmentCount(radiusM);
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const bearing = (i / n) * 360;
    ring.push(pointAtBearingMeters(centerLng, centerLat, radiusM, bearing));
  }
  return ring;
}
