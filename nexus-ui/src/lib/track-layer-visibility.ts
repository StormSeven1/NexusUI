/**
 * 地图航迹显隐：
 * - 图层侧边栏：`lyr-tracks` 总开关；
 * - 目标侧边栏：`trackSubtypeVisible`（track-display-store）按 DDS 来源分类。
 */

import type { Track } from "@/lib/map-entity-model";
import {
  LYR_TRACKS,
  TRACK_LAYER_KEYS_ORDERED,
  type TrackLayerKey,
} from "@/lib/map-entity-model";
import { isAirTrackBirdGlyph } from "@/lib/map-icons";

export type TrackSubtypeVisibility = Record<TrackLayerKey, boolean>;
export type AirFusionSubtypeVisibility = {
  uav: boolean;
  bird: boolean;
};

export const DEFAULT_AIR_FUSION_SUBTYPE_VISIBLE: AirFusionSubtypeVisibility = {
  uav: true,
  bird: true,
};

/** 与 Custombackend `receiver_manager.TRACK_LAYER_KEY_BY_RECEIVER` 一致 */
export const TRACK_LAYER_KEY_BY_DDS_SOURCE_ID: Record<string, TrackLayerKey> = {
  dds_forward_fuse_track: "fuse_sea",
  dds_forward_fuse_bird_radar_track: "fuse_air",
  dds_forward_bird_radar_track: "bird_radar",
  dds_forward_radar_track1: "radar_wharf",
  dds_forward_radar_track2: "radar_jingzi",
  dds_forward_ais_track: "ais_track",
};

/** 目标列表 / 航迹显示面板共用标签 */
export const TRACK_SUBTYPE_LABELS: Record<TrackLayerKey, string> = {
  fuse_sea: "对海融合航迹",
  fuse_air: "对空融合航迹",
  bird_radar: "探鸟雷达航迹",
  radar_wharf: "远遥码头雷达航迹",
  radar_jingzi: "靖子头雷达航迹",
  ais_track: "AIS 航迹",
};

/** 雷达类 DDS 来源：地图上用圆点而非军标 */
export function isRadarTrackLayerKey(k: TrackLayerKey): boolean {
  return k === "bird_radar" || k === "radar_wharf" || k === "radar_jingzi";
}

/** 地图与目标列表上用圆点表示的航迹（雷达 + AIS） */
export function isDotTrackLayerKey(k: TrackLayerKey): boolean {
  return isRadarTrackLayerKey(k) || k === "ais_track";
}

type LayerResolveInput = Pick<
  Track,
  "trackLayerKey" | "ddsSourceId" | "dataSourceId" | "sensor" | "targetType" | "name" | "isAirTrack" | "type"
>;

function inferTrackLayerKeyFromText(track: LayerResolveInput): TrackLayerKey | undefined {
  const idBlob = `${track.ddsSourceId ?? ""} ${track.dataSourceId ?? ""}`.toLowerCase();
  const textBlob = `${idBlob} ${track.sensor ?? ""} ${track.targetType ?? ""} ${track.name ?? ""}`.toLowerCase();
  /**
   * **只认完整 `dds_forward_*` token**，不认「对海融合/对空融合」等中文：
   * `fusionSources` 拼进 sensor 后常含「对海融合(…)」，若用中文匹配会把码头/靖子头/探鸟雷达整条判成融合。
   */
  if (/\bdds_forward_radar_track2\b/.test(textBlob)) return "radar_jingzi";
  if (/\bdds_forward_radar_track1\b/.test(textBlob)) return "radar_wharf";
  /** 须先于 `dds_forward_bird_radar_track`：对空融合 id 含子串 bird_radar */
  if (/\bdds_forward_fuse_bird_radar_track\b/.test(textBlob)) return "fuse_air";
  if (/\bdds_forward_fuse_track\b/.test(textBlob)) return "fuse_sea";
  if (/\bdds_forward_bird_radar_track\b/.test(textBlob)) return "bird_radar";
  if (/\bdds_forward_ais_track\b/.test(textBlob)) return "ais_track";
  return undefined;
}

/**
 * 解析航迹所属「目标侧边栏」分类键。
 * 顺序：**`dds_source_id` 映射（权威）** → `track_layer_key` → 文本中的完整 dds id → 对空/对海兜底。
 * DDS 接收器 id 优先于报文里的 `track_layer_key`（解析器偶发错写时仍以接收器为准）。
 */
export function resolveTrackLayerKey(track: LayerResolveInput): TrackLayerKey {
  const rid = track.ddsSourceId?.trim().toLowerCase();
  if (rid && TRACK_LAYER_KEY_BY_DDS_SOURCE_ID[rid]) {
    return TRACK_LAYER_KEY_BY_DDS_SOURCE_ID[rid];
  }
  if (track.trackLayerKey) return track.trackLayerKey;
  const inferred = inferTrackLayerKeyFromText(track);
  if (inferred) return inferred;
  /**
   * 勿用 `track.type === "air" → fuse_air`：探鸟/对空融合在表面上均为 air，
   * 误判会把探鸟雷达航迹归进「对空融合」开关。
   */
  return track.isAirTrack === true ? "fuse_air" : "fuse_sea";
}

/** @deprecated 使用 `resolveTrackLayerKey`（不再默认全部为对海融合） */
export function effectiveTrackLayerKey(track: LayerResolveInput): TrackLayerKey {
  return resolveTrackLayerKey(track);
}

/** 参与 GeoJSON 指纹：总开关 + 各分类（顺序固定） */
export function trackMapVisibilitySignature(
  layerVisibility: Record<string, boolean>,
  subtypeVisible: TrackSubtypeVisibility,
  airSubtypeVisible: AirFusionSubtypeVisibility,
): string {
  const master = layerVisibility[LYR_TRACKS] !== false ? "1" : "0";
  const sub = TRACK_LAYER_KEYS_ORDERED.map((k) => (subtypeVisible[k] !== false ? "1" : "0")).join("");
  const airSub = `${airSubtypeVisible.uav !== false ? "1" : "0"}${airSubtypeVisible.bird !== false ? "1" : "0"}`;
  return `${master}:${sub}:${airSub}`;
}

/**
 * 对空融合(`fuse_air`)细分显隐：
 * - 无人机：`trackCategoryId === 3`（无分类时 `isUav === true`）
 * - 鸟：其余类别
 */
function isAirFusionTrackVisible(
  track: Pick<Track, "type" | "trackCategoryId" | "isUav">,
  airSubtypeVisible: AirFusionSubtypeVisibility,
): boolean {
  const bird = isAirTrackBirdGlyph(track);
  return bird ? (airSubtypeVisible.bird !== false) : (airSubtypeVisible.uav !== false);
}

export function isTrackVisibleBySubtype(
  track: Track,
  subtypeVisible: TrackSubtypeVisibility,
  airSubtypeVisible: AirFusionSubtypeVisibility,
): boolean {
  const lk = resolveTrackLayerKey(track);
  if (subtypeVisible[lk] === false) return false;
  if (lk !== "fuse_air") return true;
  return isAirFusionTrackVisible(track, airSubtypeVisible);
}

export function filterTracksForMapRender(
  tracks: readonly Track[],
  layerVisibility: Record<string, boolean>,
  subtypeVisible: TrackSubtypeVisibility,
  airSubtypeVisible: AirFusionSubtypeVisibility,
): Track[] {
  if (layerVisibility[LYR_TRACKS] === false) return [];
  const out: Track[] = [];
  for (const t of tracks) {
    if (!isTrackVisibleBySubtype(t, subtypeVisible, airSubtypeVisible)) continue;
    out.push(t);
  }
  return out;
}
