import type maplibregl from "maplibre-gl";
import type { FilterSpecification } from "maplibre-gl";
import { trackMapDisplayId, trackMapLabelRecvTime, type Track } from "@/lib/map-entity-model";
import {
  getMarkerSymbolId,
  TRACK_SELECT_RING_ID,
  LOCK_ON_IMAGE_ID,
  resolveTrackPointFill,
  buildMarkerSymbolDataUrl,
  aisHollowTriangleImageId,
  buildAisHollowTriangleDataUrl,
  isAirTrackBirdGlyph,
  isSeaTrackBuoyGlyph,
  isSeaTrackReefGlyph,
  type AssetDispositionIconAccent,
} from "@/lib/map-icons";
import { resolveTrackMapHighlightFill, shouldApplySuspiciousTrackGreen } from "@/lib/track-map-highlight-color";
import { shouldApplyVerifiedTrackYellow } from "@/lib/verified-track-color";
import { loadSvgImage } from "@/lib/map-image-loader";
import { threatRankBadgeImageId } from "@/lib/map-icons";
import { isTrackVirtualTroop } from "@/lib/track-reality-type";
import { isTrackCoasting } from "@/lib/track-target-state";
import { getTrackRenderingConfig } from "@/lib/map-app-config";
import { markTrackPhase } from "@/lib/track-perf";
import { getTrackDispositionForRendering, isTrackAlarmLinked, useTrackStore } from "@/stores/track-store";
import { useVerifiedTrackStore } from "@/stores/verified-track-store";
import {
  useTrackDisplayStore,
  neutralColorForLayer,
  neutralFusionColorForTrack,
  trailLengthSecondsForTrack,
  vectorLengthSecondsForTrack,
} from "@/stores/track-display-store";
import { trimHistoryTrailForDisplay, velocityVectorEndLngLat } from "@/lib/track-display-trail";
import { useAppStore } from "@/stores/app-store";
import {
  filterTracksForMapRender,
  isAisTrackLayerKey,
  isDotTrackLayerKey,
  isNonMilSymbolTrackLayerKey,
  resolveTrackLayerKey,
  trackMapVisibilitySignature,
} from "@/lib/track-layer-visibility";
import { TRACK_LAYER_KEYS_ORDERED, LYR_TRACKS } from "@/lib/map-entity-model";

/** GeoJSON source id：非对海融合的 **LineString**（尾迹 + 速度矢量） */
export const TRACK_SOURCE = "tracks-source";

/** 对海融合专用折线源：与其它航迹拆开，避免全图顶点预算重分配时反复拆建对海尾迹 */
export const TRACK_SOURCE_FUSE_SEA = "tracks-source-fuse-sea";

/**
 * 融合航迹点要素（对空等军标，**不含对海融合**）；与高亮环同源
 */
export const TRACK_FUSION_PTS_SOURCE = "tracks-fusion-pts";

/**
 * 对海融合专用点源：与对空等拆开，避免对空高频 setData 连带刷对海军标（闪烁）。
 */
export const TRACK_FUSE_SEA_PTS_SOURCE = "tracks-fuse-sea-pts";

/** 雷达 / AIS / 自报位航迹点要素：圆点或 AIS 空心三角，与高亮环同源 */
export const TRACK_RADAR_PTS_SOURCE = "tracks-radar-pts";

/** 多选高亮环：`insertBeforeLayerId` 指向本层时，雷达/光电等专题层会插在其下（由下至上绘制，高亮环盖在专题层之上） */
export const HIGHLIGHT_LAYER = "tracks-highlight";

/** 对海融合多选高亮 */
export const HIGHLIGHT_FUSE_SEA_LAYER = "tracks-highlight-fuse-sea";

/** 雷达航迹多选高亮（与 `HIGHLIGHT_LAYER` 同源 filter，数据源为雷达点） */
export const HIGHLIGHT_RADAR_LAYER = "tracks-highlight-radar";

export const TRACK_TRAIL = "tracks-trail";
export const TRACK_TRAIL_FUSE_SEA = "tracks-trail-fuse-sea";
/** 速度矢量（course×速度×秒） */
export const TRACK_VECTOR = "tracks-vector";
export const TRACK_VECTOR_FUSE_SEA = "tracks-vector-fuse-sea";
export const TRACK_SYMBOL = "tracks-symbol";
/** 对海融合军标（独立源，避免被对空刷新牵连） */
export const TRACK_SYMBOL_FUSE_SEA = "tracks-symbol-fuse-sea";
/** 探鸟/码头/靖子头雷达等：圆点（数据源 `TRACK_RADAR_PTS_SOURCE`，排除 AIS） */
export const TRACK_DOT = "tracks-dot";
/** AIS 航迹：空心三角（同源 `TRACK_RADAR_PTS_SOURCE`，`layerKey=ais_track`） */
export const TRACK_AIS = "tracks-ais";
export const TRACK_LABEL = "tracks-label";
export const TRACK_LABEL_FUSE_SEA = "tracks-label-fuse-sea";
export const TRACK_LABEL_RADAR = "tracks-label-radar";
/** 告警航迹威胁 Top5 序号（红底 1–5，叠在航迹符号上方） */
export const TRACK_THREAT_RANK = "tracks-threat-rank";
export const TRACK_THREAT_RANK_SOURCE = "tracks-threat-rank-source";
/** 锁定圈：`setLockOnFilter` 更新 filter */
export const LOCK_ON = "tracks-lock-on";
export const LOCK_ON_FUSE_SEA = "tracks-lock-on-fuse-sea";
export const LOCK_ON_RADAR = "tracks-lock-on-radar";

/** 与点符号/高亮/锁定混用同一 GeoJSON 源时，排除折线要素（须用旧版 `$type` 过滤器，勿用 `["geometry-type"]` 表达式，否则 MapLibre 报 string expected, array found） */
const GEOM_POINT: FilterSpecification = ["==", "$type", "Point"];

function filterPointsOnly(extra: FilterSpecification | null): FilterSpecification {
  if (!extra) return GEOM_POINT;
  return ["all", GEOM_POINT, extra] as unknown as FilterSpecification;
}

/** 图层面板 `lyr-tracks`、事件绑定等与 `layer.id` 一致 */
export const TRACK_LAYER_IDS = [
  TRACK_TRAIL,
  TRACK_TRAIL_FUSE_SEA,
  TRACK_VECTOR,
  TRACK_VECTOR_FUSE_SEA,
  TRACK_DOT,
  TRACK_AIS,
  TRACK_SYMBOL,
  TRACK_SYMBOL_FUSE_SEA,
  TRACK_LABEL,
  TRACK_LABEL_FUSE_SEA,
  TRACK_LABEL_RADAR,
  TRACK_THREAT_RANK,
  HIGHLIGHT_LAYER,
  HIGHLIGHT_FUSE_SEA_LAYER,
  HIGHLIGHT_RADAR_LAYER,
  LOCK_ON,
  LOCK_ON_FUSE_SEA,
  LOCK_ON_RADAR,
] as const;

/** 点选：军标层 + 对海军标 + 雷达圆点层 + AIS 三角层 */
export const TRACK_PICK_LAYERS = [TRACK_SYMBOL, TRACK_SYMBOL_FUSE_SEA, TRACK_DOT, TRACK_AIS] as const;

function partitionMilSymbolTracks(tracks: ReadonlyArray<Track>): {
  fuseSea: Track[];
  otherFusion: Track[];
} {
  const fuseSea: Track[] = [];
  const otherFusion: Track[] = [];
  for (const t of tracks) {
    const lk = resolveTrackLayerKey(t);
    if (isNonMilSymbolTrackLayerKey(lk)) continue;
    if (lk === "fuse_sea") fuseSea.push(t);
    else otherFusion.push(t);
  }
  return { fuseSea, otherFusion };
}

