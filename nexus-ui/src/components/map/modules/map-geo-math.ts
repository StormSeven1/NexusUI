/** 球面近似：折线总长（米）、方位角（度，正北为 0） */

const R = 6371000;

function toRad(d: number) {
  return (d * Math.PI) / 180;
}

export function haversineMeters(a: [number, number], b: [number, number]): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

export function lineLengthMeters(coords: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < coords.length; i++) s += haversineMeters(coords[i - 1]!, coords[i]!);
  return s;
}

/**
 * 从 o 出发、方位角 bearingDeg（正北为 0°、顺时针）、距离 distM（米）的终点坐标。
 */
export function destinationByBearingMeters(
  o: [number, number],
  bearingDeg: number,
  distM: number
): [number, number] {
  const brng = toRad(bearingDeg);
  const δ = distM / R;
  const φ1 = toRad(o[1]);
  const λ1 = toRad(o[0]);
  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);
  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(brng);
  const φ2 = Math.asin(Math.min(1, Math.max(-1, sinφ2)));
  const y = Math.sin(brng) * sinδ * cosφ1;
  const x = cosδ - sinφ1 * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);
  let lng = (λ2 * 180) / Math.PI;
  if (lng > 180) lng -= 360;
  if (lng < -180) lng += 360;
  return [lng, (φ2 * 180) / Math.PI];
}

/** 方位：从 o 指向 p，顺时针与正北夹角（度） */
export function bearingDeg(o: [number, number], p: [number, number]): number {
  const [lng1, lat1] = o.map(toRad) as [number, number];
  const [lng2, lat2] = p.map(toRad) as [number, number];
  const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** 多边形近似面积（m²），小范围平面近似 */
export function polygonAreaMetersApprox(ring: [number, number][]): number {
  if (ring.length < 4) return 0;
  const lat0 = toRad(ring[0]![1]);
  const mx = (lng: number) => toRad(lng) * R * Math.cos(lat0);
  const my = (lat: number) => toRad(lat) * R;
  let sum = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    const [x1, y1] = [mx(ring[i]![0]), my(ring[i]![1])];
    const [x2, y2] = [mx(ring[i + 1]![0]), my(ring[i + 1]![1])];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}
