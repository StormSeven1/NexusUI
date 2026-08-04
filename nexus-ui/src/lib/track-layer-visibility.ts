/**
 * 地图航迹显隐：
 * - 图层面板「目标图层」：`lyr-tracks` 总开关 + `trackSubtypeVisible` 按来源分类。
 * - 旁路源列表由 `NEXUS_FUSION_TRACK_GRPC_SOURCES` 驱动（与 Custombackend 同键）。
 */

import type { Track } from "@/lib/map-entity-model";
import {
  BUILTIN_TRACK_LAYER_KEYS,
  LYR_TRACKS,
  TRACK_LAYER_KEYS_ORDERED,
  type TrackLayerKey,
} from "@/lib/map-entity-model";
import { isAirTrackBirdGlyph } from "@/lib/map-icons";

export type TrackSubtypeVisibility = Record<string, boolean>;
export type AirFusionSubtypeVisibility = {
  uav: boolean;
  bird: boolean;
};

export const DEFAULT_AIR_FUSION_SUBTYPE_VISIBLE: AirFusionSubtypeVisibility = {
  uav: true,
  bird: false,
};

/** 新用户默认：仅对海融合 + 对空融合（子项仅无人机）；旁路由配置打开 */
export const DEFAULT_TRACK_SUBTYPE_VISIBLE: TrackSubtypeVisibility = {
  fuse_sea: true,
  fuse_air: true,
  bird_radar: false,
  auto_bird_radar: true,
  fanwu_car_radar: false,
  radar_wharf: false,
  radar_jingzi: false,
  ais_track: false,
  uav_pose_track: false,
  boat_self_track: false,
  xpf_track: false,
  ku_lei_da: false,
};

/**
 * FusionTrack gRPC 业务 dataSourceId → 目标图层键。
 * 与 Custombackend `_FUSION_TRACK_DATASOURCE_CATALOG` 一致；未知 id 自动 layer=id。
 */
export const FUSION_TRACK_DATASOURCE_TO_LAYER: Record<string, TrackLayerKey> = {
  yuan_yao: "radar_wharf",
  jing_zi_tou: "radar_jingzi",
  udp_xpf_track: "xpf_track",
  udp_boatself_track: "boat_self_track",
  ais: "ais_track",
  tan_niao: "bird_radar",
  zi_bao_wei: "uav_pose_track",
  udp_fanwucar_track: "fanwu_car_radar",
  ku_lei_da: "ku_lei_da",
  auto_bird: "auto_bird_radar",
};

/** 图层/源显示名回退（配置未写 |显示名 时用；优先读配置） */
export const FUSION_TRACK_SOURCE_LABELS: Record<string, string> = {
  yuan_yao: "远遥码头雷达航迹",
  jing_zi_tou: "靖子头雷达航迹",
  udp_xpf_track: "远遥鹏飞航迹",
  udp_boatself_track: "船自报位航迹",
  ais: "AIS 航迹",
  tan_niao: "探鸟雷达航迹",
  zi_bao_wei: "自报位航迹",
  udp_fanwucar_track: "反无车雷达航迹",
  ku_lei_da: "Ku雷达航迹",
  auto_bird: "探鸟雷达智能跟踪点迹",
  tian_ao: "天鳌航迹",
  wu_ren_che: "无人车航迹",
  radar_wharf: "远遥码头雷达航迹",
  radar_jingzi: "靖子头雷达航迹",
  xpf_track: "远遥鹏飞航迹",
  boat_self_track: "船自报位航迹",
  ais_track: "AIS 航迹",
  bird_radar: "探鸟雷达航迹",
  uav_pose_track: "自报位航迹",
  fanwu_car_radar: "反无车雷达航迹",
  auto_bird_radar: "探鸟雷达智能跟踪点迹",
};

export type ConfiguredFusionTrackSource = {
  dataSourceId: string;
  layerKey: TrackLayerKey;
  /** 目标图层显示名（来自配置 `id|显示名`） */
  label: string;
};

const _LAYER_KEY_RE = /^[a-z][a-z0-9_]*$/i;

/**
 * 解析单项：`id` | `id|显示名` | `id:layer` | `id:layer|显示名` | `id:中文名`（冒号后非英文键视为显示名）
 */
