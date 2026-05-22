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

/** 尾迹长度（秒）换算为保留点数时，假定相邻采样间隔（秒）；仅前端展示裁剪，不改动 track-store */
export const TRACK_TRAIL_SAMPLE_INTERVAL_SEC = 2;

const STORAGE_KEY = "nexus-ui-track-display-v1";

export type TrackFusionKindUi = "sea" | "air";
export type AirFusionSubtypeKey = "uav" | "bird";

export interface TrackDisplayState {
  /** 对海融合航迹（中立态）颜色 */
  seaFusionColor: string;
  /** 对空融合航迹（中立态）颜色 */
  airFusionColor: string;
  /** 对海/水下矢量线长度（秒 × 速度），1–300 */
  vectorLengthSecondsSea: number;
  /** 对空矢量线长度（秒 × 速度），1–300 */
  vectorLengthSecondsAir: number;
  /** 对海/水下尾迹展示长度（秒），按采样间隔换算为最多点数；1–1800 */
  trailLengthSecondsSea: number;
  /** 对空尾迹展示长度（秒），按采样间隔换算为最多点数；1–1800 */
  trailLengthSecondsAir: number;
  /**
   * 目标侧边栏：按 DDS 来源控制地图上是否绘制该类航迹（与图层「目标」总开关独立）。
   * `false` 隐藏；缺省键视为 `true`。
   */
  trackSubtypeVisible: Record<TrackLayerKey, boolean>;
  /** 对空融合(`fuse_air`)子类显隐：无人机 / 鸟 */
  airFusionSubtypeVisible: AirFusionSubtypeVisibility;
  /** 渲染指纹：配色/矢量/尾迹/分类显隐变化时递增，供地图跳过错误缓存 */
  displayRevision: number;

  setSeaFusionColor: (c: string) => void;
  setAirFusionColor: (c: string) => void;
  setVectorLengthSeconds: (kind: TrackFusionKindUi, s: number) => void;
  setTrailLengthSeconds: (kind: TrackFusionKindUi, s: number) => void;
  toggleTrackSubtype: (key: TrackLayerKey) => void;
  toggleAirFusionSubtype: (key: AirFusionSubtypeKey) => void;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export const useTrackDisplayStore = create<TrackDisplayState>()(
  persist(
    (set) => ({
      seaFusionColor: FUSION_TRACK_NEUTRAL_SEA,
      airFusionColor: FUSION_TRACK_NEUTRAL_AIR,
      vectorLengthSecondsSea: 60,
      vectorLengthSecondsAir: 60,
      trailLengthSecondsSea: 600,
      trailLengthSecondsAir: 600,
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
      setVectorLengthSeconds: (kind, sec) =>
        set((s) => ({
          vectorLengthSecondsSea:
            kind === "sea" ? clamp(Math.round(sec), 1, 300) : s.vectorLengthSecondsSea,
          vectorLengthSecondsAir:
            kind === "air" ? clamp(Math.round(sec), 1, 300) : s.vectorLengthSecondsAir,
          displayRevision: s.displayRevision + 1,
        })),
      setTrailLengthSeconds: (kind, sec) =>
        set((s) => ({
          trailLengthSecondsSea:
            kind === "sea" ? clamp(Math.round(sec), 1, 1800) : s.trailLengthSecondsSea,
          trailLengthSecondsAir:
            kind === "air" ? clamp(Math.round(sec), 1, 1800) : s.trailLengthSecondsAir,
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
        vectorLengthSecondsSea: s.vectorLengthSecondsSea,
        vectorLengthSecondsAir: s.vectorLengthSecondsAir,
        trailLengthSecondsSea: s.trailLengthSecondsSea,
        trailLengthSecondsAir: s.trailLengthSecondsAir,
        trackSubtypeVisible: s.trackSubtypeVisible,
        airFusionSubtypeVisible: s.airFusionSubtypeVisible,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as (Partial<
          Pick<
            TrackDisplayState,
            | "seaFusionColor"
            | "airFusionColor"
            | "vectorLengthSecondsSea"
            | "vectorLengthSecondsAir"
            | "trailLengthSecondsSea"
            | "trailLengthSecondsAir"
            | "trackSubtypeVisible"
            | "airFusionSubtypeVisible"
          >
        > & {
          /** v1 历史字段：单套矢量时长，迁移到空/海两套 */
          vectorLengthSeconds?: number;
          /** v1 历史字段：单套尾迹时长，迁移到空/海两套 */
          trailLengthSeconds?: number;
        });
        const mergedSub = { ...defaultTrackSubtypeVisible(), ...(p.trackSubtypeVisible ?? {}) };
        const mergedAirSub = {
          ...DEFAULT_AIR_FUSION_SUBTYPE_VISIBLE,
          ...(p.airFusionSubtypeVisible ?? {}),
        };
        const legacyVec = p.vectorLengthSeconds != null
          ? clamp(Math.round(p.vectorLengthSeconds), 1, 300)
          : undefined;
        const legacyTrail = p.trailLengthSeconds != null
          ? clamp(Math.round(p.trailLengthSeconds), 1, 1800)
          : undefined;
        const coerceVec = (v: number | undefined, fallback: number): number => {
          if (v == null) return fallback;
          let n = Math.round(v);
          if (n === 0) n = 60;
          return clamp(n, 1, 300);
        };
        return {
          ...current,
          seaFusionColor: p.seaFusionColor ?? current.seaFusionColor,
          airFusionColor: p.airFusionColor ?? current.airFusionColor,
          vectorLengthSecondsSea: coerceVec(
            p.vectorLengthSecondsSea,
            legacyVec ?? current.vectorLengthSecondsSea,
          ),
          vectorLengthSecondsAir: coerceVec(
            p.vectorLengthSecondsAir,
            legacyVec ?? current.vectorLengthSecondsAir,
          ),
          trailLengthSecondsSea:
            p.trailLengthSecondsSea != null
              ? clamp(Math.round(p.trailLengthSecondsSea), 1, 1800)
              : (legacyTrail ?? current.trailLengthSecondsSea),
          trailLengthSecondsAir:
            p.trailLengthSecondsAir != null
              ? clamp(Math.round(p.trailLengthSecondsAir), 1, 1800)
              : (legacyTrail ?? current.trailLengthSecondsAir),
          trackSubtypeVisible: mergedSub,
          airFusionSubtypeVisible: mergedAirSub,
        };
      },
    },
  ),
);

/** 中立融合航迹：按对空/对海选用面板颜色；雷达三类与对应融合色一致（见 `resolveTrackLayerKey`） */
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
  if (lk === "fuse_sea" || lk === "radar_wharf" || lk === "radar_jingzi") return sea;
  return track.isAirTrack === true ? air : sea;
}

/** 航迹矢量时长：对空/对海（含水下）分开读取 */
export function vectorLengthSecondsForTrack(
  track: Pick<Track, "type">,
  state: Pick<TrackDisplayState, "vectorLengthSecondsSea" | "vectorLengthSecondsAir">,
): number {
  return track.type === "air" ? state.vectorLengthSecondsAir : state.vectorLengthSecondsSea;
}

/** 航迹尾迹时长：对空/对海（含水下）分开读取 */
export function trailLengthSecondsForTrack(
  track: Pick<Track, "type">,
  state: Pick<TrackDisplayState, "trailLengthSecondsSea" | "trailLengthSecondsAir">,
): number {
  return track.type === "air" ? state.trailLengthSecondsAir : state.trailLengthSecondsSea;
}
