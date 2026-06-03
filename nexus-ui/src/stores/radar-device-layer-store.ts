"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  isRadarDeviceCoverageVisible,
  isRadarDeviceIconVisible,
  pruneRadarDeviceVisibility,
  type RadarDeviceVisibilityMap,
} from "@/lib/radar-device-layer-visibility";

const RADAR_DEVICE_LAYER_STORAGE_KEY = "nexus-ui-radar-device-layer-v1";

interface RadarDeviceLayerState {
  /** 雷达 id → 距离环 / GIS 图标；缺省 true */
  deviceVisibility: RadarDeviceVisibilityMap;
  syncRadarIds: (radarIds: string[]) => void;
  setDeviceCoverageVisible: (radarId: string, visible: boolean) => void;
  setDeviceIconVisible: (radarId: string, visible: boolean) => void;
  toggleDeviceCoverage: (radarId: string) => void;
  toggleDeviceIcon: (radarId: string) => void;
}

export const useRadarDeviceLayerStore = create<RadarDeviceLayerState>()(
  persist(
    (set, get) => ({
      deviceVisibility: {},

      syncRadarIds: (radarIds) =>
        set((s) => ({
          deviceVisibility: pruneRadarDeviceVisibility(s.deviceVisibility, radarIds),
        })),

      setDeviceCoverageVisible: (radarId, visible) =>
        set((s) => ({
          deviceVisibility: {
            ...s.deviceVisibility,
            [radarId]: { ...s.deviceVisibility[radarId], coverage: visible },
          },
        })),

      setDeviceIconVisible: (radarId, visible) =>
        set((s) => ({
          deviceVisibility: {
            ...s.deviceVisibility,
            [radarId]: { ...s.deviceVisibility[radarId], icon: visible },
          },
        })),

      toggleDeviceCoverage: (radarId) => {
        const { deviceVisibility } = get();
        get().setDeviceCoverageVisible(radarId, !isRadarDeviceCoverageVisible(radarId, deviceVisibility));
      },

      toggleDeviceIcon: (radarId) => {
        const { deviceVisibility } = get();
        get().setDeviceIconVisible(radarId, !isRadarDeviceIconVisible(radarId, deviceVisibility));
      },
    }),
    {
      name: RADAR_DEVICE_LAYER_STORAGE_KEY,
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            }
          : window.localStorage,
      ),
      partialize: (s) => ({ deviceVisibility: s.deviceVisibility }),
    },
  ),
);
