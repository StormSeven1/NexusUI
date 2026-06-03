"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { FUSION_TRACK_NEUTRAL_AIR, FUSION_TRACK_NEUTRAL_SEA } from "@/lib/map-icons";
import {
  TRACK_LAYER_KEYS_ORDERED,
  type TrackLayerKey,
  type Track,
} from "@/lib/map-entity-model";
import {
  DEFAULT_AIR_FUSION_SUBTYPE_VISIBLE,
  resolveTrackLayerKey,
  type AirFusionSubtypeVisibility,
} from "@/lib/track-layer-visibility";

function defaultTrackSubtypeVisible(): Record<TrackLayerKey, boolean> {
  return Object.fromEntries(
    TRACK_LAYER_KEYS_ORDERED.map((k) => [k, true]),
  ) as Record<TrackLayerKey, boolean>;
}

function defaultSecondsByLayer(defaultSec: number): Record<TrackLayerKey, number> {
  return Object.fromEntries(
    TRACK_LAYER_KEYS_ORDERED.map((k) => [k, defaultSec]),
  ) as Record<TrackLayerKey, number>;
}

function layerUsesAirDisplayDefaults(key: TrackLayerKey): boolean {
  return key === "fuse_air" || key === "bird_radar" || key === "uav_pose_track";
}

/** 尾迹长度（秒）换算为保留点数时，假定相邻采样间隔（秒）；仅前端展示裁剪，不改动 track-store */
export const TRACK_TRAIL_SAMPLE_INTERVAL_SEC = 2;

const STORAGE_KEY = "nexus-ui-track-display-v2";

/** 自报位圆点默认色（航迹显示面板可改） */
export const DEFAULT_UAV_POSE_TRACK_COLOR = "#22d3ee";

export type TrackFusionKindUi = "sea" | "air";
export type AirFusionSubtypeKey = "uav" | "bird";

export interface TrackDisplayState {
  seaFusionColor: string;
  airFusionColor: string;
  uavPoseTrackColor: string;
  /** 各 DDS 航迹类型矢量长度（秒 × 速度），1–300 */
  vectorLengthSecondsByLayer: Record<TrackLayerKey, number>;
  /** 各 DDS 航迹类型尾迹长度（秒），1–1800 */
  trailLengthSecondsByLayer: Record<TrackLayerKey, number>;
  trackSubtypeVisible: Record<TrackLayerKey, boolean>;
  airFusionSubtypeVisible: AirFusionSubtypeVisibility;
  displayRevision: number;

