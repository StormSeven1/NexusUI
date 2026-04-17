import { create } from "zustand";

/** 鼠标在地图上的经纬度（2D MapLibre / 3D Cesium）；供状态栏等展示 */
export type MapPointerCoords = { lat: number; lng: number };

interface MapPointerState {
  mouseCoords: MapPointerCoords | null;
  setMouseCoords: (coords: MapPointerCoords | null) => void;
}

export const useMapPointerStore = create<MapPointerState>((set) => ({
  mouseCoords: null,
  setMouseCoords: (coords) => set({ mouseCoords: coords }),
}));