function parseFusionTrackSourceToken(token: string): ConfiguredFusionTrackSource | null {
  let labelFromPipe: string | undefined;
  let rest = token.trim();
  if (!rest) return null;
  const pipe = rest.indexOf("|");
  if (pipe >= 0) {
    labelFromPipe = rest.slice(pipe + 1).trim() || undefined;
    rest = rest.slice(0, pipe).trim();
  }
  if (!rest) return null;

  let dataSourceId: string;
  let layerKey: string;
  let labelFromColon: string | undefined;

  if (rest.includes(":")) {
    const [ds, right] = rest.split(":", 2);
    dataSourceId = (ds ?? "").trim();
    const rightPart = (right ?? "").trim();
    if (!dataSourceId || !rightPart) return null;
    if (_LAYER_KEY_RE.test(rightPart)) {
      layerKey = rightPart;
    } else {
      layerKey = FUSION_TRACK_DATASOURCE_TO_LAYER[dataSourceId] ?? dataSourceId;
      labelFromColon = rightPart;
    }
  } else {
    dataSourceId = rest;
    layerKey = FUSION_TRACK_DATASOURCE_TO_LAYER[dataSourceId] ?? dataSourceId;
  }

  const label =
    labelFromPipe ||
    labelFromColon ||
    FUSION_TRACK_SOURCE_LABELS[layerKey] ||
    FUSION_TRACK_SOURCE_LABELS[dataSourceId] ||
    `${dataSourceId}航迹`;

  return { dataSourceId, layerKey, label };
}

