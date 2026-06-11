import type maplibregl from "maplibre-gl";

/**
 * 地图绘制态光标辅助。
 */
export function setMapDrawCursor(map: maplibregl.Map, active: boolean): void {
  const canvas = map.getCanvas?.();
  if (!canvas) return;
  canvas.style.cursor = active ? "crosshair" : "";
}
