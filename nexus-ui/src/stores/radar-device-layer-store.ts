"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { LYR_RADAR_COVERAGE } from "@/lib/map-entity-model";
import {
  isRadarDeviceCapabilityVisible,
  isRadarDeviceIconVisible,
  pruneRadarDeviceVisibility,
  type RadarDeviceVisibilityMap,
} from "@/lib/radar-device-layer-visibility";
import { useAppStore } from "@/stores/app-store";

const RADAR_DEVICE_LAYER_STORAGE_KEY = "nexus-ui-radar-device-layer-v1";

interface RadarDeviceLayerState {
  /** 雷达 id → GIS 图标 / 能力（距离环已下线） */
  deviceVisibility: RadarDeviceVisibilityMap;
  syncRadarIds: (radarIds: string[]) => void;
  setDeviceIconVisible: (radarId: string, visible: boolean) => void;
  setDeviceCapabilityVisible: (radarId: string, visible: boolean) => void;
  toggleDeviceIcon: (radarId: string) => void;
  toggleDeviceCapability: (radarId: string) => void;
  setDeviceAllVisible: (radarId: string, visible: boolean) => void;
}

export const useRadarDeviceLayerStore = create<RadarDeviceLayerState>()(
  persist(
    (set, get) => ({
      deviceVisibility: {},

      syncRadarIds: (radarIds) =>
        set((s) => {
          let deviceVisibility = pruneRadarDeviceVisibility(s.deviceVisibility, radarIds);
          const masterOn =
            useAppStore.getState().layerVisibility[LYR_RADAR_COVERAGE] !== false;
          if (!masterOn) {
            const next = { ...deviceVisibility };
            for (const id of radarIds) {
              if (
                isRadarDeviceIconVisible(id, next) ||
                isRadarDeviceCapabilityVisible(id, next)
              ) {
                next[id] = { icon: false, capability: false };
              }
            }
            deviceVisibility = next;
          }
          return { deviceVisibility };
        }),

      setDeviceIconVisible: (radarId, visible) =>
        set((s) => ({
          deviceVisibility: {
            ...s.deviceVisibility,
            [radarId]: { ...s.deviceVisibility[radarId], icon: visible },
          },
        })),

      setDeviceCapabilityVisible: (radarId, visible) =>
        set((s) => ({
          deviceVisibility: {
            ...s.deviceVisibility,
            [radarId]: { ...s.deviceVisibility[radarId], capability: visible },
          },
        })),

      toggleDeviceIcon: (radarId) => {
        const { deviceVisibility } = get();
        get().setDeviceIconVisible(radarId, !isRadarDeviceIconVisible(radarId, deviceVisibility));
      },

      toggleDeviceCapability: (radarId) => {
        const { deviceVisibility } = get();
        get().setDeviceCapabilityVisible(
          radarId,
          !isRadarDeviceCapabilityVisible(radarId, deviceVisibility),
        );
      },

      setDeviceAllVisible: (radarId, visible) =>
        set((s) => ({
          deviceVisibility: {
            ...s.deviceVisibility,
            [radarId]: { icon: visible, capability: visible },
          },
        })),
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