/** 解析 NEXUS_FUSION_TRACK_GRPC_SOURCES（与后端同语义） */
export function parseFusionTrackGrpcSourcesEnv(
  raw: string | undefined | null = typeof process !== "undefined"
    ? process.env.NEXUS_FUSION_TRACK_GRPC_SOURCES
    : undefined,
): ConfiguredFusionTrackSource[] {
  const text = (raw ?? "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
  if (!text || text.toLowerCase() === "all" || text === "*") {
    return Object.entries(FUSION_TRACK_DATASOURCE_TO_LAYER).map(([dataSourceId, layerKey]) => ({
      dataSourceId,
      layerKey,
      label:
        FUSION_TRACK_SOURCE_LABELS[layerKey] ||
        FUSION_TRACK_SOURCE_LABELS[dataSourceId] ||
        `${dataSourceId}航迹`,
    }));
  }
  const out: ConfiguredFusionTrackSource[] = [];
  const seen = new Set<string>();
  for (const part of text.split(/[,\n\r]+/)) {
    const parsed = parseFusionTrackSourceToken(part);
    if (!parsed) continue;
    const dedupe = `${parsed.dataSourceId}::${parsed.layerKey}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push(parsed);
  }
  return out;
}

/** layerKey / dataSourceId → 配置中的显示名 */
export function fusionTrackConfiguredLabelMap(
  raw?: string | null,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const s of parseFusionTrackGrpcSourcesEnv(raw)) {
    map[s.layerKey] = s.label;
    map[s.dataSourceId] = s.label;
  }
  return map;
}

/** 目标图层面板 / 签名用的图层键顺序：对海/对空融合 + 配置旁路（按 layer 去重） */
export function getTrackLayerKeysOrdered(raw?: string | null): TrackLayerKey[] {
  const keys: TrackLayerKey[] = ["fuse_sea", "fuse_air"];
  const seen = new Set(keys);
  for (const { layerKey } of parseFusionTrackGrpcSourcesEnv(raw)) {
    if (seen.has(layerKey)) continue;
    seen.add(layerKey);
    keys.push(layerKey);
  }
  return keys;
}

/**
 * 默认显隐：融合开；配置中的旁路图层开；其余旁路关。
 */
export function trackSubtypeVisibleFromFusionTrackSourcesEnv(
  raw: string | undefined | null = typeof process !== "undefined"
    ? process.env.NEXUS_FUSION_TRACK_GRPC_SOURCES
    : undefined,
): TrackSubtypeVisibility {
  const base: TrackSubtypeVisibility = { ...DEFAULT_TRACK_SUBTYPE_VISIBLE };
  for (const k of BUILTIN_TRACK_LAYER_KEYS) {
    if (k === "fuse_sea" || k === "fuse_air") continue;
    base[k] = false;
  }
  for (const { layerKey } of parseFusionTrackGrpcSourcesEnv(raw)) {
    base[layerKey] = true;
  }
  base.fuse_sea = true;
  base.fuse_air = true;
  return base;
}

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
  grpc_fusion_track_ku: "ku_lei_da",
  grpc_fusion_track_auto_bird: "auto_bird_radar",
  grpc_fusion_track_tian_ao: "tian_ao",
  grpc_fusion_track_wu_ren_che: "wu_ren_che",
  dds_forward_ais_track: "ais_track",
  dds_forward_uav_pose_track: "uav_pose_track",
  dds_udp_boatself_track: "boat_self_track",
  dds_udp_xpf_track: "xpf_track",
};

/** 目标图层 / 目标列表 / 航迹显示面板共用标签（融合固定；旁路由配置覆盖） */
export const TRACK_SUBTYPE_LABELS: Record<string, string> = {
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
  ku_lei_da: "Ku雷达航迹",
  tian_ao: "天鳌航迹",
  wu_ren_che: "无人车航迹",
};

export function trackSubtypeLabel(key: TrackLayerKey): string {
  if (key === "fuse_sea" || key === "fuse_air") {
    return TRACK_SUBTYPE_LABELS[key] ?? key;
  }
  const fromConfig = fusionTrackConfiguredLabelMap()[key];
  if (fromConfig) return fromConfig;
  return TRACK_SUBTYPE_LABELS[key] || FUSION_TRACK_SOURCE_LABELS[key] || `${key}航迹`;
}

const SELF_REPORT_DOT_LAYERS = new Set([
  "uav_pose_track",
  "boat_self_track",
  "xpf_track",
  "zi_bao_wei",
  "udp_boatself_track",
  "udp_xpf_track",
]);

/** AIS 航迹：地图用空心三角（非军标、非圆点） */
export function isAisTrackLayerKey(k: TrackLayerKey): boolean {
  return k === "ais_track" || k === "ais";
}

/** 雷达类：地图上用圆点而非军标（含配置新增旁路源） */
export function isRadarTrackLayerKey(k: TrackLayerKey): boolean {
  if (k === "fuse_sea" || k === "fuse_air") return false;
  if (isAisTrackLayerKey(k)) return false;
  if (SELF_REPORT_DOT_LAYERS.has(k)) return false;
  if (
    k === "bird_radar" ||
    k === "auto_bird_radar" ||
    k === "fanwu_car_radar" ||
    k === "radar_wharf" ||
    k === "radar_jingzi" ||
    k === "ku_lei_da" ||
    k === "tian_ao" ||
    k === "wu_ren_che"
  ) {
    return true;
  }
  // 配置新增的旁路图层：默认按雷达圆点
  return getTrackLayerKeysOrdered().includes(k);
}

/**
 * 地图与目标列表上用圆点表示的航迹（雷达 + 自报位）。
 * AIS 单独走空心三角，见 `isAisTrackLayerKey`。
 */
export function isDotTrackLayerKey(k: TrackLayerKey): boolean {
  return isRadarTrackLayerKey(k) || SELF_REPORT_DOT_LAYERS.has(k);
}

/** 非军标点状航迹（圆点或 AIS 三角），与融合军标相对 */
export function isNonMilSymbolTrackLayerKey(k: TrackLayerKey): boolean {
  return isDotTrackLayerKey(k) || isAisTrackLayerKey(k);
}

export type TrackLayerResolveInput = Pick<
  Track,
  | "trackLayerKey"
  | "ddsSourceId"
  | "dataSourceId"
  | "sensor"
  | "targetType"
  | "name"
  | "isAirTrack"
  | "type"
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
  if (/\bgrpc_fusion_track_ku\b/.test(textBlob)) return "ku_lei_da";
  if (/\bgrpc_fusion_track_tian_ao\b/.test(textBlob)) return "tian_ao";
  if (/\bgrpc_fusion_track_wu_ren_che\b/.test(textBlob)) return "wu_ren_che";
  if (/\bdds_forward_ais_track\b/.test(textBlob)) return "ais_track";
  if (/\bgrpc_fusion_track_ais\b/.test(textBlob)) return "ais_track";
  if (/\bgrpc_fusion_track_bird\b/.test(textBlob)) return "bird_radar";
  if (/\bdds_forward_uav_pose_track\b/.test(textBlob)) return "uav_pose_track";
  if (/\bgrpc_fusion_track_uav_pose\b/.test(textBlob)) return "uav_pose_track";
  if (/\bgrpc_fusion_track_auto_bird\b/.test(textBlob)) return "auto_bird_radar";
  if (/\bdds_udp_boatself_track\b/.test(textBlob)) return "boat_self_track";
  if (/\bdds_udp_xpf_track\b/.test(textBlob)) return "xpf_track";
  const ds = (track.dataSourceId ?? "").trim();
  if (ds && FUSION_TRACK_DATASOURCE_TO_LAYER[ds]) return FUSION_TRACK_DATASOURCE_TO_LAYER[ds];
  if (ds && getTrackLayerKeysOrdered().includes(ds)) return ds;
  return undefined;
}

/**
 * 解析航迹所属「目标侧边栏」分类键。
 * 顺序：**`dds_source_id` 映射（权威）** → `track_layer_key` → 文本中的完整 dds id → 对空/对海兜底。
 */
export function resolveTrackLayerKey(track: TrackLayerResolveInput): TrackLayerKey {
  const rid = track.ddsSourceId?.trim().toLowerCase();
  if (rid && TRACK_LAYER_KEY_BY_DDS_SOURCE_ID[rid]) {
    return TRACK_LAYER_KEY_BY_DDS_SOURCE_ID[rid];
  }
  // 动态 grpc_fusion_track_<id>
  if (rid?.startsWith("grpc_fusion_track_")) {
    const suffix = rid.slice("grpc_fusion_track_".length);
    if (suffix) {
      const byDs = FUSION_TRACK_DATASOURCE_TO_LAYER[suffix];
      if (byDs) return byDs;
      if (TRACK_SUBTYPE_LABELS[suffix] || getTrackLayerKeysOrdered().includes(suffix)) {
        return suffix;
      }
      return suffix;
    }
  }
  if (track.trackLayerKey) return track.trackLayerKey;
  const inferred = inferTrackLayerKeyFromText(track);
  if (inferred) return inferred;
  return track.isAirTrack === true ? "fuse_air" : "fuse_sea";
}

/** @deprecated 使用 `resolveTrackLayerKey` */
export function effectiveTrackLayerKey(track: TrackLayerResolveInput): TrackLayerKey {
  return resolveTrackLayerKey(track);
}

/** 参与 GeoJSON 指纹：总开关 + 各分类（顺序随配置） */
export function trackMapVisibilitySignature(
  layerVisibility: Record<string, boolean>,
  subtypeVisible: TrackSubtypeVisibility,
  airSubtypeVisible: AirFusionSubtypeVisibility,
): string {
  const master = layerVisibility[LYR_TRACKS] !== false ? "1" : "0";
  const keys = getTrackLayerKeysOrdered();
  const sub = keys.map((k) => (subtypeVisible[k] !== false ? "1" : "0")).join("");
  const airSub = `${airSubtypeVisible.uav !== false ? "1" : "0"}${airSubtypeVisible.bird !== false ? "1" : "0"}`;
  return `${master}:${sub}:${airSub}`;
}

function isAirFusionTrackVisible(
  track: Pick<Track, "type" | "trackCategoryId" | "isUav">,
  airSubtypeVisible: AirFusionSubtypeVisibility,
): boolean {
  const bird = isAirTrackBirdGlyph(track);
  return bird ? airSubtypeVisible.bird !== false : airSubtypeVisible.uav !== false;
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

/** 图层面板「目标图层」UI 行数：总开关 1 + 各分类 + 对空融合下无人机/鸟 */
export function countTargetLayerPanelUiRows(): number {
  return 1 + getTrackLayerKeysOrdered().length + 2;
}

/** 与 `LayerPanel` enabledCount 一致 */
export function countVisibleTargetLayerLeaves(
  masterOn: boolean,
  subtypeVisible: TrackSubtypeVisibility,
  airSubtypeVisible: AirFusionSubtypeVisibility,
): number {
  if (!masterOn) return 0;
  let n = 1;
  for (const k of getTrackLayerKeysOrdered()) {
    if (subtypeVisible[k] === false) continue;
    n += 1;
    if (k === "fuse_air") {
      if (airSubtypeVisible.uav !== false) n += 1;
      if (airSubtypeVisible.bird !== false) n += 1;
    }
  }
  return n;
}

/** 兼容旧引用 */
export { TRACK_LAYER_KEYS_ORDERED };
