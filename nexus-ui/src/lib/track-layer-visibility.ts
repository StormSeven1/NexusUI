/**
 * 地图航迹显隐：
 * - 图层面板「目标图层」：`lyr-tracks` 总开关 + `trackSubtypeVisible` 按 DDS 来源分类。
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
  bird: false,
};

/** 新用户默认：仅对海融合 + 对空融合（子项仅无人机） */
export const DEFAULT_TRACK_SUBTYPE_VISIBLE: TrackSubtypeVisibility = {
  fuse_sea: true,
  fuse_air: true,
  bird_radar: false,
  /** 探鸟雷达智能跟踪点迹 UDP；联调默认开 */
  auto_bird_radar: true,
  fanwu_car_radar: false,
  radar_wharf: false,
  radar_jingzi: false,
  ais_track: false,
  uav_pose_track: false,
  boat_self_track: false,
  xpf_track: false,
};

/** 与 Custombackend `receiver_manager.TRACK_LAYER_KEY_BY_RECEIVER` 一致 */
export const TRACK_LAYER_KEY_BY_DDS_SOURCE_ID: Record<string, TrackLayerKey> = {
  dds_forward_fuse_track: "fuse_sea",
  dds_forward_fuse_track_legacy: "fuse_sea",
  dds_forward_fuse_track_virtual: "fuse_sea",
  grpc_new_track_struct_fuse_sea: "fuse_sea",
  dds_forward_fuse_bird_radar_track: "fuse_air",
  dds_forward_fuse_bird_radar_track_virtual: "fuse_air",
  grpc_new_track_struct_fuse_air: "fuse_air",
  dds_forward_bird_radar_track: "bird_radar",
  udp_auto_bird_radar: "auto_bird_radar",
  dds_forward_auto_bird_radar_track: "auto_bird_radar",
  dds_forward_fanwu_car_track: "fanwu_car_radar",
  dds_udp_fanwucar_track: "fanwu_car_radar",
  dds_forward_radar_track1: "radar_wharf",
  dds_forward_radar_track2: "radar_jingzi",
  grpc_fusion_track_radar_wharf: "radar_wharf",
  grpc_fusion_track_radar_jingzi: "radar_jingzi",
  grpc_fusion_track_xpf: "xpf_track",
  grpc_fusion_track_boatself: "boat_self_track",
  grpc_fusion_track_ais: "ais_track",
  grpc_fusion_track_bird: "bird_radar",
  grpc_fusion_track_uav_pose: "uav_pose_track",
  grpc_fusion_track_fanwu: "fanwu_car_radar",
  grpc_fusion_track_ku: "fanwu_car_radar",
  grpc_fusion_track_auto_bird: "auto_bird_radar",
  dds_forward_ais_track: "ais_track",
  dds_forward_uav_pose_track: "uav_pose_track",
  dds_udp_boatself_track: "boat_self_track",
  dds_udp_xpf_track: "xpf_track",
};

/** 目标图层 / 目标列表 / 航迹显示面板共用标签 */
export const TRACK_SUBTYPE_LABELS: Record<TrackLayerKey, string> = {
  fuse_sea: "对海融合航迹",
  fuse_air: "对空融合航迹",
  bird_radar: "探鸟雷达航迹",
  auto_bird_radar: "探鸟雷达智能跟踪点迹",
  fanwu_car_radar: "反无车雷达航迹",
  radar_wharf: "远遥码头雷达航迹",
  radar_jingzi: "靖子头雷达航迹",
  ais_track: "AIS 航迹",
  uav_pose_track: "自报位航迹",
  boat_self_track: "船自报位航迹",
  xpf_track: "远遥鹏飞航迹",
};

/** 雷达类 DDS 来源：地图上用圆点而非军标 */
export function isRadarTrackLayerKey(k: TrackLayerKey): boolean {
  return (
    k === "bird_radar" ||
    k === "auto_bird_radar" ||
    k === "fanwu_car_radar" ||
    k === "radar_wharf" ||
    k === "radar_jingzi"
  );
}

/** AIS 航迹：地图用空心三角（非军标、非圆点） */
export function isAisTrackLayerKey(k: TrackLayerKey): boolean {
  return k === "ais_track";
}

