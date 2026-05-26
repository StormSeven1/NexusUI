"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  clampDroneFlightHeight,
  clampDroneFlightSpeed,
  DEFAULT_DRONE_TASK_FLIGHT_SETTINGS,
  type DroneTaskFlightSettings,
} from "@/lib/drone-task-settings";

const STORAGE_KEY = "nexus-ui-drone-task-settings-v1";

export interface DroneTaskSettingsState extends DroneTaskFlightSettings {
  setFlightSpeed: (speed: number) => void;
  setFlightHeight: (height: number) => void;
  applySettings: (next: Partial<DroneTaskFlightSettings>) => void;
}

export const useDroneTaskSettingsStore = create<DroneTaskSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_DRONE_TASK_FLIGHT_SETTINGS,

      setFlightSpeed: (speed) => set({ flightSpeed: clampDroneFlightSpeed(speed) }),
      setFlightHeight: (height) => set({ flightHeight: clampDroneFlightHeight(height) }),
      applySettings: (next) =>
        set((s) => ({
          flightSpeed:
            next.flightSpeed != null ? clampDroneFlightSpeed(next.flightSpeed) : s.flightSpeed,
          flightHeight:
            next.flightHeight != null ? clampDroneFlightHeight(next.flightHeight) : s.flightHeight,
        })),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        flightSpeed: s.flightSpeed,
        flightHeight: s.flightHeight,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DroneTaskFlightSettings>;
        return {
          ...current,
          flightSpeed: clampDroneFlightSpeed(p.flightSpeed ?? current.flightSpeed),
          flightHeight: clampDroneFlightHeight(p.flightHeight ?? current.flightHeight),
        };
      },
    },
  ),
);

/** 下发无人机任务时读取当前速度与高度 */
export function getDroneTaskFlightParams(): DroneTaskFlightSettings {
  const s = useDroneTaskSettingsStore.getState();
  return {
    flightSpeed: clampDroneFlightSpeed(s.flightSpeed),
    flightHeight: clampDroneFlightHeight(s.flightHeight),
  };
}
