"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  isDroneDeviceAirportVisible,
  isDroneDevicePositionVisible,
  isDroneDeviceRouteVisible,
  pruneDroneDeviceVisibility,
  type DroneDeviceVisibilityMap,
} from "@/lib/drone-device-layer-visibility";

const DRONE_DEVICE_LAYER_STORAGE_KEY = "nexus-ui-drone-device-layer-v1";

interface DroneDeviceLayerState {
  /** deviceSn → 自报位 / 航线；缺省 true */
  deviceVisibility: DroneDeviceVisibilityMap;
  syncDroneSns: (droneSns: string[]) => void;
  setDevicePositionVisible: (deviceSn: string, visible: boolean) => void;
  setDeviceRouteVisible: (deviceSn: string, visible: boolean) => void;
  setDeviceAirportVisible: (deviceSn: string, visible: boolean) => void;
  toggleDevicePosition: (deviceSn: string) => void;
  toggleDeviceRoute: (deviceSn: string) => void;
  toggleDeviceAirport: (deviceSn: string) => void;
  setDeviceAllVisible: (deviceSn: string, visible: boolean) => void;
}

export const useDroneDeviceLayerStore = create<DroneDeviceLayerState>()(
  persist(
    (set, get) => ({
      deviceVisibility: {},

      syncDroneSns: (droneSns) =>
        set((s) => ({
          deviceVisibility: pruneDroneDeviceVisibility(s.deviceVisibility, droneSns),
        })),

      setDevicePositionVisible: (deviceSn, visible) =>
        set((s) => ({
          deviceVisibility: {
            ...s.deviceVisibility,
            [deviceSn]: { ...s.deviceVisibility[deviceSn], position: visible },
          },
        })),

      setDeviceRouteVisible: (deviceSn, visible) =>
        set((s) => ({
          deviceVisibility: {
            ...s.deviceVisibility,
            [deviceSn]: { ...s.deviceVisibility[deviceSn], route: visible },
          },
        })),

      toggleDevicePosition: (deviceSn) => {
        const { deviceVisibility } = get();
        get().setDevicePositionVisible(deviceSn, !isDroneDevicePositionVisible(deviceSn, deviceVisibility));
      },

      toggleDeviceRoute: (deviceSn) => {
        const { deviceVisibility } = get();
        get().setDeviceRouteVisible(deviceSn, !isDroneDeviceRouteVisible(deviceSn, deviceVisibility));
      },

      setDeviceAirportVisible: (deviceSn, visible) =>
        set((s) => ({
          deviceVisibility: {
            ...s.deviceVisibility,
            [deviceSn]: { ...s.deviceVisibility[deviceSn], airport: visible },
          },
        })),

      toggleDeviceAirport: (deviceSn) => {
        const { deviceVisibility } = get();
        get().setDeviceAirportVisible(deviceSn, !isDroneDeviceAirportVisible(deviceSn, deviceVisibility));
      },

      setDeviceAllVisible: (deviceSn, visible) =>
        set((s) => ({
          deviceVisibility: {
            ...s.deviceVisibility,
            [deviceSn]: { position: visible, route: visible, airport: visible },
          },
        })),
    }),
    {
      name: DRONE_DEVICE_LAYER_STORAGE_KEY,
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
