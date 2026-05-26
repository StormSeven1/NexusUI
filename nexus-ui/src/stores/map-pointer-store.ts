import { create } from "zustand";

/** 鼠标在地图上的经纬度（2D MapLibre / 3D Cesium）；供状态栏等展示 */
export type MapPointerCoords = { lat: number; lng: number };

interface MapPointerState {
  mouseCoords: MapPointerCoords | null;
  /** 当前视图下每像素地面距离（米），供地图比例尺 */
  metersPerPixel: number | null;
  setMouseCoords: (coords: MapPointerCoords | null) => void;
  setMetersPerPixel: (mpp: number | null) => void;
}

export const useMapPointerStore = create<MapPointerState>((set) => ({
  mouseCoords: null,
  metersPerPixel: null,
  setMouseCoords: (coords) => set({ mouseCoords: coords }),
  setMetersPerPixel: (mpp) => set({ metersPerPixel: mpp }),
}));
