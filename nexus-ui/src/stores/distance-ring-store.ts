"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  clampAreaLineWidth,
  clampOpacity,
  clampRingCount,
  coerceAreaLineStyle,
  coerceSpacingNm,
  DEFAULT_DISTANCE_RING_SETTINGS,
  normalizeDistanceRingSettings,
  type AreaLayerLineStyle,
  type DistanceRingSettings,
} from "@/lib/distance-ring-settings";

const STORAGE_KEY = "nexus-ui-situation-display-v3";

export interface DistanceRingState extends DistanceRingSettings {
  settingsRevision: number;
  setRingCount: (n: number) => void;
  setSpacingNm: (nm: number) => void;
  setCenterLat: (lat: number) => void;
  setCenterLng: (lng: number) => void;
  setRingColor: (color: string) => void;
  setRingOpacity: (opacity: number) => void;
  setLabelOpacity: (opacity: number) => void;
  setAreaLineColor: (color: string) => void;
  setAreaLineOpacity: (opacity: number) => void;
  setAreaLabelOpacity: (opacity: number) => void;
  setAreaLineWidth: (width: number) => void;
  setAreaLineStyle: (style: AreaLayerLineStyle) => void;
}

function bumpRevision(set: (fn: (s: DistanceRingState) => Partial<DistanceRingState>) => void) {
  set((s) => ({ settingsRevision: s.settingsRevision + 1 }));
}

export const useDistanceRingStore = create<DistanceRingState>()(
  persist(
    (set) => ({
      ...DEFAULT_DISTANCE_RING_SETTINGS,
      settingsRevision: 0,

      setRingCount: (n) => {
        set({ ringCount: clampRingCount(n) });
        bumpRevision(set);
      },
      setSpacingNm: (nm) => {
        set({ spacingNm: coerceSpacingNm(nm) });
        bumpRevision(set);
      },
      setCenterLat: (lat) => {
        if (!Number.isFinite(lat)) return;
        set({ centerLat: lat });
        bumpRevision(set);
      },
      setCenterLng: (lng) => {
        if (!Number.isFinite(lng)) return;
        set({ centerLng: lng });
        bumpRevision(set);
      },
      setRingColor: (color) => {
        if (!color?.trim()) return;
        set({ ringColor: color.trim() });
        bumpRevision(set);
      },
      setRingOpacity: (opacity) => {
        set({ ringOpacity: clampOpacity(opacity) });
        bumpRevision(set);
      },
      setLabelOpacity: (opacity) => {
        set({ labelOpacity: clampOpacity(opacity) });
        bumpRevision(set);
      },
      setAreaLineColor: (color) => {
        if (!color?.trim()) return;
        set({ areaLineColor: color.trim() });
        bumpRevision(set);
      },
      setAreaLineOpacity: (opacity) => {
        set({ areaLineOpacity: clampOpacity(opacity) });
        bumpRevision(set);
      },
      setAreaLabelOpacity: (opacity) => {
        set({ areaLabelOpacity: clampOpacity(opacity) });
        bumpRevision(set);
      },
      setAreaLineWidth: (width) => {
        set({ areaLineWidth: clampAreaLineWidth(width) });
        bumpRevision(set);
      },
      setAreaLineStyle: (style) => {
        set({ areaLineStyle: coerceAreaLineStyle(style) });
        bumpRevision(set);
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        ringCount: s.ringCount,
        spacingNm: s.spacingNm,
        centerLat: s.centerLat,
        centerLng: s.centerLng,
        ringColor: s.ringColor,
        ringOpacity: s.ringOpacity,
        labelOpacity: s.labelOpacity,
        areaLineColor: s.areaLineColor,
        areaLineOpacity: s.areaLineOpacity,
        areaLabelOpacity: s.areaLabelOpacity,
        areaLineWidth: s.areaLineWidth,
        areaLineStyle: s.areaLineStyle,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...normalizeDistanceRingSettings(
          (persisted ?? {}) as Partial<DistanceRingSettings> & {
            color?: string;
            regionColor?: string;
            regionOpacity?: number;
          },
          current,
        ),
      }),
    },
  ),
);
