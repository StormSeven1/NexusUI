import type maplibregl from "maplibre-gl";
import { useMapMeasureUi } from "@/stores/map-measure-bridge";

const DRAW_MODE_CLASS = "nexus-map-draw-mode";

/** 标绘模式：覆盖 MapLibre 默认 grab 手型，强制十字光标 */
export function setMapDrawCursor(map: maplibregl.Map, enabled: boolean): void {
  const root = map.getContainer();
  const canvas = map.getCanvas();
  const canvasContainer = map.getCanvasContainer();
  if (enabled) {
    root.classList.add(DRAW_MODE_CLASS);
    canvas.style.cursor = "crosshair";
    if (canvasContainer) canvasContainer.style.cursor = "crosshair";
  } else {
    root.classList.remove(DRAW_MODE_CLASS);
    canvas.style.cursor = "";
    if (canvasContainer) canvasContainer.style.cursor = "";
  }
}

export function isMapMeasureDrawActive(): boolean {
  const t = useMapMeasureUi.getState().activeDrawTool;
  return t === "area" || t === "distance" || t === "angle" || t === "polygon";
}
