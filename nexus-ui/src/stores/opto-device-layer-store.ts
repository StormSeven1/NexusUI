"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  isOptoDeviceFovVisible,
  isOptoDeviceIconVisible,
  pruneOptoDeviceVisibility,
  type OptoDeviceVisibilityMap,
} from "@/lib/opto-device-layer-visibility";

const OPTO_DEVICE_LAYER_STORAGE_KEY = "nexus-ui-opto-device-layer-v1";

interface OptoDeviceLayerState {
  /** 资产 id → 视场 / GIS 图标；缺省 true */
  deviceVisibility: OptoDeviceVisibilityMap;
  syncCameraIds: (cameraIds: string[]) => void;
  setDeviceFovVisible: (assetId: string, visible: boolean) => void;
  setDeviceIconVisible: (assetId: string, visible: boolean) => void;
  toggleDeviceFov: (assetId: string) => void;
  toggleDeviceIcon: (assetId: string) => void;
  setDeviceAllVisible: (assetId: string, visible: boolean) => void;
}

export const useOptoDeviceLayerStore = create<OptoDeviceLayerState>()(
  persist(
    (set, get) => ({
      deviceVisibility: {},

      syncCameraIds: (cameraIds) =>
        set((s) => ({
          deviceVisibility: pruneOptoDeviceVisibility(s.deviceVisibility, cameraIds),
        })),

      setDeviceFovVisible: (assetId, visible) =>
        set((s) => ({
          deviceVisibility: {
            ...s.deviceVisibility,
            [assetId]: { ...s.deviceVisibility[assetId], fov: visible },
          },
        })),

      setDeviceIconVisible: (assetId, visible) =>
        set((s) => ({
          deviceVisibility: {
            ...s.deviceVisibility,
            [assetId]: { ...s.deviceVisibility[assetId], icon: visible },
          },
        })),

      toggleDeviceFov: (assetId) => {
        const { deviceVisibility } = get();
        get().setDeviceFovVisible(assetId, !isOptoDeviceFovVisible(assetId, deviceVisibility));
      },

      toggleDeviceIcon: (assetId) => {
        const { deviceVisibility } = get();
        get().setDeviceIconVisible(assetId, !isOptoDeviceIconVisible(assetId, deviceVisibility));
      },

      setDeviceAllVisible: (assetId, visible) =>
        set((s) => ({
          deviceVisibility: {
            ...s.deviceVisibility,
            [assetId]: { fov: visible, icon: visible },
          },
        })),
    }),
    {
      name: OPTO_DEVICE_LAYER_STORAGE_KEY,
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
