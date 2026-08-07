"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  FUSION_TRACK_NEUTRAL_AIR,
  FUSION_TRACK_NEUTRAL_SEA,
  FUSION_TRACK_NEUTRAL_UAV,
  isAirTrackBirdGlyph,
} from "@/lib/map-icons";
import {
  type TrackLayerKey,
  type Track,
} from "@/lib/map-entity-model";
import {
  DEFAULT_AIR_FUSION_SUBTYPE_VISIBLE,
  getTrackLayerKeysOrdered,
  resolveTrackLayerKey,
  trackSubtypeVisibleFromFusionTrackSourcesEnv,
  type AirFusionSubtypeVisibility,
} from "@/lib/track-layer-visibility";

function defaultTrackSubtypeVisible(): Record<TrackLayerKey, boolean> {
  return trackSubtypeVisibleFromFusionTrackSourcesEnv();
}

function defaultSecondsByLayer(defaultSec: number): Record<TrackLayerKey, number> {
  return Object.fromEntries(
    getTrackLayerKeysOrdered().map((k) => [k, defaultSec]),
  ) as Record<TrackLayerKey, number>;
}

function layerUsesAirDisplayDefaults(key: TrackLayerKey): boolean {
  return (
    key === "fuse_air" ||
    key === "bird_radar" ||
    key === "auto_bird_radar" ||
    key === "fanwu_car_radar" ||
    key === "uav_pose_track" ||
    key === "ku_lei_da" ||
    key === "wu_ren_che"
  );
}

/** 尾迹长度（秒）换算为保留点数时，假定相邻采样间隔（秒）；仅前端展示裁剪，不改动 track-store */
export const TRACK_TRAIL_SAMPLE_INTERVAL_SEC = 2;
/** 显示控制面板「尾迹长度」滑块上限（秒） */
export const MAX_TRAIL_LENGTH_SECONDS = 1800;

/** v4：探鸟雷达智能跟踪点迹默认开；从 v3 迁入时强制打开一次 */
const STORAGE_KEY = "nexus-ui-track-display-v4";

/** 自报位圆点默认色（航迹显示面板可改） */
export const DEFAULT_UAV_POSE_TRACK_COLOR = "#22d3ee";

export type TrackFusionKindUi = "sea" | "air";
export type AirFusionSubtypeKey = "uav" | "bird";

/** 对空融合中立色：鸟 / 无人机各自独立（显示控制面板两行） */
export type AirFusionNeutralColors = Record<AirFusionSubtypeKey, string>;

export function defaultAirFusionNeutralColors(): AirFusionNeutralColors {
  return {
    bird: FUSION_TRACK_NEUTRAL_AIR,
    uav: FUSION_TRACK_NEUTRAL_UAV,
  };
}

/** 各航迹类型默认中立/圆点色（彼此独立，互不影响） */
export function defaultNeutralColorByLayer(): Record<TrackLayerKey, string> {
  const base: Record<TrackLayerKey, string> = {
    fuse_sea: FUSION_TRACK_NEUTRAL_SEA,
    fuse_air: FUSION_TRACK_NEUTRAL_AIR,
    bird_radar: FUSION_TRACK_NEUTRAL_AIR,
    /** 与 P 显智能跟踪黄点接近 */
    auto_bird_radar: "#facc15",
    fanwu_car_radar: FUSION_TRACK_NEUTRAL_AIR,
    radar_wharf: FUSION_TRACK_NEUTRAL_SEA,
    radar_jingzi: FUSION_TRACK_NEUTRAL_SEA,
    ais_track: FUSION_TRACK_NEUTRAL_SEA,
    uav_pose_track: DEFAULT_UAV_POSE_TRACK_COLOR,
    boat_self_track: FUSION_TRACK_NEUTRAL_SEA,
    xpf_track: FUSION_TRACK_NEUTRAL_SEA,
    ku_lei_da: FUSION_TRACK_NEUTRAL_AIR,
    tian_ao: FUSION_TRACK_NEUTRAL_SEA,
    wu_ren_che: FUSION_TRACK_NEUTRAL_AIR,
  };
  for (const k of getTrackLayerKeysOrdered()) {
    if (base[k] !== undefined) continue;
    base[k] = layerUsesAirDisplayDefaults(k) ? FUSION_TRACK_NEUTRAL_AIR : FUSION_TRACK_NEUTRAL_SEA;
  }
  return base;
}

