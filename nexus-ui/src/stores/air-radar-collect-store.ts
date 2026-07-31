"use client";

import { create } from "zustand";
import type { Track } from "@/lib/map-entity-model";
import { resolveTrackLayerKey } from "@/lib/track-layer-visibility";
import { numericTargetIdForCameraTask } from "@/lib/map-gis-camera-task";
import { airRadarCollectAziDisFromClick } from "@/lib/air-radar-collect-geo";
import { fetchAirRadarCollectConfig } from "@/lib/air-radar-collect-api";

export const AIR_RADAR_TARGET_TYPE_OPTIONS = [
  "无人机",
  "鸟",
  "浮标",
  "车辆",
  "船只",
  "地面杂波",
  "海面杂波",
] as const;

export const AIR_RADAR_TRACK_TYPE_OPTIONS = ["自报位", "探鸟航迹"] as const;

/** 仅探鸟雷达航迹（右键批号/航迹）可自动采集；手动采集仍走地图空白处 */
export function isAirRadarCollectAutoEligible(track: Track): boolean {
  return resolveTrackLayerKey(track) === "bird_radar";
}

export type AirRadarCollectMode = "manual" | "auto";

type AirRadarCollectState = {
  open: boolean;
  mode: AirRadarCollectMode;
  collecting: boolean;
  pickMode: boolean;
  trackId: number;
  targetType: number;
  trackType: number;
  aziCenter: number;
  disCenter: number;
  aziRange: number;
  disRange: number;
  radarLat: number;
  radarLon: number;
  openManual: () => void;
  openAuto: (track: Track) => void;
  close: () => void;
  setField: <K extends keyof AirRadarCollectState>(key: K, value: AirRadarCollectState[K]) => void;
  enablePickMode: () => void;
  applyMapClick: (lat: number, lng: number) => boolean;
  loadRemoteConfig: () => Promise<void>;
};

const DEFAULT_RADAR_LAT = 37.54887;
const DEFAULT_RADAR_LON = 122.09432;

export const useAirRadarCollectStore = create<AirRadarCollectState>((set, get) => ({
  open: false,
  mode: "manual",
  collecting: false,
  pickMode: false,
  trackId: 0,
  targetType: 0,
  trackType: 0,
  aziCenter: 0,
  disCenter: 0,
  aziRange: 20,
  disRange: 200,
  radarLat: DEFAULT_RADAR_LAT,
  radarLon: DEFAULT_RADAR_LON,

  openManual: () => {
    set({
      open: true,
      mode: "manual",
      collecting: false,
      pickMode: false,
      trackId: 0,
      targetType: 0,
      trackType: 0,
      aziCenter: 0,
      disCenter: 0,
      aziRange: 20,
      disRange: 200,
    });
    void get().loadRemoteConfig();
  },

  openAuto: (track) => {
    if (!isAirRadarCollectAutoEligible(track)) return;
    const tid = numericTargetIdForCameraTask(track);
    const { radarLat, radarLon } = get();
    const { azi, dis } = airRadarCollectAziDisFromClick(track.lat, track.lng, radarLat, radarLon);
    set({
      open: true,
      mode: "auto",
      collecting: false,
      pickMode: false,
      trackId: tid > 0 ? tid : 0,
      targetType: 0,
      trackType: 1, // 探鸟航迹
      aziCenter: Number.isFinite(azi) ? azi : 0,
      disCenter: Number.isFinite(dis) ? dis : 0,
      aziRange: 20,
      disRange: 200,
    });
    void get().loadRemoteConfig().then(() => {
      const s = get();
      const next = airRadarCollectAziDisFromClick(track.lat, track.lng, s.radarLat, s.radarLon);
      set({ aziCenter: next.azi, disCenter: next.dis });
    });
  },

  close: () => set({ open: false, pickMode: false, collecting: false }),

  setField: (key, value) => set({ [key]: value } as Partial<AirRadarCollectState>),

  enablePickMode: () => set({ pickMode: true }),

  applyMapClick: (lat, lng) => {
    if (!get().pickMode) return false;
    const { radarLat, radarLon } = get();
    const { azi, dis } = airRadarCollectAziDisFromClick(lat, lng, radarLat, radarLon);
    set({ aziCenter: azi, disCenter: dis, pickMode: false, open: true });
    return true;
  },

  loadRemoteConfig: async () => {
    const cfg = await fetchAirRadarCollectConfig();
    if (!cfg) return;
    set({ radarLat: cfg.radar_lat, radarLon: cfg.radar_lon });
  },
}));