/**
 * 地图与目标列表上用圆点表示的航迹（雷达 + 自报位）。
 * AIS 单独走空心三角，见 `isAisTrackLayerKey`。
 */
export function isDotTrackLayerKey(k: TrackLayerKey): boolean {
  return (
    isRadarTrackLayerKey(k) ||
    k === "uav_pose_track" ||
    k === "boat_self_track" ||
    k === "xpf_track"
  );
}

/** 非军标点状航迹（圆点或 AIS 三角），与融合军标相对 */
export function isNonMilSymbolTrackLayerKey(k: TrackLayerKey): boolean {
  return isDotTrackLayerKey(k) || isAisTrackLayerKey(k);
}

export type TrackLayerResolveInput = Pick<
  Track,
  "trackLayerKey" | "ddsSourceId" | "dataSourceId" | "sensor" | "targetType" | "name" | "isAirTrack" | "type"
>;

function inferTrackLayerKeyFromText(track: TrackLayerResolveInput): TrackLayerKey | undefined {
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
  if (/\budp_auto_bird_radar\b/.test(textBlob)) return "auto_bird_radar";
  if (/\bdds_forward_auto_bird_radar_track\b/.test(textBlob)) return "auto_bird_radar";
  if (/\bdds_forward_bird_radar_track\b/.test(textBlob)) return "bird_radar";
  if (/\bdds_forward_fanwu_car_track\b/.test(textBlob)) return "fanwu_car_radar";
  if (/\bdds_udp_fanwucar_track\b/.test(textBlob)) return "fanwu_car_radar";
  if (/\bgrpc_fusion_track_fanwu\b/.test(textBlob)) return "fanwu_car_radar";
  if (/\bgrpc_fusion_track_ku\b/.test(textBlob)) return "fanwu_car_radar";
  if (/\bdds_forward_ais_track\b/.test(textBlob)) return "ais_track";
  if (/\bgrpc_fusion_track_ais\b/.test(textBlob)) return "ais_track";
  if (/\bgrpc_fusion_track_bird\b/.test(textBlob)) return "bird_radar";
  if (/\bdds_forward_uav_pose_track\b/.test(textBlob)) return "uav_pose_track";
  if (/\bgrpc_fusion_track_uav_pose\b/.test(textBlob)) return "uav_pose_track";
  if (/\bgrpc_fusion_track_auto_bird\b/.test(textBlob)) return "auto_bird_radar";
  if (/\bdds_udp_boatself_track\b/.test(textBlob)) return "boat_self_track";
  if (/\bdds_udp_xpf_track\b/.test(textBlob)) return "xpf_track";
  return undefined;
}

/**
 * 解析航迹所属「目标侧边栏」分类键。
 * 顺序：**`dds_source_id` 映射（权威）** → `track_layer_key` → 文本中的完整 dds id → 对空/对海兜底。
 * DDS 接收器 id 优先于报文里的 `track_layer_key`（解析器偶发错写时仍以接收器为准）。
 */
export function resolveTrackLayerKey(track: TrackLayerResolveInput): TrackLayerKey {
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
export function effectiveTrackLayerKey(track: TrackLayerResolveInput): TrackLayerKey {
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

/** 图层面板「目标图层」UI 行数：总开关 1 + 各 DDS 分类 + 对空融合下无人机/鸟 */
export function countTargetLayerPanelUiRows(): number {
  return 1 + TRACK_LAYER_KEYS_ORDERED.length + 2;
}

/** 与 `LayerPanel` enabledCount 一致：总开关开启时计 master + 各已开分类（含对空子项） */
export function countVisibleTargetLayerLeaves(
  masterOn: boolean,
  subtypeVisible: TrackSubtypeVisibility,
  airSubtypeVisible: AirFusionSubtypeVisibility,
): number {
  if (!masterOn) return 0;
  let n = 1;
  for (const k of TRACK_LAYER_KEYS_ORDERED) {
    if (subtypeVisible[k] === false) continue;
    n += 1;
    if (k === "fuse_air") {
      if (airSubtypeVisible.uav !== false) n += 1;
      if (airSubtypeVisible.bird !== false) n += 1;
    }
  }
  return n;
}