/** `<input type="color">` 需要 #rrggbb；非法值会导致色盘空白 */
export function normalizeCssHexColor(raw: string, fallback: string): string {
  const t = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return `#${t.slice(1).toLowerCase()}`;
  if (/^#[0-9a-fA-F]{3}$/.test(t)) {
    const r = t[1]!;
    const g = t[2]!;
    const b = t[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

export interface TrackDisplayState {
  /** 各 DDS 航迹类型独立配色（中立军标 / 圆点 / AIS 三角） */
  neutralColorByLayer: Record<TrackLayerKey, string>;
  /**
   * 对空融合细分中立色（鸟 / 无人机）。
   * `neutralColorByLayer.fuse_air` 与 bird 同步，供旧逻辑兜底。
   */
  airFusionNeutralColorBySubtype: AirFusionNeutralColors;
  /** 各 DDS 航迹类型矢量长度（秒 × 速度），1–300 */
  vectorLengthSecondsByLayer: Record<TrackLayerKey, number>;
  /** 各 DDS 航迹类型尾迹长度（秒），1–1800 */
  trailLengthSecondsByLayer: Record<TrackLayerKey, number>;
  trackSubtypeVisible: Record<TrackLayerKey, boolean>;
  airFusionSubtypeVisible: AirFusionSubtypeVisibility;
  displayRevision: number;

  setNeutralColorForLayer: (key: TrackLayerKey, c: string) => void;
  setAirFusionNeutralColorForSubtype: (key: AirFusionSubtypeKey, c: string) => void;
  setVectorLengthSecondsForLayer: (key: TrackLayerKey, s: number) => void;
  setTrailLengthSecondsForLayer: (key: TrackLayerKey, s: number) => void;
  setTrailLengthSecondsForAllLayers: (s: number) => void;
  toggleTrackSubtype: (key: TrackLayerKey) => void;
  toggleAirFusionSubtype: (key: AirFusionSubtypeKey) => void;
  setTrackSubtypeVisible: (key: TrackLayerKey, visible: boolean) => void;
  setAirFusionSubtypesVisible: (visible: boolean) => void;
  setAllTrackSubtypesVisible: (visible: boolean) => void;
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
  for (const k of getTrackLayerKeysOrdered()) {
    if (by && by[k] != null) {
      next[k] = coerce(Number(by[k]), next[k]);
      continue;
    }
    next[k] = layerUsesAirDisplayDefaults(k) ? (airVal ?? next[k]) : (seaVal ?? next[k]);
  }
  return next;
}

function migrateNeutralColorByLayer(p: Record<string, unknown>): Record<TrackLayerKey, string> {
  const defaults = defaultNeutralColorByLayer();
  const next = { ...defaults };
  const byRaw = p.neutralColorByLayer;
  const by =
    byRaw && typeof byRaw === "object" ? (byRaw as Record<string, string>) : null;
  for (const k of getTrackLayerKeysOrdered()) {
    if (by && typeof by[k] === "string" && by[k].trim()) {
      next[k] = normalizeCssHexColor(by[k], defaults[k]);
    }
  }
  // v2：海/空/自报位三色 → 按旧归属拆到各类（仅填尚未在 by 里写过的 key）
  const sea = typeof p.seaFusionColor === "string" ? p.seaFusionColor : null;
  const air = typeof p.airFusionColor === "string" ? p.airFusionColor : null;
  const uav = typeof p.uavPoseTrackColor === "string" ? p.uavPoseTrackColor : null;
  for (const k of getTrackLayerKeysOrdered()) {
    if (by && typeof by[k] === "string" && by[k].trim()) continue;
    if (k === "uav_pose_track" && uav) {
      next[k] = normalizeCssHexColor(uav, defaults[k]);
      continue;
    }
    if (layerUsesAirDisplayDefaults(k) && k !== "uav_pose_track" && air) {
      next[k] = normalizeCssHexColor(air, defaults[k]);
      continue;
    }
    if (!layerUsesAirDisplayDefaults(k) && sea) {
      next[k] = normalizeCssHexColor(sea, defaults[k]);
    }
  }
  return next;
}

function migrateAirFusionNeutralColors(
  p: Record<string, unknown>,
  layerColors: Record<TrackLayerKey, string>,
): AirFusionNeutralColors {
  const defaults = defaultAirFusionNeutralColors();
  const raw = p.airFusionNeutralColorBySubtype;
  const by =
    raw && typeof raw === "object" ? (raw as Record<string, string>) : null;
  const birdFromLayer = layerColors.fuse_air?.trim() || defaults.bird;
  const bird =
    by && typeof by.bird === "string" && by.bird.trim()
      ? normalizeCssHexColor(by.bird, defaults.bird)
      : normalizeCssHexColor(birdFromLayer, defaults.bird);
  const uavRaw =
    by && typeof by.uav === "string" && by.uav.trim()
      ? normalizeCssHexColor(by.uav, defaults.uav)
      : defaults.uav;
  /** 旧默认黄 `#facc15` / 短暂白 `#ffffff` → 新默认浅绿，避免 localStorage 残留 */
  const uav =
    uavRaw === "#facc15" || uavRaw === "#ffffff" ? defaults.uav : uavRaw;
  return { bird, uav };
}

export const useTrackDisplayStore = create<TrackDisplayState>()(
  persist(
    (set) => ({
      neutralColorByLayer: defaultNeutralColorByLayer(),
      airFusionNeutralColorBySubtype: defaultAirFusionNeutralColors(),
      vectorLengthSecondsByLayer: defaultSecondsByLayer(60),
      trailLengthSecondsByLayer: defaultSecondsByLayer(600),
      trackSubtypeVisible: defaultTrackSubtypeVisible(),
      airFusionSubtypeVisible: { ...DEFAULT_AIR_FUSION_SUBTYPE_VISIBLE },
      displayRevision: 0,

      setNeutralColorForLayer: (key, c) =>
        set((s) => {
          const fb = s.neutralColorByLayer[key] ?? defaultNeutralColorByLayer()[key];
          const next = normalizeCssHexColor(c, fb);
          /** 改对空融合整层色时同步鸟色，兼容旧单色入口 */
          if (key === "fuse_air") {
            const airFb = s.airFusionNeutralColorBySubtype.bird;
            return {
              neutralColorByLayer: {
                ...s.neutralColorByLayer,
                [key]: next,
              },
              airFusionNeutralColorBySubtype: {
                ...s.airFusionNeutralColorBySubtype,
                bird: normalizeCssHexColor(c, airFb),
              },
              displayRevision: s.displayRevision + 1,
            };
          }
          return {
            neutralColorByLayer: {
              ...s.neutralColorByLayer,
              [key]: next,
            },
            displayRevision: s.displayRevision + 1,
          };
        }),
      setAirFusionNeutralColorForSubtype: (key, c) =>
        set((s) => {
          const defaults = defaultAirFusionNeutralColors();
          const fb = s.airFusionNeutralColorBySubtype[key] ?? defaults[key];
          const next = normalizeCssHexColor(c, fb);
          const airFusionNeutralColorBySubtype = {
            ...s.airFusionNeutralColorBySubtype,
            [key]: next,
          };
          return {
            airFusionNeutralColorBySubtype,
            /** 鸟色同步到 fuse_air，便于旧读取路径与迁移 */
            neutralColorByLayer:
              key === "bird"
                ? { ...s.neutralColorByLayer, fuse_air: next }
                : s.neutralColorByLayer,
            displayRevision: s.displayRevision + 1,
          };
        }),
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
      /** 将尾迹秒数同步到全部航迹类型（避免只改了当前 tab 却看着别的图层长尾迹） */
      setTrailLengthSecondsForAllLayers: (sec) =>
        set((s) => {
          const v = clamp(Math.round(sec), 1, 1800);
          return {
            trailLengthSecondsByLayer: defaultSecondsByLayer(v),
            displayRevision: s.displayRevision + 1,
          };
        }),
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
      setTrackSubtypeVisible: (key, visible) =>
        set((s) => ({
          trackSubtypeVisible: { ...s.trackSubtypeVisible, [key]: visible },
          displayRevision: s.displayRevision + 1,
        })),
      setAirFusionSubtypesVisible: (visible) =>
        set((s) => ({
          airFusionSubtypeVisible: { uav: visible, bird: visible },
          displayRevision: s.displayRevision + 1,
        })),
      setAllTrackSubtypesVisible: (visible) =>
        set((s) => ({
          trackSubtypeVisible: Object.fromEntries(
            getTrackLayerKeysOrdered().map((k) => [k, visible]),
          ) as Record<TrackLayerKey, boolean>,
          airFusionSubtypeVisible: { uav: visible, bird: visible },
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
        neutralColorByLayer: s.neutralColorByLayer,
        airFusionNeutralColorBySubtype: s.airFusionNeutralColorBySubtype,
        vectorLengthSecondsByLayer: s.vectorLengthSecondsByLayer,
        trailLengthSecondsByLayer: s.trailLengthSecondsByLayer,
        trackSubtypeVisible: s.trackSubtypeVisible,
        airFusionSubtypeVisible: s.airFusionSubtypeVisible,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        // 兼容：若 v4 为空，尝试读 v3 / v2 旧键
        let legacy: Record<string, unknown> = {};
        let migratedFromV3 = false;
        if (typeof window !== "undefined" && Object.keys(p).length === 0) {
          try {
            const rawV3 = window.localStorage.getItem("nexus-ui-track-display-v3");
            if (rawV3) {
              legacy = (JSON.parse(rawV3)?.state ?? JSON.parse(rawV3) ?? {}) as Record<string, unknown>;
              migratedFromV3 = true;
            } else {
              const raw = window.localStorage.getItem("nexus-ui-track-display-v2");
              if (raw) legacy = (JSON.parse(raw)?.state ?? JSON.parse(raw) ?? {}) as Record<string, unknown>;
            }
          } catch {
            /* ignore */
          }
        }
        const src = Object.keys(p).length > 0 ? p : legacy;
        const mergedSub = {
          ...defaultTrackSubtypeVisible(),
          ...((src.trackSubtypeVisible as Record<TrackLayerKey, boolean>) ?? {}),
        };
        if (migratedFromV3) {
          mergedSub.auto_bird_radar = true;
        }
        const mergedAirSub = {
          ...DEFAULT_AIR_FUSION_SUBTYPE_VISIBLE,
          ...((src.airFusionSubtypeVisible as AirFusionSubtypeVisibility) ?? {}),
        };
        const defaultVec = defaultSecondsByLayer(60);
        const defaultTrail = defaultSecondsByLayer(600);
        const vectorLengthSecondsByLayer = migrateSecondsByLayer(
          src,
          "vectorLengthSecondsByLayer",
          "vectorLengthSecondsSea",
          "vectorLengthSecondsAir",
          "vectorLengthSeconds",
          defaultVec,
          coerceVec,
        );
        const trailLengthSecondsByLayer = migrateSecondsByLayer(
          src,
          "trailLengthSecondsByLayer",
          "trailLengthSecondsSea",
          "trailLengthSecondsAir",
          "trailLengthSeconds",
          defaultTrail,
          coerceTrail,
        );
        const neutralColorByLayer = migrateNeutralColorByLayer(src);
        const airFusionNeutralColorBySubtype = migrateAirFusionNeutralColors(
          src,
          neutralColorByLayer,
        );
        return {
          ...current,
          neutralColorByLayer: {
            ...neutralColorByLayer,
            fuse_air: airFusionNeutralColorBySubtype.bird,
          },
          airFusionNeutralColorBySubtype,
          vectorLengthSecondsByLayer,
          trailLengthSecondsByLayer,
          trackSubtypeVisible: mergedSub,
          airFusionSubtypeVisible: mergedAirSub,
        };
      },
    },
  ),
);

export function neutralColorForLayer(
  key: TrackLayerKey,
  colors: Record<TrackLayerKey, string>,
): string {
  const fb = defaultNeutralColorByLayer()[key];
  return normalizeCssHexColor(colors[key] ?? fb, fb);
}

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
    | "classifiedType"
    | "trackCategoryId"
    | "isUav"
  >,
  colors: Record<TrackLayerKey, string>,
  airFusionColors?: AirFusionNeutralColors | null,
): string {
  const lk = resolveTrackLayerKey(track);
  if (lk === "fuse_air") {
    const defaults = defaultAirFusionNeutralColors();
    const bird = isAirTrackBirdGlyph(track);
    const palette: AirFusionNeutralColors = {
      bird: airFusionColors?.bird ?? colors.fuse_air ?? defaults.bird,
      uav: airFusionColors?.uav ?? defaults.uav,
    };
    const raw = bird ? palette.bird : palette.uav;
    return normalizeCssHexColor(raw, bird ? defaults.bird : defaults.uav);
  }
  return neutralColorForLayer(lk, colors);
}

/** 自报位圆点填色（航迹显示里配置，与敌我属性无关） */
export function uavPoseTrackDotColor(state: Pick<TrackDisplayState, "neutralColorByLayer">): string {
  return neutralColorForLayer("uav_pose_track", state.neutralColorByLayer);
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