const TRACK_SYMBOL_LAYOUT = {
  "icon-image": ["get", "symbolId"],
  "icon-rotate": [
    "case",
    [
      "all",
      ["==", ["get", "type"], "air"],
      ["==", ["coalesce", ["get", "isFuseAirTrack"], false], true],
      ["==", ["coalesce", ["get", "isAirBirdGlyph"], false], true],
    ],
    0,
    ["==", ["coalesce", ["get", "isSeaBuoyGlyph"], false], true],
    0,
    ["==", ["coalesce", ["get", "isSeaReefGlyph"], false], true],
    0,
    ["coalesce", ["get", "heading"], ["get", "course"], 0],
  ],
  "icon-rotation-alignment": "map",
  "icon-pitch-alignment": "map",
  "icon-size": [
    "interpolate",
    ["linear"],
    ["zoom"],
    5,
    ["*", ["coalesce", ["get", "iconScale"], 1], 0.55],
    10,
    ["*", ["coalesce", ["get", "iconScale"], 1], 0.8],
    15,
    ["*", ["coalesce", ["get", "iconScale"], 1], 1.05],
  ],
  "icon-allow-overlap": true,
  "icon-ignore-placement": true,
} as maplibregl.SymbolLayerSpecification["layout"];

/** 航迹点标签 text-field：可选首行时间（略小）+ 编号 */
const TRACK_LABEL_TEXT_FIELD: maplibregl.ExpressionSpecification = [
  "case",
  ["all", ["has", "mapLabelTime"], ["!=", ["to-string", ["get", "mapLabelTime"]], ""]],
  [
    "case",
    ["all", ["has", "mapLabelText"], ["!=", ["to-string", ["get", "mapLabelText"]], ""]],
    [
      "format",
      ["get", "mapLabelTime"],
      { "font-scale": 0.72 },
      "\n",
      {},
      ["get", "mapLabelText"],
      {},
    ],
    ["format", ["get", "mapLabelTime"], { "font-scale": 0.72 }],
  ],
  ["coalesce", ["get", "mapLabelText"], ["get", "name"], ""],
];

const TRACK_LABEL_LAYOUT = {
  "text-field": TRACK_LABEL_TEXT_FIELD,
  "text-font": ["Open Sans Regular"],
  "text-size": 10,
  "text-offset": [0, 2.2],
  "text-anchor": "top",
  "text-max-width": 12,
  "text-allow-overlap": true,
  "text-ignore-placement": true,
} as maplibregl.SymbolLayerSpecification["layout"];

function trackLabelProps(t: Track): { mapLabelText: string; mapLabelTime: string } {
  const td = getTrackRenderingConfig().trackDisplay;
  return {
    mapLabelText: td.showTrackId ? trackMapDisplayId(t) : "",
    mapLabelTime: td.showTrackRecvTime ? trackMapLabelRecvTime(t) : "",
  };
}

/**
 * 纯表达式写法（`["geometry-type"]`），避免与 `["get", ...]` 混用传统 `$type` 导致
 * 部分 MapLibre 版本静默拒绝 addLayer。
 */
const LINE_TRAIL_FILTER: FilterSpecification = [
  "all",
  ["==", ["geometry-type"], "LineString"],
  ["!=", ["coalesce", ["get", "_lineKind"], "trail"], "vector"],
] as unknown as FilterSpecification;

const LINE_VECTOR_FILTER: FilterSpecification = [
  "all",
  ["==", ["geometry-type"], "LineString"],
  ["==", ["get", "_lineKind"], "vector"],
] as unknown as FilterSpecification;

function trailForTrackDisplay(t: Track, trailSec: number): [number, number][] | undefined {
  return trimHistoryTrailForDisplay(
    t.historyTrail,
    trailSec,
    t.speed,
    [t.lng, t.lat],
    t.historyTrailAtMs,
  );
}

/**
 * 与 `trackRendering.trackDisplay.maxViewportPoints` 对齐的顶点估算：每条航迹计 `1 + len(historyTrail)`（当前点 + 历史折线顶点数）。
 * **不修改** `Track`；仅用于判断是否绘制历史折线。
 */
export function trackMapVertexEstimate(tracks: ReadonlyArray<Track>): number {
  const td = useTrackDisplayStore.getState();
  return tracks.reduce((n, t) => {
    const trailSec = trailLengthSecondsForTrack(t, td);
    const tr = trailForTrackDisplay(t, trailSec);
    return n + 1 + (tr?.length ?? 0);
  }, 0);
}

/** 尾迹折线绘制计划：`maxViewportPoints` 超预算时按条分配，避免整批尾迹突然消失 */
export type TrackTrailDrawPlan =
  | { mode: "none" }
  | { mode: "all" }
  | { mode: "partial"; maxTrailPointsByTrackId: Map<string, number> };

