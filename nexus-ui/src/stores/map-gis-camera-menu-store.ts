"use client";

import { create } from "zustand";
import { fetchOptoLayerPanelCameraRows, type MapGisCameraMenuRow } from "@/lib/map-gis-camera-menu-rows";
import { useOptoDeviceLayerStore } from "@/stores/opto-device-layer-store";

interface MapGisCameraMenuState {
  rows: MapGisCameraMenuRow[];
  loading: boolean;
  /** 至少成功拉取过一次面板列表（用于地图白名单） */
  loaded: boolean;
  lastError: string | null;
  /** 图层面板：光电 PTZ 主相机 + 8090 第三方相机 */
  ensureLoaded: (force?: boolean) => Promise<void>;
}

let inflight: Promise<void> | null = null;

export const useMapGisCameraMenuStore = create<MapGisCameraMenuState>((set, get) => ({
  rows: [],
  loading: false,
  loaded: false,
  lastError: null,

  ensureLoaded: async (force = false) => {
    const { rows, loading, loaded } = get();
    if (!force && loaded && rows.length > 0) return;
    if (inflight) return inflight;
    if (!force && loading) return;

    set({ loading: true, lastError: null });
    inflight = (async () => {
      try {
        const next = await fetchOptoLayerPanelCameraRows();
        set({ rows: next, loading: false, loaded: true, lastError: null });
        useOptoDeviceLayerStore.getState().syncCameraIds(next.map((r) => r.entityId));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        set({ loading: false, loaded: false, lastError: msg });
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },
}));
