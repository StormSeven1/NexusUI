/** Web Mercator 下每像素对应地面距离（米），与 MapLibre 一致 */
export function metersPerPixelMapLibre(latDeg: number, zoom: number): number {
  const latRad = (latDeg * Math.PI) / 180;
  return (40_075_016.686 * Math.cos(latRad)) / (512 * 2 ** zoom);
}

export type ScaleBarDisplay = { widthPx: number; label: string };

const NICE_SCALE_STEPS = [1, 2, 5, 10] as const;

/** 将原始距离取整为 1/2/5×10^n 米 */
export function niceScaleMeters(rawMeters: number): number {
  if (!Number.isFinite(rawMeters) || rawMeters <= 0) return 1;
  const exp = Math.floor(Math.log10(rawMeters));
  const magnitude = 10 ** exp;
  const norm = rawMeters / magnitude;
  for (const step of NICE_SCALE_STEPS) {
    if (norm <= step) return step * magnitude;
  }
  return 10 * magnitude;
}

export function formatScaleDistance(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000;
    return Number.isInteger(km) ? `${km} km` : `${km.toFixed(1)} km`;
  }
  if (meters >= 1) {
    return Number.isInteger(meters) ? `${meters} m` : `${Math.round(meters)} m`;
  }
  return `${Math.round(meters * 100)} cm`;
}

/** 根据米/像素计算线段比例尺宽度与标签 */
export function computeScaleBarDisplay(
  metersPerPixel: number,
  maxBarPx = 96,
): ScaleBarDisplay {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
    return { widthPx: maxBarPx, label: "—" };
  }
  const niceMeters = niceScaleMeters(metersPerPixel * maxBarPx);
  const widthPx = Math.max(28, Math.min(maxBarPx, niceMeters / metersPerPixel));
  return { widthPx, label: formatScaleDistance(niceMeters) };
}

/** Cesium Viewer 最小 duck-type（与 cesium 包 Ray/Scene 签名解耦，供 Map3D 断言） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CesiumScaleViewer = {
  scene: {
    canvas: HTMLCanvasElement;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globe: { pick: (ray: any, scene: any, result?: any) => any };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  camera: { getPickRay: (pos: any) => any };
};

/** Cesium：屏幕中心水平 80px 对应地面距离推算米/像素 */
export function metersPerPixelCesium(
  viewer: CesiumScaleViewer,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Cesium: any,
  samplePx = 80,
): number | null {
  const scene = viewer.scene;
  const w = scene.canvas.clientWidth;
  const h = scene.canvas.clientHeight;
  if (w < samplePx + 1 || h < 1) return null;
  const cx = w / 2;
  const cy = h / 2;
  const ray0 = viewer.camera.getPickRay(new Cesium.Cartesian2(cx, cy));
  const ray1 = viewer.camera.getPickRay(new Cesium.Cartesian2(cx + samplePx, cy));
  if (!ray0 || !ray1) return null;
  const p0 = scene.globe.pick(ray0, scene);
  const p1 = scene.globe.pick(ray1, scene);
  if (!p0 || !p1) return null;
  const dist = Cesium.Cartesian3.distance(p0, p1);
  if (!Number.isFinite(dist) || dist <= 0) return null;
  return dist / samplePx;
}