  setSeaFusionColor: (c: string) => void;
  setAirFusionColor: (c: string) => void;
  setUavPoseTrackColor: (c: string) => void;
  setVectorLengthSecondsForLayer: (key: TrackLayerKey, s: number) => void;
  setTrailLengthSecondsForLayer: (key: TrackLayerKey, s: number) => void;
  toggleTrackSubtype: (key: TrackLayerKey) => void;
  toggleAirFusionSubtype: (key: AirFusionSubtypeKey) => void;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function coerceVec(v: number | undefined, fallback: number): number {
  if (v == null) return fallback;
  let n = Math.round(v);
  if (n === 0) n = 60;
  return clamp(n, 1, 300);
}

function coerceTrail(v: number | undefined, fallback: number): number {
  if (v == null) return fallback;
  return clamp(Math.round(v), 1, 1800);
}

function migrateSecondsByLayer(
  p: Record<string, unknown>,
  byLayerKey: "vectorLengthSecondsByLayer" | "trailLengthSecondsByLayer",
  legacySeaKey: "vectorLengthSecondsSea" | "trailLengthSecondsSea",
  legacyAirKey: "vectorLengthSecondsAir" | "trailLengthSecondsAir",
  legacySingleKey: "vectorLengthSeconds" | "trailLengthSeconds",
  fallbackByLayer: Record<TrackLayerKey, number>,
  coerce: (v: number | undefined, fb: number) => number,
): Record<TrackLayerKey, number> {
  const next = { ...fallbackByLayer };
  const legacy =
    p[legacySingleKey] != null
      ? coerce(Number(p[legacySingleKey]), fallbackByLayer.fuse_sea)
      : undefined;
  const seaVal =
    p[legacySeaKey] != null ? coerce(Number(p[legacySeaKey]), fallbackByLayer.fuse_sea) : legacy;
  const airVal =
    p[legacyAirKey] != null ? coerce(Number(p[legacyAirKey]), fallbackByLayer.fuse_air) : legacy;
  const byRaw = p[byLayerKey];
  const by =
    byRaw && typeof byRaw === "object" ? (byRaw as Record<string, number>) : null;
  for (const k of TRACK_LAYER_KEYS_ORDERED) {
    if (by && by[k] != null) {
      next[k] = coerce(Number(by[k]), next[k]);
      continue;
    }
    next[k] = layerUsesAirDisplayDefaults(k) ? (airVal ?? next[k]) : (seaVal ?? next[k]);
  }
  return next;
}

export const useTrackDisplayStore = create<TrackDisplayState>()(
  persist(
    (set) => ({
      seaFusionColor: FUSION_TRACK_NEUTRAL_SEA,
      airFusionColor: FUSION_TRACK_NEUTRAL_AIR,
      uavPoseTrackColor: DEFAULT_UAV_POSE_TRACK_COLOR,
      vectorLengthSecondsByLayer: defaultSecondsByLayer(60),
      trailLengthSecondsByLayer: defaultSecondsByLayer(600),
      trackSubtypeVisible: defaultTrackSubtypeVisible(),
      airFusionSubtypeVisible: { ...DEFAULT_AIR_FUSION_SUBTYPE_VISIBLE },
      displayRevision: 0,

      setSeaFusionColor: (c) =>
        set((s) => ({
          seaFusionColor: c,
          displayRevision: s.displayRevision + 1,
        })),
      setAirFusionColor: (c) =>
        set((s) => ({
          airFusionColor: c,
          displayRevision: s.displayRevision + 1,
        })),
      setUavPoseTrackColor: (c) =>
        set((s) => ({
          uavPoseTrackColor: c,
          displayRevision: s.displayRevision + 1,
        })),
      setVectorLengthSecondsForLayer: (key, sec) =>
        set((s) => ({
          vectorLengthSecondsByLayer: {
            ...s.vectorLengthSecondsByLayer,
            [key]: clamp(Math.round(sec), 1, 300),
          },
          displayRevision: s.displayRevision + 1,
        })),
      setTrailLengthSecondsForLayer: (key, sec) =>
        set((s) => ({
          trailLengthSecondsByLayer: {
            ...s.trailLengthSecondsByLayer,
            [key]: clamp(Math.round(sec), 1, 1800),
          },
          displayRevision: s.displayRevision + 1,
        })),
      toggleTrackSubtype: (key) =>
        set((s) => {
          const cur = s.trackSubtypeVisible[key] !== false;
          return {
            trackSubtypeVisible: { ...s.trackSubtypeVisible, [key]: !cur },
            displayRevision: s.displayRevision + 1,
          };
        }),
      toggleAirFusionSubtype: (key) =>
        set((s) => ({
          airFusionSubtypeVisible: {
            ...s.airFusionSubtypeVisible,
            [key]: s.airFusionSubtypeVisible[key] === false,
          },
          displayRevision: s.displayRevision + 1,
        })),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            }
          : window.localStorage,
      ),
      partialize: (s) => ({
        seaFusionColor: s.seaFusionColor,
        airFusionColor: s.airFusionColor,
        uavPoseTrackColor: s.uavPoseTrackColor,
        vectorLengthSecondsByLayer: s.vectorLengthSecondsByLayer,
        trailLengthSecondsByLayer: s.trailLengthSecondsByLayer,
        trackSubtypeVisible: s.trackSubtypeVisible,
        airFusionSubtypeVisible: s.airFusionSubtypeVisible,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        const mergedSub = {
          ...defaultTrackSubtypeVisible(),
          ...((p.trackSubtypeVisible as Record<TrackLayerKey, boolean>) ?? {}),
        };
        const mergedAirSub = {
          ...DEFAULT_AIR_FUSION_SUBTYPE_VISIBLE,
          ...((p.airFusionSubtypeVisible as AirFusionSubtypeVisibility) ?? {}),
        };
        const defaultVec = defaultSecondsByLayer(60);
        const defaultTrail = defaultSecondsByLayer(600);
        const vectorLengthSecondsByLayer = migrateSecondsByLayer(
          p,
          "vectorLengthSecondsByLayer",
          "vectorLengthSecondsSea",
          "vectorLengthSecondsAir",
          "vectorLengthSeconds",
          defaultVec,
          coerceVec,
        );
        const trailLengthSecondsByLayer = migrateSecondsByLayer(
          p,
          "trailLengthSecondsByLayer",
          "trailLengthSecondsSea",
          "trailLengthSecondsAir",
          "trailLengthSeconds",
          defaultTrail,
          coerceTrail,
        );
        return {
          ...current,
          seaFusionColor: (p.seaFusionColor as string) ?? current.seaFusionColor,
          airFusionColor: (p.airFusionColor as string) ?? current.airFusionColor,
          uavPoseTrackColor: (p.uavPoseTrackColor as string) ?? current.uavPoseTrackColor,
          vectorLengthSecondsByLayer,
          trailLengthSecondsByLayer,
          trackSubtypeVisible: mergedSub,
          airFusionSubtypeVisible: mergedAirSub,
        };
      },
    },
  ),
);

export function neutralFusionColorForTrack(
  track: Pick<
    Track,
    | "isAirTrack"
    | "type"
    | "trackLayerKey"
    | "ddsSourceId"
    | "dataSourceId"
    | "sensor"
    | "targetType"
    | "name"
  >,
  sea: string,
  air: string,
): string {
  if (track.type === "underwater") return sea;
  const lk = resolveTrackLayerKey(track);
  if (lk === "fuse_air" || lk === "bird_radar") return air;
  if (lk === "fuse_sea" || lk === "radar_wharf" || lk === "radar_jingzi" || lk === "ais_track") {
    return sea;
  }
  return track.isAirTrack === true ? air : sea;
}

/** 自报位圆点填色（航迹显示里配置，与敌我属性无关） */
export function uavPoseTrackDotColor(state: Pick<TrackDisplayState, "uavPoseTrackColor">): string {
  return state.uavPoseTrackColor;
}

export function vectorLengthSecondsForTrack(
  track: Pick<
    Track,
    | "type"
    | "trackLayerKey"
    | "ddsSourceId"
    | "dataSourceId"
    | "sensor"
    | "targetType"
    | "name"
    | "isAirTrack"
  >,
  state: Pick<TrackDisplayState, "vectorLengthSecondsByLayer">,
): number {
  const lk = resolveTrackLayerKey(track);
  return state.vectorLengthSecondsByLayer[lk] ?? 60;
}

export function trailLengthSecondsForTrack(
  track: Pick<
    Track,
    | "type"
    | "trackLayerKey"
    | "ddsSourceId"
    | "dataSourceId"
    | "sensor"
    | "targetType"
    | "name"
    | "isAirTrack"
  >,
  state: Pick<TrackDisplayState, "trailLengthSecondsByLayer">,
): number {
  const lk = resolveTrackLayerKey(track);
  return state.trailLengthSecondsByLayer[lk] ?? 600;
}