function trailDrawPlanCacheSig(plan: TrackTrailDrawPlan): string {
  if (plan.mode === "all") return "all";
  if (plan.mode === "none") return "none";
  let h = plan.maxTrailPointsByTrackId.size;
  for (const [id, n] of plan.maxTrailPointsByTrackId) {
    h = (h ^ id.length ^ n) >>> 0;
    for (let i = 0; i < Math.min(id.length, 12); i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return `p${h}`;
}

/**
 * 在 `maxViewportPoints` 预算内决定各航迹可绘制的尾迹点数。
 *
 * 面板秒数是「上限」：`trim` 已按 `min(请求秒, 内存已有)`。全图顶点过多时按比例缩短各条，
 * **不因拉大秒数把某条抹掉**；数据只有 40s 时，40/100/1000 的 trim 结果相同，预算亦相同。
 */
export function computeTrackTrailDrawPlan(tracks: ReadonlyArray<Track>): TrackTrailDrawPlan {
  const max = getTrackRenderingConfig().trackDisplay.maxViewportPoints;
  if (!Number.isFinite(max)) return { mode: "all" };
  if (max <= 0) return { mode: "none" };
  if (trackMapVertexEstimate(tracks) <= max) return { mode: "all" };

  const td = useTrackDisplayStore.getState();
  const candidates = tracks
    .map((t) => {
      const trailSec = trailLengthSecondsForTrack(t, td);
      const tr = trailForTrackDisplay(t, trailSec);
      const len = tr?.length ?? 0;
      return { t, len };
    })
    .filter((c) => c.len >= 1);

  if (candidates.length === 0) return { mode: "none" };

  /** 每条折线含当前点，历史点总预算 */
  const histBudget = max - candidates.length;
  if (histBudget <= 0) return { mode: "none" };

  const totalHist = candidates.reduce((n, c) => n + c.len, 0);
  if (totalHist <= histBudget) return { mode: "all" };

  const ranked = [...candidates].sort((a, b) => {
    const pa = isTrackAlarmLinked(a.t) ? 0 : 1;
    const pb = isTrackAlarmLinked(b.t) ? 0 : 1;
    return pa - pb;
  });

  const caps = new Map<string, number>();
  let allocated = 0;
  for (const c of ranked) {
    const w = isTrackAlarmLinked(c.t) ? 1.25 : 1;
    const raw = Math.floor((c.len * histBudget * w) / totalHist);
    const histCap = Math.max(1, Math.min(c.len, raw));
    caps.set(c.t.id, histCap);
    allocated += histCap;
  }

  if (allocated > histBudget) {
    const s = histBudget / allocated;
    allocated = 0;
    for (const c of ranked) {
      const cur = caps.get(c.t.id) ?? 1;
      const next = Math.max(1, Math.min(c.len, Math.floor(cur * s)));
      caps.set(c.t.id, next);
      allocated += next;
    }
  }

  let rem = histBudget - allocated;
  for (const c of ranked) {
    if (rem <= 0) break;
    const cur = caps.get(c.t.id) ?? 0;
    const room = c.len - cur;
    if (room <= 0) continue;
    const add = Math.min(room, rem);
    caps.set(c.t.id, cur + add);
    rem -= add;
  }

  return { mode: "partial", maxTrailPointsByTrackId: caps };
}

function trailForDrawPlan(
  plan: TrackTrailDrawPlan,
  trackId: string,
  trail: [number, number][] | undefined,
): [number, number][] | undefined {
  if (!trail?.length) return trail;
  if (plan.mode === "none") return undefined;
  if (plan.mode === "all") return trail;
  const cap = plan.maxTrailPointsByTrackId.get(trackId);
  if (cap == null) return trail;
  if (cap <= 0) return trail.slice(-1);
  if (trail.length <= cap) return trail;
  return trail.slice(-cap);
}

/** 单条航迹在地图上的尾迹折线点（已套用面板时长 + 全图顶点预算） */
export function displayHistoryTrailForTrack(
  plan: TrackTrailDrawPlan,
  t: Track,
): [number, number][] | undefined {
  const td = useTrackDisplayStore.getState();
  return trailForDrawPlan(
    plan,
    t.id,
    trailForTrackDisplay(t, trailLengthSecondsForTrack(t, td)),
  );
}

/**
 * @deprecated 请用 {@link computeTrackTrailDrawPlan}；保留供 3D 等判断是否完全关闭尾迹层。
 */
export function trackMapDrawHistoryTrails(tracks: ReadonlyArray<Track>): boolean {
  return computeTrackTrailDrawPlan(tracks).mode !== "none";
}

function trackPointFillAndStyle(t: Track, accent: AssetDispositionIconAccent | null | undefined) {
  const tr = getTrackRenderingConfig();
  const td = useTrackDisplayStore.getState();
  const disp = getTrackDispositionForRendering(t);
  const style = tr.trackTypeStyles[t.type] ?? tr.trackTypeStyles.sea;
  const layerKey = resolveTrackLayerKey(t);
  /**
   * 圆点 / AIS / 自报位等非军标：始终用显示控制面板的按层配色（与敌我无关）。
   * 否则船自报位被标红方时会落到友方 idColor，面板改色无效。
   */
  if (isNonMilSymbolTrackLayerKey(layerKey)) {
    const pointFill = resolveTrackMapHighlightFill(
      t,
      neutralColorForLayer(layerKey, td.neutralColorByLayer),
    );
    return { pointFill, disp, neutralFusion: undefined, style };
  }
  const neutralFusion =
    disp === "neutral"
      ? neutralFusionColorForTrack(t, td.neutralColorByLayer, td.airFusionNeutralColorBySubtype)
      : undefined;
  const friendlyFill = disp === "friendly" ? style.idColor : undefined;
  const baseFill = neutralFusion ?? resolveTrackPointFill(t, disp, accent ?? null, friendlyFill);
  const pointFill = resolveTrackMapHighlightFill(t, baseFill);
  return { pointFill, disp, neutralFusion, style };
}

/**
 * `Track[]` → GeoJSON：仅 **LineString**（尾迹 + 速度矢量），供 `TRACK_SOURCE`。
 */
export function buildTrackLinesGeoJSON(
  trackList: Track[],
  accent?: AssetDispositionIconAccent | null,
): GeoJSON.FeatureCollection {
  const trailPlan = computeTrackTrailDrawPlan(trackList);
  const features: GeoJSON.Feature[] = [];
  const td = useTrackDisplayStore.getState();

  for (const t of trackList) {
    const { pointFill } = trackPointFillAndStyle(t, accent);
    const trail = trailForDrawPlan(
      trailPlan,
      t.id,
      trailForTrackDisplay(t, trailLengthSecondsForTrack(t, td)),
    );

    if (trail && trail.length >= 1) {
      const coords: [number, number][] = [
        ...trail.map(([lng, lat]) => [lng, lat] as [number, number]),
        [t.lng, t.lat],
      ];
      if (coords.length >= 2) {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: {
            trackId: t.id,
            lineColor: pointFill,
            _lineKind: "trail",
          },
        });
      }
    }

    const vecEnd = velocityVectorEndLngLat(t, vectorLengthSecondsForTrack(t, td));
    if (vecEnd) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [[t.lng, t.lat], vecEnd],
        },
        properties: {
          trackId: t.id,
          lineColor: pointFill,
          _lineKind: "vector",
        },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

/**
 * 融合航迹点 → GeoJSON：**Point** + `symbolId`，供 `TRACK_FUSION_PTS_SOURCE`。
 */
export function buildTrackFusionPointsGeoJSON(
  trackList: Track[],
  accent?: AssetDispositionIconAccent | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const t of trackList) {
    const layerKey = resolveTrackLayerKey(t);
    if (isNonMilSymbolTrackLayerKey(layerKey)) continue;
    const { pointFill, disp, neutralFusion, style } = trackPointFillAndStyle(t, accent);
    const friendlyFill = disp === "friendly" ? style.idColor : undefined;
    const v = isTrackVirtualTroop(t);
    const iconScale = Math.max(0.55, Math.min(1.5, style.pointSize / 3.5));
    const airBirdGlyph = isAirTrackBirdGlyph(t);
    const isFuseAirTrack = layerKey === "fuse_air";
    const airFuseGlyph = isFuseAirTrack && airBirdGlyph;
    const seaFuseGlyph = layerKey === "fuse_sea" && t.type === "sea";
    const seaBuoyGlyph = seaFuseGlyph && isSeaTrackBuoyGlyph(t);
    const seaReefGlyph = seaFuseGlyph && isSeaTrackReefGlyph(t);
    const opticallyVerified = shouldApplyVerifiedTrackYellow(t);
    const suspiciousTarget = shouldApplySuspiciousTrackGreen(t);
    const coasting = isTrackCoasting(t);
    const labelProps = trackLabelProps(t);
    const baseProps: Record<string, unknown> = {
      id: t.id,
      showID: t.showID,
      uniqueID: t.uniqueID,
      trackId: t.trackId ?? null,
      isAirTrack: t.isAirTrack ?? false,
      targetType: t.targetType ?? null,
      name: t.name,
      mapLabelText: labelProps.mapLabelText,
      mapLabelTime: labelProps.mapLabelTime,
      type: t.type,
      disposition: disp,
      speed: t.speed,
      heading: t.heading,
      course: t.course ?? null,
      isFuseAirTrack,
      isSeaFuseTrack: seaFuseGlyph,
      isSeaBuoyGlyph: seaBuoyGlyph,
      isSeaReefGlyph: seaReefGlyph,
      isAirBirdGlyph: airBirdGlyph,
      altitude: t.altitude ?? null,
      color: pointFill,
      labelColor:
        suspiciousTarget || shouldApplyVerifiedTrackYellow(t) || disp === "neutral"
          ? pointFill
          : style.idColor,
      labelTextSize: Math.max(6, Math.min(22, style.idSize)),
      symbolId: getMarkerSymbolId(
        t.type,
        disp,
        v,
        friendlyFill,
        neutralFusion,
        airBirdGlyph,
        airFuseGlyph,
        opticallyVerified,
        seaFuseGlyph,
        seaBuoyGlyph,
        seaReefGlyph,
        suspiciousTarget,
        coasting,
      ),
      iconScale,
    };
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [t.lng, t.lat] as [number, number] },
      properties: baseProps as GeoJSON.GeoJsonProperties,
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * 雷达 / AIS / 自报位航迹点 → GeoJSON：**Point**（圆点层用 `color`，AIS 用 `aisTriangleId`），供 `TRACK_RADAR_PTS_SOURCE`。
 */
export function buildTrackRadarPointsGeoJSON(
  trackList: Track[],
  accent?: AssetDispositionIconAccent | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const t of trackList) {
    const layerKey = resolveTrackLayerKey(t);
    if (!isNonMilSymbolTrackLayerKey(layerKey)) continue;
    const { pointFill, disp, style } = trackPointFillAndStyle(t, accent);
    const labelProps = trackLabelProps(t);
    const baseProps: Record<string, unknown> = {
      id: t.id,
      showID: t.showID,
      uniqueID: t.uniqueID,
      trackId: t.trackId ?? null,
      isAirTrack: t.isAirTrack ?? false,
      targetType: t.targetType ?? null,
      name: t.name,
      mapLabelText: labelProps.mapLabelText,
      mapLabelTime: labelProps.mapLabelTime,
      type: t.type,
      disposition: disp,
      speed: t.speed,
      heading: t.heading,
      course: t.course ?? null,
      altitude: t.altitude ?? null,
      color: pointFill,
      labelColor: shouldApplyVerifiedTrackYellow(t) || disp === "neutral" ? pointFill : style.idColor,
      labelTextSize: Math.max(6, Math.min(22, style.idSize)),
      layerKey,
    };
    if (isAisTrackLayerKey(layerKey)) {
      baseProps.aisTriangleId = aisHollowTriangleImageId(pointFill);
    }
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [t.lng, t.lat] as [number, number] },
      properties: baseProps as GeoJSON.GeoJsonProperties,
    });
  }
  return { type: "FeatureCollection", features };
}

