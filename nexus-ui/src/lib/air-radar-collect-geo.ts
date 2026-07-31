/**
 * 探鸟雷达站址相对方位/距离（对齐 WatchSys CommonFunc::getAngle4 / GetDistance2）。
 */

const EARTH_RADIUS_KM = 6378.137;

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function rad2deg(r: number): number {
  return (r * 180) / Math.PI;
}

/** 两点距离（米），对齐 GetDistance2(lat1,lng1,lat2,lng2) */
export function airRadarCollectDistanceM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const φ1 = rad(lat1);
  const φ2 = rad(lat2);
  const dφ = φ1 - φ2;
  const dλ = rad(lng1) - rad(lng2);
  let dst =
    2 *
    Math.asin(
      Math.sqrt(Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2),
    );
  dst = dst * EARTH_RADIUS_KM;
  dst = Math.round(dst * 10000) / 10000;
  return dst * 1000;
}

/** 从 (lat,lon) 指向 (lat1,lon1) 的方位角 0–360，对齐 getAngle4 */
export function airRadarCollectBearingDeg(
  lat: number,
  lon: number,
  lat1: number,
  lon1: number,
): number {
  const φ1 = rad(lat);
  const φ2 = rad(lat1);
  const dλ = rad(lon1 - lon);
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  let bear = rad2deg(Math.atan2(y, x));
  if (bear < 0) bear += 360;
  else if (bear > 360) bear -= 360;
  return bear;
}

/** 点击点相对探鸟雷达的方位（°）与距离（m） */
export function airRadarCollectAziDisFromClick(
  clickLat: number,
  clickLon: number,
  radarLat: number,
  radarLon: number,
): { azi: number; dis: number } {
  return {
    azi: airRadarCollectBearingDeg(clickLat, clickLon, radarLat, radarLon),
    dis: airRadarCollectDistanceM(clickLat, clickLon, radarLat, radarLon),
  };
}
