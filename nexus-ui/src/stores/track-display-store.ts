"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { FUSION_TRACK_NEUTRAL_AIR, FUSION_TRACK_NEUTRAL_SEA } from "@/lib/map-icons";
import {
  TRACK_LAYER_KEYS_ORDERED,
  type TrackLayerKey,
  type Track,
} from "@/lib/map-entity-model";
import { resolveTrackLayerKey } from "@/lib/track-layer-visibility";

function defaultTrackSubtypeVisible(): Record<TrackLayerKey, boolean> {
  return Object.fromEntries(
    TRACK_LAYER_KEYS_ORDERED.map((k) => [k, true]),
  ) as Record<TrackLayerKey, boolean>;
}

/** 尾迹长度（秒）换算为保留点数时，假定相邻采样间隔（秒）；仅前端展示裁剪，不改动 track-store */
export const TRACK_TRAIL_SAMPLE_INTERVAL_SEC = 2;

const STORAGE_KEY = "nexus-ui-track-display-v1";

export type TrackFusionKindUi = "sea" | "air";

export interface TrackDisplayState {
  /** 对海融合航迹（中立态）颜色 */
  seaFusionColor: string;
  /** 对空融合航迹（中立态）颜色 */
  airFusionColor: string;
  /** 矢量线长度（秒 × 速度），1–300；为 0 时不绘制矢量 */
  vectorLengthSeconds: number;
  /** 尾迹展示长度（秒），按采样间隔换算为最多点数；1–1800 */
  trailLengthSeconds: number;
  /**
   * 目标侧边栏：按 DDS 来源控制地图上是否绘制该类航迹（与图层「目标」总开关独立）。
   * `false` 隐藏；缺省键视为 `true`。
   */
  trackSubtypeVisible: Record<TrackLayerKey, boolean>;
  /** 渲染指纹：配色/矢量/尾迹/分类显隐变化时递增，供地图跳过错误缓存 */
  displayRevision: number;

  setSeaFusionColor: (c: string) => void;
  setAirFusionColor: (c: string) => void;
  setVectorLengthSeconds: (s: number) => void;
  setTrailLengthSeconds: (s: number) => void;
  toggleTrackSubtype: (key: TrackLayerKey) => void;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export const useTrackDisplayStore = create<TrackDisplayState>()(
  persist(
    (set) => ({
      seaFusionColor: FUSION_TRACK_NEUTRAL_SEA,
      airFusionColor: FUSION_TRACK_NEUTRAL_AIR,
      vectorLengthSeconds: 60,
      trailLengthSeconds: 600,
      trackSubtypeVisible: defaultTrackSubtypeVisible(),
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
      setVectorLengthSeconds: (sec) =>
        set((s) => ({
          vectorLengthSeconds: clamp(Math.round(sec), 1, 300),
          displayRevision: s.displayRevision + 1,
        })),
      setTrailLengthSeconds: (sec) =>
        set((s) => ({
          trailLengthSeconds: clamp(Math.round(sec), 1, 1800),
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
        vectorLengthSeconds: s.vectorLengthSeconds,
        trailLengthSeconds: s.trailLengthSeconds,
        trackSubtypeVisible: s.trackSubtypeVisible,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<
          Pick<
            TrackDisplayState,
            | "seaFusionColor"
            | "airFusionColor"
            | "vectorLengthSeconds"
            | "trailLengthSeconds"
            | "trackSubtypeVisible"
          >
        >;
        const mergedSub = { ...defaultTrackSubtypeVisible(), ...(p.trackSubtypeVisible ?? {}) };
        return {
          ...current,
          seaFusionColor: p.seaFusionColor ?? current.seaFusionColor,
          airFusionColor: p.airFusionColor ?? current.airFusionColor,
          vectorLengthSeconds: (() => {
            if (p.vectorLengthSeconds == null) return current.vectorLengthSeconds;
            let v = Math.round(p.vectorLengthSeconds);
            /** 曾持久化 0：MapLibre 矢量直接不生成；迁移为默认 60s */
            if (v === 0) v = 60;
            return clamp(v, 1, 300);
          })(),
          trailLengthSeconds:
            p.trailLengthSeconds != null
              ? clamp(Math.round(p.trailLengthSeconds), 1, 1800)
              : current.trailLengthSeconds,
          trackSubtypeVisible: mergedSub,
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
