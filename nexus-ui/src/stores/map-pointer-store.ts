import { create } from "zustand";

/** 鼠标在地图上的经纬度（2D MapLibre / 3D Cesium）；供状态栏等展示 */
export type MapPointerCoords = { lat: number; lng: number };

interface MapPointerState {
  mouseCoords: MapPointerCoords | null;
  setMouseCoords: (coords: MapPointerCoords | null) => void;
}

export const useMapPointerStore = create<MapPointerState>((set) => ({
  mouseCoords: null,
  setMouseCoords: (coords) =>
    set((state) => {
      if (coords == null) {
        return state.mouseCoords == null ? state : { mouseCoords: null };
      }
      const prev = state.mouseCoords;
      if (
        prev &&
        Math.abs(prev.lat - coords.lat) < 0.000001 &&
        Math.abs(prev.lng - coords.lng) < 0.000001
      ) {
        return state;
      }
      return { mouseCoords: coords };
    }),
}));