/** 威胁 Top5：仅含需显示序号的点（融合 + 雷达点源合并） */
export function buildThreatRankPointsGeoJSON(
  trackList: Track[],
  rankByShowId: ReadonlyMap<string, number>,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const t of trackList) {
    const rank = rankByShowId.get(t.showID);
    if (rank == null || rank < 1 || rank > 5) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [t.lng, t.lat] as [number, number] },
      properties: {
        id: t.id,
        showID: t.showID,
        threatRank: rank,
        threatRankBadgeId: threatRankBadgeImageId(rank),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * 对航迹与展示相关的字段做 FNV-1a（O(n)、不分配 GeoJSON），用于跳过与上一帧相同的 `GeoJSONSource#setData`。
 */
function fnv1aTrackDataFingerprint(tracks: ReadonlyArray<Track>): number {
  let h = 2166136261 >>> 0;
  for (const t of tracks) {
    for (let i = 0; i < t.id.length; i++) {
      h ^= t.id.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h = (h ^ 1) >>> 0;
    for (let i = 0; i < t.lastUpdate.length; i++) {
      h ^= t.lastUpdate.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= ((t.lat * 1e6) | 0) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= ((t.lng * 1e6) | 0) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
    const alt = t.altitude;
    h ^= alt != null && Number.isFinite(alt) ? ((alt as number) * 10) | 0 : 0x7e2a1c9f;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= t.heading | 0;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= t.speed | 0;
    h = Math.imul(h, 16777619) >>> 0;
    const eff = getTrackDispositionForRendering(t);
    const manualTag = useTrackStore.getState().manualAffiliationByShowId[t.showID] ?? "";
    for (let i = 0; i < manualTag.length; i++) {
      h ^= manualTag.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    for (let i = 0; i < eff.length; i++) {
      h ^= eff.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    const tl = t.historyTrail?.length ?? 0;
    h ^= tl;
    h = Math.imul(h, 16777619) >>> 0;
    if (tl > 0) {
      const tr = t.historyTrail!;
      const mixPt = (p: [number, number]) => {
        h ^= ((p[0] * 1e6) | 0) >>> 0;
        h = Math.imul(h, 16777619) >>> 0;
        h ^= ((p[1] * 1e6) | 0) >>> 0;
        h = Math.imul(h, 16777619) >>> 0;
      };
      /* 首 / 中 / 末采样，避免仅中间形变时指纹与上一帧相同导致错误跳过 setData */
      mixPt(tr[0]);
      if (tl > 2) mixPt(tr[tl >> 1]);
      if (tl > 1) mixPt(tr[tl - 1]);
    }
    const typ = t.type === "air" ? 1 : t.type === "sea" ? 2 : 3;
    h ^= typ;
    h = Math.imul(h, 16777619) >>> 0;
    const nlen = Math.min(t.name.length, 48);
    for (let i = 0; i < nlen; i++) {
      h ^= t.name.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= isTrackVirtualTroop(t) ? 1 : 0;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= t.isUav === true ? 1 : 0;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= isAirTrackBirdGlyph(t) ? 1 : 0;
    h = Math.imul(h, 16777619) >>> 0;
    const lk = resolveTrackLayerKey(t);
    const mapDot = isNonMilSymbolTrackLayerKey(lk);
    h ^= mapDot ? 1 : 0;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= isAisTrackLayerKey(lk) ? 1 : 0;
    h = Math.imul(h, 16777619) >>> 0;
    for (let i = 0; i < lk.length; i++) {
      h ^= lk.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    const dds = t.ddsSourceId ?? "";
    for (let i = 0; i < Math.min(dds.length, 64); i++) {
      h ^= dds.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    /** 速度矢量依赖 course/azimuth；缺此两项时指纹会与「补 course 后」相同 → 错误跳过 setData、红线永远不出现 */
    const crs = t.course;
    h ^= crs != null && Number.isFinite(crs) ? Math.round((crs as number) * 100) : 0x5a11c0de;
    h = Math.imul(h, 16777619) >>> 0;
    const azm = t.azimuth;
    h ^= azm != null && Number.isFinite(azm) ? Math.round((azm as number) * 100) : 0x71a2b33f;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= shouldApplyVerifiedTrackYellow(t) ? 1 : 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * 航迹：**三 GeoJSON 源**（折线 / 融合点 / 雷达点）+ 高亮环 / 锁定圈 / 军标 / 圆点 / 标牌。
 * 安装分两段：`installSourceAndHighlight` 须在雷达/光电等 `insertBeforeLayerId: HIGHLIGHT_LAYER` 之前调用；
 * `installSymbolLayers` 在专题层装完后再调用（锁定圈与符号叠在最上）。
 */
export class TracksMaplibre {
  private map: maplibregl.Map;
  private dispositionAccent: AssetDispositionIconAccent | null = null;
  /**
   * 对海 / 其它源各自代际：对空高频刷新不得取消对海融合的 in-flight setData
   *（原先共用一个 gen，全量发布时对海更新常被掐掉 → 闪烁）。
   */
  private fuseSeaFlushGeneration = 0;
  private otherTracksFlushGeneration = 0;
  /** 雷达点独立代际：雷达点与对海重合，须与对海同拍即时刷新（不走节流），单独 gen 防并发 setData 乱序 */
  private radarFlushGeneration = 0;
  /**
   * 与航迹几何无关的渲染参数每变一次 +1（如 `factory.assetIcons` 驱动的 `setTrackDispositionAccent`），
   * 使 `setTracks` 的缓存键失效，避免沿用上一帧 GeoJSON。
   */
  private trackRenderRevision = 0;
  /** 分源签名：其它图层更新不得连带刷对海融合点源（否则 MapLibre symbol 闪烁） */
  private lastLinesKey = "";
  private lastSeaLinesKey = "";
  private lastFusionKey = "";
  private lastFuseSeaKey = "";
  private lastRadarKey = "";
  private lastRankKey = "";
  /** 非对海地图刷新节流（ms）：对空/雷达洪峰时降低 setData 频率，避免拖垮对海 */
  private otherFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingOtherFlushTracks: Track[] | null = null;
  private static readonly OTHER_FLUSH_MIN_MS = 250;
  /** 最近一次 `setTracks` 入参，供威胁序号单独刷新 */
  private lastTracks: Track[] = [];
  /** showID → 威胁序号 1–5（1 为最高威胁度） */
  private threatRankByShowId = new Map<string, number>();
  /** 并发 `ensureTrackSymbolImages` 时合并同一 symbolId 的加载/注册，避免重复 `addImage` */
  private pendingTrackSymbolImages = new Map<string, Promise<void>>();

  constructor(map: maplibregl.Map) {
    this.map = map;
  }

  /** 与 `factory.assetIcons` 一致：航迹点颜色走 `resolveTrackMarkerFill` */
  setTrackDispositionAccent(accent: AssetDispositionIconAccent | null) {
    this.dispositionAccent = accent;
    this.trackRenderRevision++;
    this.invalidateSourceKeys();
  }

  private invalidateSourceKeys() {
    this.lastLinesKey = "";
    this.lastSeaLinesKey = "";
    this.lastFusionKey = "";
    this.lastFuseSeaKey = "";
    this.lastRadarKey = "";
    this.lastRankKey = "";
  }

  /** 应用 `app-config.json` 中 `trackRendering.trackDisplay`（名称 / 接收时间标签） */
  applyTrackRenderingLayout() {
    const m = this.map;
    const tr = getTrackRenderingConfig();
    const vis =
      tr.trackDisplay.showTrackId || tr.trackDisplay.showTrackRecvTime ? "visible" : "none";
    for (const lid of [TRACK_LABEL, TRACK_LABEL_FUSE_SEA, TRACK_LABEL_RADAR]) {
      if (m.getLayer(lid)) {
        m.setLayoutProperty(lid, "visibility", vis);
        m.setLayoutProperty(lid, "text-size", ["coalesce", ["get", "labelTextSize"], 10]);
        m.setLayoutProperty(lid, "text-field", TRACK_LABEL_TEXT_FIELD);
        m.setPaintProperty(lid, "text-color", ["coalesce", ["get", "labelColor"], "#a1a1aa"]);
      }
    }
    /* 三源构建会读 `trackTypeStyles` 等，配置热变时需重算 */
    this.invalidateSourceKeys();
  }

  /** 折线源 + 融合/对海/雷达点源 + 高亮层；供后续专题层插在 `HIGHLIGHT_LAYER` 下 */
  installSourceAndHighlight(initialTracks: Track[]) {
    const m = this.map;
    if (m.getSource(TRACK_SOURCE)) {
      if (!m.getSource(TRACK_SOURCE_FUSE_SEA)) {
        m.addSource(TRACK_SOURCE_FUSE_SEA, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!m.getSource(TRACK_FUSE_SEA_PTS_SOURCE)) {
        m.addSource(TRACK_FUSE_SEA_PTS_SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!m.getSource(TRACK_THREAT_RANK_SOURCE)) {
        m.addSource(TRACK_THREAT_RANK_SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      return;
    }
    const accent = this.dispositionAccent;
    const { fuseSea, otherFusion } = partitionMilSymbolTracks(initialTracks);
    const otherForLines = initialTracks.filter((t) => resolveTrackLayerKey(t) !== "fuse_sea");
    m.addSource(TRACK_SOURCE, {
      type: "geojson",
      data: buildTrackLinesGeoJSON(otherForLines, accent),
    });
    m.addSource(TRACK_SOURCE_FUSE_SEA, {
      type: "geojson",
      data: buildTrackLinesGeoJSON(fuseSea, accent),
    });
    m.addSource(TRACK_FUSION_PTS_SOURCE, {
      type: "geojson",
      data: buildTrackFusionPointsGeoJSON(otherFusion, accent),
    });
    m.addSource(TRACK_FUSE_SEA_PTS_SOURCE, {
      type: "geojson",
      data: buildTrackFusionPointsGeoJSON(fuseSea, accent),
    });
    m.addSource(TRACK_RADAR_PTS_SOURCE, {
      type: "geojson",
      data: buildTrackRadarPointsGeoJSON(initialTracks, accent),
    });
    m.addSource(TRACK_THREAT_RANK_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    const highlightLayout = {
      "icon-image": TRACK_SELECT_RING_ID,
      "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.58, 10, 0.86, 15, 1.12],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-rotation-alignment": "viewport",
      "icon-pitch-alignment": "viewport",
    } as maplibregl.SymbolLayerSpecification["layout"];
    if (!m.getLayer(HIGHLIGHT_LAYER)) {
      m.addLayer({
        id: HIGHLIGHT_LAYER,
        type: "symbol",
        source: TRACK_FUSION_PTS_SOURCE,
        filter: filterPointsOnly(["in", "id", ""]),
        layout: highlightLayout,
        paint: { "icon-opacity": 0.88 },
      });
    }
    if (!m.getLayer(HIGHLIGHT_FUSE_SEA_LAYER)) {
      m.addLayer({
        id: HIGHLIGHT_FUSE_SEA_LAYER,
        type: "symbol",
        source: TRACK_FUSE_SEA_PTS_SOURCE,
        filter: filterPointsOnly(["in", "id", ""]),
        layout: highlightLayout,
        paint: { "icon-opacity": 0.88 },
      });
    }
    if (!m.getLayer(HIGHLIGHT_RADAR_LAYER)) {
      m.addLayer(
        {
          id: HIGHLIGHT_RADAR_LAYER,
          type: "symbol",
          source: TRACK_RADAR_PTS_SOURCE,
          filter: filterPointsOnly(["in", "id", ""]),
          layout: highlightLayout,
          paint: { "icon-opacity": 0.88 },
        },
        HIGHLIGHT_LAYER,
      );
    }
  }

  /** 锁定圈 + 航迹线 + 航迹符号 + 名称；须在雷达/光电安装之后调用 */
  installSymbolLayers() {
    const m = this.map;
    if (
      !m.getSource(TRACK_SOURCE) ||
      !m.getSource(TRACK_SOURCE_FUSE_SEA) ||
      !m.getSource(TRACK_FUSION_PTS_SOURCE) ||
      !m.getSource(TRACK_FUSE_SEA_PTS_SOURCE) ||
      !m.getSource(TRACK_RADAR_PTS_SOURCE)
    ) {
      return;
    }

    const lockFilter = filterPointsOnly(["in", "id", ""]);
    const lockLayout = {
      "icon-image": LOCK_ON_IMAGE_ID,
      "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 0.72, 15, 1.05],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-rotation-alignment": "viewport",
      "icon-pitch-alignment": "viewport",
    } as maplibregl.SymbolLayerSpecification["layout"];

    if (!m.getLayer(LOCK_ON)) {
      m.addLayer({
        id: LOCK_ON,
        type: "symbol",
        source: TRACK_FUSION_PTS_SOURCE,
        filter: lockFilter,
        layout: lockLayout,
        paint: { "icon-opacity": 0.9 },
      });
    }
    if (!m.getLayer(LOCK_ON_FUSE_SEA)) {
      m.addLayer({
        id: LOCK_ON_FUSE_SEA,
        type: "symbol",
        source: TRACK_FUSE_SEA_PTS_SOURCE,
        filter: lockFilter,
        layout: lockLayout,
        paint: { "icon-opacity": 0.9 },
      });
    }
    if (!m.getLayer(LOCK_ON_RADAR)) {
      m.addLayer(
        {
          id: LOCK_ON_RADAR,
          type: "symbol",
          source: TRACK_RADAR_PTS_SOURCE,
          filter: lockFilter,
          layout: lockLayout,
          paint: { "icon-opacity": 0.9 },
        },
        LOCK_ON,
      );
    }
    if (!m.getLayer(TRACK_SYMBOL)) {
      m.addLayer({
        id: TRACK_SYMBOL,
        type: "symbol",
        source: TRACK_FUSION_PTS_SOURCE,
        filter: filterPointsOnly(null),
        layout: TRACK_SYMBOL_LAYOUT,
      });
    }
    if (!m.getLayer(TRACK_SYMBOL_FUSE_SEA)) {
      m.addLayer({
        id: TRACK_SYMBOL_FUSE_SEA,
        type: "symbol",
        source: TRACK_FUSE_SEA_PTS_SOURCE,
        filter: filterPointsOnly(null),
        layout: TRACK_SYMBOL_LAYOUT,
      });
    }
    if (!m.getLayer(TRACK_TRAIL)) {
      m.addLayer(
        {
          id: TRACK_TRAIL,
          type: "line",
          source: TRACK_SOURCE,
          filter: LINE_TRAIL_FILTER,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["coalesce", ["get", "lineColor"], "#71717a"],
            "line-width": 4,
            "line-dasharray": [0, 1.8],
            "line-opacity": 0.65,
          },
        },
        TRACK_SYMBOL,
      );
    }
    if (!m.getLayer(TRACK_TRAIL_FUSE_SEA)) {
      m.addLayer(
        {
          id: TRACK_TRAIL_FUSE_SEA,
          type: "line",
          source: TRACK_SOURCE_FUSE_SEA,
          filter: LINE_TRAIL_FILTER,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["coalesce", ["get", "lineColor"], "#71717a"],
            "line-width": 4,
            "line-dasharray": [0, 1.8],
            "line-opacity": 0.65,
          },
        },
        TRACK_SYMBOL_FUSE_SEA,
      );
    }
    if (!m.getLayer(TRACK_VECTOR)) {
      m.addLayer(
        {
          id: TRACK_VECTOR,
          type: "line",
          source: TRACK_SOURCE,
          filter: LINE_VECTOR_FILTER,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": ["coalesce", ["get", "lineColor"], "#71717a"],
            "line-width": 1.5,
            "line-opacity": 0.9,
          },
        },
        TRACK_SYMBOL,
      );
    }
    if (!m.getLayer(TRACK_VECTOR_FUSE_SEA)) {
      m.addLayer(
        {
          id: TRACK_VECTOR_FUSE_SEA,
          type: "line",
          source: TRACK_SOURCE_FUSE_SEA,
          filter: LINE_VECTOR_FILTER,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": ["coalesce", ["get", "lineColor"], "#71717a"],
            "line-width": 1.5,
            "line-opacity": 0.9,
          },
        },
        TRACK_SYMBOL_FUSE_SEA,
      );
    }
    if (!m.getLayer(TRACK_DOT)) {
      m.addLayer(
        {
          id: TRACK_DOT,
          type: "circle",
          source: TRACK_RADAR_PTS_SOURCE,
          filter: filterPointsOnly(["!=", "layerKey", "ais_track"]),
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 3.2, 10, 5, 15, 6.5],
            "circle-color": ["coalesce", ["get", "color"], "#71717a"],
            "circle-opacity": 0.92,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#09090b",
            "circle-stroke-opacity": 0.55,
          },
        },
        TRACK_SYMBOL,
      );
    } else {
      m.setFilter(TRACK_DOT, filterPointsOnly(["!=", "layerKey", "ais_track"]));
    }
    if (!m.getLayer(TRACK_AIS)) {
      m.addLayer(
        {
          id: TRACK_AIS,
          type: "symbol",
          source: TRACK_RADAR_PTS_SOURCE,
          filter: filterPointsOnly(["==", "layerKey", "ais_track"]),
          layout: {
            "icon-image": ["get", "aisTriangleId"],
            "icon-rotate": ["coalesce", ["get", "course"], ["get", "heading"], 0],
            "icon-rotation-alignment": "map",
            "icon-pitch-alignment": "map",
            "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.28, 10, 0.38, 15, 0.48],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: { "icon-opacity": 0.95 },
        },
        TRACK_SYMBOL,
      );
    } else {
      m.setLayoutProperty(
        TRACK_AIS,
        "icon-size",
        ["interpolate", ["linear"], ["zoom"], 5, 0.28, 10, 0.38, 15, 0.48],
      );
    }
    if (!m.getLayer(TRACK_LABEL)) {
      m.addLayer({
        id: TRACK_LABEL,
        type: "symbol",
        source: TRACK_FUSION_PTS_SOURCE,
        filter: filterPointsOnly(null),
        layout: TRACK_LABEL_LAYOUT,
        paint: {
          "text-color": "#a1a1aa",
          "text-halo-color": "#09090b",
          "text-halo-width": 1.5,
        },
      });
    }
    if (!m.getLayer(TRACK_LABEL_FUSE_SEA)) {
      m.addLayer({
        id: TRACK_LABEL_FUSE_SEA,
        type: "symbol",
        source: TRACK_FUSE_SEA_PTS_SOURCE,
        filter: filterPointsOnly(null),
        layout: TRACK_LABEL_LAYOUT,
        paint: {
          "text-color": "#a1a1aa",
          "text-halo-color": "#09090b",
          "text-halo-width": 1.5,
        },
      });
    }
    if (!m.getLayer(TRACK_LABEL_RADAR)) {
      m.addLayer({
        id: TRACK_LABEL_RADAR,
        type: "symbol",
        source: TRACK_RADAR_PTS_SOURCE,
        filter: filterPointsOnly(null),
        layout: TRACK_LABEL_LAYOUT,
        paint: {
          "text-color": "#a1a1aa",
          "text-halo-color": "#09090b",
          "text-halo-width": 1.5,
        },
      });
    }
    if (!m.getLayer(TRACK_THREAT_RANK)) {
      m.addLayer(
        {
          id: TRACK_THREAT_RANK,
          type: "symbol",
          source: TRACK_THREAT_RANK_SOURCE,
          layout: {
            "icon-image": ["get", "threatRankBadgeId"],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.85, 12, 1, 16, 1.15],
            "icon-anchor": "bottom",
            "icon-offset": [0, -10],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: { "icon-opacity": 1 },
        },
        TRACK_LABEL,
      );
    }
  }

  /** 更新告警航迹威胁 Top5 序号（1=最高威胁度）；只刷序号源，绝不连带融合/雷达点源 */
  setThreatRankByShowId(rankByShowId: Map<string, number>) {
    this.threatRankByShowId = rankByShowId;
    const srcRank = this.map.getSource(TRACK_THREAT_RANK_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!srcRank) return;
    const vis = useAppStore.getState().layerVisibility;
    const sub = useTrackDisplayStore.getState().trackSubtypeVisible;
    const airSub = useTrackDisplayStore.getState().airFusionSubtypeVisible;
    const filtered = filterTracksForMapRender(this.lastTracks, vis, sub, airSub);
    const rankKey = this.threatRankCacheKey(filtered, rankByShowId);
    if (rankKey === this.lastRankKey) return;
    this.lastRankKey = rankKey;
    srcRank.setData(
      buildThreatRankPointsGeoJSON(filtered, rankByShowId) as GeoJSON.FeatureCollection,
    );
  }

  private threatRankCacheKey(
    filtered: ReadonlyArray<Track>,
    rankByShowId: ReadonlyMap<string, number>,
  ): string {
    const rankSig = [...rankByShowId.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join("|");
    if (!rankSig) return "empty";
    let pos = 2166136261 >>> 0;
    for (const [id, rank] of rankByShowId) {
      if (rank < 1 || rank > 5) continue;
      const t = filtered.find((x) => x.showID === id);
      if (!t) continue;
      pos ^= ((t.lng * 1e6) | 0) >>> 0;
      pos = Math.imul(pos, 16777619) >>> 0;
      pos ^= ((t.lat * 1e6) | 0) >>> 0;
      pos = Math.imul(pos, 16777619) >>> 0;
    }
    return `${rankSig}:${pos >>> 0}`;
  }

  setTracks(tracks: Track[]) {
    this.lastTracks = tracks;
    void this.setTracksAsync(tracks);
  }

  /** 自定义融合色会生成新的 `symbolId`，须先 `addImage` 再 `setData`，否则图标空白 */
  private async setTracksAsync(tracks: Track[]) {
    const srcSeaLines = this.map.getSource(TRACK_SOURCE_FUSE_SEA) as maplibregl.GeoJSONSource | undefined;
    const srcSea = this.map.getSource(TRACK_FUSE_SEA_PTS_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!srcSea || !srcSeaLines) return;

    const vis = useAppStore.getState().layerVisibility;
    const sub = useTrackDisplayStore.getState().trackSubtypeVisible;
    const airSub = useTrackDisplayStore.getState().airFusionSubtypeVisible;
    const visSig = trackMapVisibilitySignature(vis, sub, airSub);
    const trd = getTrackRenderingConfig().trackDisplay;
    const maxVp = trd.maxViewportPoints;
    const maxHist = trd.maxHistoryPointsPerTrack;
    const td = useTrackDisplayStore.getState();
    const tdRev = td.displayRevision;
    const trailSecSig = TRACK_LAYER_KEYS_ORDERED.map(
      (k) => td.trailLengthSecondsByLayer[k] ?? 600,
    ).join(",");
    const affRev = useTrackStore.getState().mapManualAffiliationRev;
    const verRev = useVerifiedTrackStore.getState().mapVerifiedRev;

    /**
     * 热路径（对海 10Hz 驱动）**只处理对海**：仅取可见 `fuse_sea` 子集算指纹/`setData`。
     * 其它航迹（对空/雷达/AIS…）一律交给已节流（≤4Hz）的 `flushOtherTrackSources` 自判指纹，
     * 避免打开高密度图层（如远遥码头雷达数百条）后，其指纹计算被对海 10Hz 反复驱动、占满主线程 → 连累对海抖。
     */
    const masterOn = vis[LYR_TRACKS] !== false;
    const seaVisible = masterOn && sub.fuse_sea !== false;
    const fuseSea: Track[] = [];
    if (seaVisible) {
      for (const t of tracks) {
        if (resolveTrackLayerKey(t) === "fuse_sea") fuseSea.push(t);
      }
    }
    const drawTrailsSea = trailDrawPlanCacheSig(computeTrackTrailDrawPlan(fuseSea));
    const fpSea = fnv1aTrackDataFingerprint(fuseSea);
    const common = `${this.trackRenderRevision}:${maxVp}:${maxHist}:${tdRev}:${trailSecSig}:${affRev}:${verRev}:${visSig}`;
    const seaLinesKey = `${common}:${drawTrailsSea}:${fuseSea.length}:${fpSea}`;
    const fuseSeaKey = `${common}:${fuseSea.length}:${fpSea}`;

    const needSeaLines = seaLinesKey !== this.lastSeaLinesKey;
    const needFuseSea = fuseSeaKey !== this.lastFuseSeaKey;
    const accent = this.dispositionAccent;

    /** 对海：点 + 折线立即刷新，独立代际 */
    if (needFuseSea || needSeaLines) {
      const seaGen = ++this.fuseSeaFlushGeneration;
      if (needFuseSea) {
        try {
          await this.ensureTrackSymbolImages(fuseSea);
        } catch (e) {
          console.warn("[tracks-maplibre] ensureTrackSymbolImages(fuse_sea):", e);
        }
      }
      if (seaGen === this.fuseSeaFlushGeneration) {
        markTrackPhase("map.seaFlush", `sea=${fuseSea.length},pts=${needFuseSea},lines=${needSeaLines}`);
        if (needFuseSea) {
          this.lastFuseSeaKey = fuseSeaKey;
          srcSea.setData(buildTrackFusionPointsGeoJSON(fuseSea, accent) as GeoJSON.FeatureCollection);
        }
        if (needSeaLines) {
          this.lastSeaLinesKey = seaLinesKey;
          srcSeaLines.setData(buildTrackLinesGeoJSON(fuseSea, accent) as GeoJSON.FeatureCollection);
        }
      }
    }

    /**
     * 雷达/点状航迹（圆点、AIS）：与对海融合**点位重合**，必须与对海**同拍即时刷新**。
     * 若走节流的 other-flush（最多滞后 250ms、且节奏更慢），重合处圆点会滞后对海军标一拍、
     * 来回追赶 → 肉眼「闪/抖」（回归根因）。仅在有点状图层可见时进入，默认全关则零成本。
     */
    const srcRad = this.map.getSource(TRACK_RADAR_PTS_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (srcRad && masterOn) {
      const radarTracks: Track[] = [];
      for (const t of tracks) {
        const lk = resolveTrackLayerKey(t);
        if (!isNonMilSymbolTrackLayerKey(lk)) continue;
        if (sub[lk] === false) continue;
        radarTracks.push(t);
      }
      const radarKey = `${common}:${radarTracks.length}:${fnv1aTrackDataFingerprint(radarTracks)}`;
      if (radarKey !== this.lastRadarKey) {
        const radGen = ++this.radarFlushGeneration;
        try {
          await this.ensureTrackSymbolImages(radarTracks);
        } catch (e) {
          console.warn("[tracks-maplibre] ensureTrackSymbolImages(radar):", e);
        }
        if (radGen === this.radarFlushGeneration) {
          this.lastRadarKey = radarKey;
          markTrackPhase("map.radarFlush", `radar=${radarTracks.length}`);
          srcRad.setData(buildTrackRadarPointsGeoJSON(radarTracks, accent) as GeoJSON.FeatureCollection);
        }
      }
    }

    /** 其它航迹（对空/其它折线/威胁序号）：始终交节流合并，指纹在其内部计算 */
    this.pendingOtherFlushTracks = tracks;
    if (this.otherFlushTimer != null) return;
    this.otherFlushTimer = setTimeout(() => {
      this.otherFlushTimer = null;
      const pending = this.pendingOtherFlushTracks;
      this.pendingOtherFlushTracks = null;
      if (pending) void this.flushOtherTrackSources(pending);
    }, TracksMaplibre.OTHER_FLUSH_MIN_MS);
  }

  private async flushOtherTrackSources(tracks: Track[]) {
    const srcLines = this.map.getSource(TRACK_SOURCE) as maplibregl.GeoJSONSource | undefined;
    const srcFus = this.map.getSource(TRACK_FUSION_PTS_SOURCE) as maplibregl.GeoJSONSource | undefined;
    const srcRank = this.map.getSource(TRACK_THREAT_RANK_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!srcLines || !srcFus || !srcRank) return;

    const vis = useAppStore.getState().layerVisibility;
    const sub = useTrackDisplayStore.getState().trackSubtypeVisible;
    const airSub = useTrackDisplayStore.getState().airFusionSubtypeVisible;
    const filtered = filterTracksForMapRender(tracks, vis, sub, airSub);
    const visSig = trackMapVisibilitySignature(vis, sub, airSub);
    const trd = getTrackRenderingConfig().trackDisplay;
    const maxVp = trd.maxViewportPoints;
    const maxHist = trd.maxHistoryPointsPerTrack;
    const td = useTrackDisplayStore.getState();
    const tdRev = td.displayRevision;
    const trailSecSig = TRACK_LAYER_KEYS_ORDERED.map(
      (k) => td.trailLengthSecondsByLayer[k] ?? 600,
    ).join(",");
    const affRev = useTrackStore.getState().mapManualAffiliationRev;
    const verRev = useVerifiedTrackStore.getState().mapVerifiedRev;
    const { otherFusion } = partitionMilSymbolTracks(filtered);
    /** 雷达/点状源不在此处理：已移至 setTracksAsync 与对海同拍即时刷新（重合点防抖），此处仅折线/对空/序号 */
    const otherLineTracks: Track[] = [];
    for (const t of filtered) {
      const lk = resolveTrackLayerKey(t);
      if (lk === "fuse_sea") continue;
      otherLineTracks.push(t);
    }
    const drawTrailsOther = trailDrawPlanCacheSig(computeTrackTrailDrawPlan(otherLineTracks));
    const fpFus = fnv1aTrackDataFingerprint(otherFusion);
    const fpOtherLines = fnv1aTrackDataFingerprint(otherLineTracks);
    const common = `${this.trackRenderRevision}:${maxVp}:${maxHist}:${tdRev}:${trailSecSig}:${affRev}:${verRev}:${visSig}`;
    const linesKey = `${common}:${drawTrailsOther}:${otherLineTracks.length}:${fpOtherLines}`;
    const fusionKey = `${common}:${otherFusion.length}:${fpFus}`;
    const rankKey = this.threatRankCacheKey(filtered, this.threatRankByShowId);

    const needLines = linesKey !== this.lastLinesKey;
    const needFusion = fusionKey !== this.lastFusionKey;
    const needRank = rankKey !== this.lastRankKey;
    if (!needLines && !needFusion && !needRank) return;

    const otherGen = ++this.otherTracksFlushGeneration;
    if (needFusion) {
      try {
        await this.ensureTrackSymbolImages(otherFusion);
      } catch (e) {
        console.warn("[tracks-maplibre] ensureTrackSymbolImages:", e);
      }
      if (otherGen !== this.otherTracksFlushGeneration) return;
    } else if (otherGen !== this.otherTracksFlushGeneration) {
      return;
    }

    const accent = this.dispositionAccent;
    markTrackPhase(
      "map.flushOther",
      `filtered=${filtered.length},lines=${otherLineTracks.length},fusion=${otherFusion.length},need[L=${needLines},F=${needFusion},rank=${needRank}]`,
    );
    if (needLines) {
      this.lastLinesKey = linesKey;
      srcLines.setData(buildTrackLinesGeoJSON(otherLineTracks, accent) as GeoJSON.FeatureCollection);
    }
    if (needFusion) {
      this.lastFusionKey = fusionKey;
      srcFus.setData(buildTrackFusionPointsGeoJSON(otherFusion, accent) as GeoJSON.FeatureCollection);
    }
    if (needRank) {
      this.lastRankKey = rankKey;
      srcRank.setData(
        buildThreatRankPointsGeoJSON(filtered, this.threatRankByShowId) as GeoJSON.FeatureCollection,
      );
    }
  }

  /** 同一 symbolId 仅注册一次；并发 `setTracksAsync` 共享 in-flight Promise */
  private registerTrackSymbolImage(id: string, load: () => Promise<HTMLImageElement>): Promise<void> {
    const m = this.map;
    if (m.hasImage(id)) return Promise.resolve();
    const inflight = this.pendingTrackSymbolImages.get(id);
    if (inflight) return inflight;

    const task = (async () => {
      if (m.hasImage(id)) return;
      const img = await load();
      if (m.hasImage(id)) return;
      try {
        m.addImage(id, img, { pixelRatio: 2 });
      } catch (e) {
        if (!m.hasImage(id)) throw e;
      }
    })();
    const wrapped = task.finally(() => {
      if (this.pendingTrackSymbolImages.get(id) === wrapped) {
        this.pendingTrackSymbolImages.delete(id);
      }
    });
    this.pendingTrackSymbolImages.set(id, wrapped);
    return wrapped;
  }

  /** 按需注册军标：中立融合自定义色 + 光电查证完成（`-ov` 绿色军标）；以及 AIS 空心三角 */
  private async ensureTrackSymbolImages(tracks: Track[]) {
    const td = useTrackDisplayStore.getState();
    const accent = this.dispositionAccent;
    const tr = getTrackRenderingConfig();
    const seen = new Set<string>();
    const pending: Promise<void>[] = [];
    for (const t of tracks) {
      const layerKey = resolveTrackLayerKey(t);
      if (isAisTrackLayerKey(layerKey)) {
        const { pointFill } = trackPointFillAndStyle(t, accent);
        const id = aisHollowTriangleImageId(pointFill);
        if (seen.has(id)) continue;
        seen.add(id);
        pending.push(
          this.registerTrackSymbolImage(id, () => loadSvgImage(buildAisHollowTriangleDataUrl(pointFill), 64)),
        );
        continue;
      }
      if (isDotTrackLayerKey(layerKey)) continue;
      const disp = getTrackDispositionForRendering(t);
      const style = tr.trackTypeStyles[t.type] ?? tr.trackTypeStyles.sea;
      const friendlyFill = disp === "friendly" ? style.idColor : undefined;
      const neutralFusion =
        disp === "neutral"
          ? neutralFusionColorForTrack(t, td.neutralColorByLayer, td.airFusionNeutralColorBySubtype)
          : undefined;
      const airBirdGlyph = isAirTrackBirdGlyph(t);
      const airFuseGlyph = layerKey === "fuse_air" && airBirdGlyph;
      const seaFuseGlyph = layerKey === "fuse_sea" && t.type === "sea";
      const seaBuoyGlyph = seaFuseGlyph && isSeaTrackBuoyGlyph(t);
      const seaReefGlyph = seaFuseGlyph && isSeaTrackReefGlyph(t);
      const opticallyVerified = shouldApplyVerifiedTrackYellow(t);
      const suspiciousTarget = shouldApplySuspiciousTrackGreen(t);
      const coasting = isTrackCoasting(t);
      const needsCustomNeutral = disp === "neutral" && !opticallyVerified && !suspiciousTarget;
      const needsVerifiedIcon = opticallyVerified;
      const needsSuspiciousIcon = suspiciousTarget;
      const needsCoastingIcon = coasting;
      if (!needsCustomNeutral && !needsVerifiedIcon && !needsSuspiciousIcon && !needsCoastingIcon) continue;

      const id = getMarkerSymbolId(
        t.type,
        disp,
        isTrackVirtualTroop(t),
        friendlyFill,
        neutralFusion,
        airBirdGlyph,
        airFuseGlyph,
        opticallyVerified,
        seaFuseGlyph,
        seaBuoyGlyph,
        seaReefGlyph,
        suspiciousTarget,
        coasting,
      );
      if (seen.has(id)) continue;
      seen.add(id);

      const virtual = isTrackVirtualTroop(t);
      pending.push(
        this.registerTrackSymbolImage(id, () =>
          loadSvgImage(
            buildMarkerSymbolDataUrl(
              t.type,
              disp,
              accent,
              virtual,
              friendlyFill,
              neutralFusion,
              airBirdGlyph,
              airFuseGlyph,
              opticallyVerified,
              seaFuseGlyph,
              seaBuoyGlyph,
              seaReefGlyph,
              suspiciousTarget,
              coasting,
            ),
            64,
          ),
        ),
      );
    }
    await Promise.all(pending);
  }

  setHighlightFilter(ids: string[]) {
    const f = filterPointsOnly(
      ids.length ? (["in", "id", ...ids] as FilterSpecification) : (["in", "id", ""] as FilterSpecification),
    );
    if (this.map.getLayer(HIGHLIGHT_LAYER)) this.map.setFilter(HIGHLIGHT_LAYER, f);
    if (this.map.getLayer(HIGHLIGHT_FUSE_SEA_LAYER)) this.map.setFilter(HIGHLIGHT_FUSE_SEA_LAYER, f);
    if (this.map.getLayer(HIGHLIGHT_RADAR_LAYER)) this.map.setFilter(HIGHLIGHT_RADAR_LAYER, f);
  }

  setLockOnFilter(selectedId: string | null) {
    const f = filterPointsOnly(
      selectedId ? (["==", "id", selectedId] as FilterSpecification) : (["in", "id", ""] as FilterSpecification),
    );
    if (this.map.getLayer(LOCK_ON)) this.map.setFilter(LOCK_ON, f);
    if (this.map.getLayer(LOCK_ON_FUSE_SEA)) this.map.setFilter(LOCK_ON_FUSE_SEA, f);
    if (this.map.getLayer(LOCK_ON_RADAR)) this.map.setFilter(LOCK_ON_RADAR, f);
  }

  dispose() {
    if (this.otherFlushTimer != null) {
      clearTimeout(this.otherFlushTimer);
      this.otherFlushTimer = null;
    }
    this.pendingOtherFlushTracks = null;
    this.pendingTrackSymbolImages.clear();
    const m = this.map;
    for (const id of [
      TRACK_THREAT_RANK,
      TRACK_LABEL_RADAR,
      TRACK_LABEL_FUSE_SEA,
      TRACK_LABEL,
      TRACK_VECTOR_FUSE_SEA,
      TRACK_VECTOR,
      TRACK_TRAIL_FUSE_SEA,
      TRACK_TRAIL,
      TRACK_AIS,
      TRACK_DOT,
      TRACK_SYMBOL_FUSE_SEA,
      TRACK_SYMBOL,
      LOCK_ON_RADAR,
      LOCK_ON_FUSE_SEA,
      LOCK_ON,
      HIGHLIGHT_RADAR_LAYER,
      HIGHLIGHT_FUSE_SEA_LAYER,
      HIGHLIGHT_LAYER,
    ]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    for (const sid of [
      TRACK_THREAT_RANK_SOURCE,
      TRACK_RADAR_PTS_SOURCE,
      TRACK_FUSE_SEA_PTS_SOURCE,
      TRACK_FUSION_PTS_SOURCE,
      TRACK_SOURCE_FUSE_SEA,
      TRACK_SOURCE,
    ]) {
      if (m.getSource(sid)) m.removeSource(sid);
    }
  }
}
