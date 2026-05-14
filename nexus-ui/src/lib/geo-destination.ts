/**
 * 已知起点、方位角（正北顺时针 °）、大地线距离（米），求终点 WGS84 经纬度。
 * @returns [lng, lat]
 */
export function destinationLngLat(
  latDeg: number,
  lngDeg: number,
  bearingDeg: number,
  distanceM: number,
): [number, number] {
  const R = 6371000;
  if (!(distanceM > 0) || !Number.isFinite(distanceM)) return [lngDeg, latDeg];
  const φ1 = (latDeg * Math.PI) / 180;
  const λ1 = (lngDeg * Math.PI) / 180;
  const θ = (bearingDeg * Math.PI) / 180;
  const δ = distanceM / R;

  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);

  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);
  const y = Math.sin(θ) * sinδ * cosφ1;
  const x = cosδ - sinφ1 * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);

  const lat2 = (φ2 * 180) / Math.PI;
  let lng2 = (λ2 * 180) / Math.PI;
  lng2 = ((lng2 + 540) % 360) - 180;
  return [lng2, lat2];
}
