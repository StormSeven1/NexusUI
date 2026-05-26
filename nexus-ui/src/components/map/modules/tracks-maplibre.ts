import type maplibregl from "maplibre-gl";
import type { FilterSpecification } from "maplibre-gl";
import type { Track } from "@/lib/map-entity-model";
import {
  getMarkerSymbolId,
  TRACK_SELECT_RING_ID,
  LOCK_ON_IMAGE_ID,
  resolveTrackPointFill,
  buildMarkerSymbolDataUrl,
  isAirTrackBirdGlyph,
  type AssetDispositionIconAccent,
} from "@/lib/map-icons";
import { resolveVerifiedTrackPointFill, shouldApplyVerifiedTrackGreen } from "@/lib/verified-track-color";
import { loadSvgImage } from "@/lib/map-image-loader";
import { threatRankBadgeImageId } from "@/lib/map-icons";
import { getTrackRenderingConfig, getTrackIdModeConfig } from "@/lib/map-app-config";
import { getTrackDispositionForRendering, useTrackStore } from "@/stores/track-store";
import { useVerifiedTrackStore } from "@/stores/verified-track-store";
import {
  useTrackDisplayStore,
  neutralFusionColorForTrack,
  trailLengthSecondsForTrack,
  vectorLengthSecondsForTrack,
} from "@/stores/track-display-store";
import { trimHistoryTrailForDisplay, velocityVectorEndLngLat } from "@/lib/track-display-trail";
import { useAppStore } from "@/stores/app-store";
import {
  filterTracksForMapRender,
  isDotTrackLayerKey,
  resolveTrackLayerKey,
  trackMapVisibilitySignature,
} from "@/lib/track-layer-visibility";

/** GeoJSON source id：仅 **LineString**（尾迹 + 速度矢量）；点符号另用融合/雷达两源，避免单源 + filter 在部分环境下军标整层失效 */
export const TRACK_SOURCE = "tracks-source";

/** 融合航迹（对海/对空）点要素：军标 symbol，与高亮环同源 */
export const TRACK_FUSION_PTS_SOURCE = "tracks-fusion-pts";

/** 雷达 + AIS 航迹点要素：圆点 circle，与高亮环同源 */
export const TRACK_RADAR_PTS_SOURCE = "tracks-radar-pts";

/** 多选高亮环：`insertBeforeLayerId` 指向本层时，雷达/光电等专题层会插在其下（由下至上绘制，高亮环盖在专题层之上） */
export const HIGHLIGHT_LAYER = "tracks-highlight";

/** 雷达航迹多选高亮（与 `HIGHLIGHT_LAYER` 同源 filter，数据源为雷达点） */
export const HIGHLIGHT_RADAR_LAYER = "tracks-highlight-radar";

export const TRACK_TRAIL = "tracks-trail";
/** 速度矢量（course×速度×秒） */
export const TRACK_VECTOR = "tracks-vector";
export const TRACK_SYMBOL = "tracks-symbol";
/** 探鸟/码头/靖子头雷达：圆点（数据源 `TRACK_RADAR_PTS_SOURCE`，无 glyph/dot filter） */
export const TRACK_DOT = "tracks-dot";
export const TRACK_LABEL = "tracks-label";
export const TRACK_LABEL_RADAR = "tracks-label-radar";
/** 告警航迹威胁 Top5 序号（红底 1–5，叠在航迹符号上方） */
export const TRACK_THREAT_RANK = "tracks-threat-rank";
export const TRACK_THREAT_RANK_SOURCE = "tracks-threat-rank-source";
/** 锁定圈：`setLockOnFilter` 更新 filter */
export const LOCK_ON = "tracks-lock-on";
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
  TRACK_VECTOR,
  TRACK_DOT,
  TRACK_SYMBOL,
  TRACK_LABEL,
  TRACK_LABEL_RADAR,
  TRACK_THREAT_RANK,
  HIGHLIGHT_LAYER,
  HIGHLIGHT_RADAR_LAYER,
  LOCK_ON,
  LOCK_ON_RADAR,
] as const;

/** 点选：军标层 + 雷达圆点层 */
export const TRACK_PICK_LAYERS = [TRACK_SYMBOL, TRACK_DOT] as const;

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

/**
 * 与 `trackRendering.trackDisplay.maxViewportPoints` 对齐的顶点估算：每条航迹计 `1 + len(historyTrail)`（当前点 + 历史折线顶点数）。
 * **不修改** `Track`；仅用于判断是否绘制历史折线。
 */
export function trackMapVertexEstimate(tracks: ReadonlyArray<Track>): number {
  const td = useTrackDisplayStore.getState();
  return tracks.reduce((n, t) => {
    const trailSec = trailLengthSecondsForTrack(t, td);
    const tr = trimHistoryTrailForDisplay(t.historyTrail, trailSec);
    return n + 1 + (tr?.length ?? 0);
  }, 0);
}

/**
 * 未超 `maxViewportPoints` 预算 → 画每条航迹的 `historyTrail` 折线。
 * 超预算 → **整批不画折线**（不渲染历史轨迹）；每条航迹**只画当前位置**一个 Point（符号/标牌），**不**单独画历史采样点（本模块也无历史点 Point 要素）。store 里 `historyTrail` 原样保留。
 */
export function trackMapDrawHistoryTrails(tracks: ReadonlyArray<Track>): boolean {
  const max = getTrackRenderingConfig().trackDisplay.maxViewportPoints;
  if (!Number.isFinite(max)) return true;
  /** ≤0：显式关闭历史折线（仅保留当前点符号）；无效数字则不作顶点限制 */
  if (max <= 0) return false;
  return trackMapVertexEstimate(tracks) <= max;
}

function trackPointFillAndStyle(t: Track, accent: AssetDispositionIconAccent | null | undefined) {
  const tr = getTrackRenderingConfig();
  const td = useTrackDisplayStore.getState();
  const seaCol = td.seaFusionColor;
  const airCol = td.airFusionColor;
  const disp = getTrackDispositionForRendering(t);
  const neutralFusion = disp === "neutral" ? neutralFusionColorForTrack(t, seaCol, airCol) : undefined;
  const style = tr.trackTypeStyles[t.type] ?? tr.trackTypeStyles.sea;
  const friendlyFill = disp === "friendly" ? style.idColor : undefined;
  const baseFill = neutralFusion ?? resolveTrackPointFill(t, disp, accent ?? null, friendlyFill);
  const pointFill = resolveVerifiedTrackPointFill(t, baseFill);
  return { pointFill, disp, neutralFusion, style };
}

/**
 * `Track[]` → GeoJSON：仅 **LineString**（尾迹 + 速度矢量），供 `TRACK_SOURCE`。
 */
export function buildTrackLinesGeoJSON(
  trackList: Track[],
  accent?: AssetDispositionIconAccent | null,
): GeoJSON.FeatureCollection {
  const drawTrails = trackMapDrawHistoryTrails(trackList);
  const features: GeoJSON.Feature[] = [];
  const td = useTrackDisplayStore.getState();

  for (const t of trackList) {
    const { pointFill } = trackPointFillAndStyle(t, accent);
    const trail = trimHistoryTrailForDisplay(t.historyTrail, trailLengthSecondsForTrack(t, td));

    if (drawTrails && trail && trail.length >= 1) {
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
    if (isDotTrackLayerKey(layerKey)) continue;
    const { pointFill, disp, neutralFusion, style } = trackPointFillAndStyle(t, accent);
    const friendlyFill = disp === "friendly" ? style.idColor : undefined;
    const v = t.isVirtual === true;
    const iconScale = Math.max(0.55, Math.min(1.5, style.pointSize / 3.5));
    const airBirdGlyph = isAirTrackBirdGlyph(t);
    const isFuseAirTrack = resolveTrackLayerKey(t) === "fuse_air";
    const airFuseGlyph = isFuseAirTrack && airBirdGlyph;
    const opticallyVerified = shouldApplyVerifiedTrackGreen(t);
    const baseProps: Record<string, unknown> = {
      id: t.id,
      showID: t.showID,
      uniqueID: t.uniqueID,
      trackId: t.trackId ?? null,
      isAirTrack: t.isAirTrack ?? false,
      targetType: t.targetType ?? null,
      name: t.name,
      mapLabelText: getTrackIdModeConfig().distinguishSeaAir
        ? (t.type === "air" ? t.showID : (t.trackId ?? t.showID))
        : (t.trackId ?? t.showID),
      type: t.type,
      disposition: disp,
      speed: t.speed,
      heading: t.heading,
      course: t.course ?? null,
      isFuseAirTrack,
      isAirBirdGlyph: airBirdGlyph,
      altitude: t.altitude ?? null,
      color: pointFill,
      labelColor: shouldApplyVerifiedTrackGreen(t) || disp === "neutral" ? pointFill : style.idColor,
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
 * 雷达 / AIS 航迹点 → GeoJSON：**Point**（圆点层用 `color`），供 `TRACK_RADAR_PTS_SOURCE`。
 */
export function buildTrackRadarPointsGeoJSON(
  trackList: Track[],
  accent?: AssetDispositionIconAccent | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const t of trackList) {
    const layerKey = resolveTrackLayerKey(t);
    if (!isDotTrackLayerKey(layerKey)) continue;
    const { pointFill, disp, style } = trackPointFillAndStyle(t, accent);
    const baseProps: Record<string, unknown> = {
      id: t.id,
      showID: t.showID,
      uniqueID: t.uniqueID,
      trackId: t.trackId ?? null,
      isAirTrack: t.isAirTrack ?? false,
      targetType: t.targetType ?? null,
      name: t.name,
      mapLabelText: getTrackIdModeConfig().distinguishSeaAir
        ? (t.type === "air" ? t.showID : (t.trackId ?? t.showID))
        : (t.trackId ?? t.showID),
      type: t.type,
      disposition: disp,
      speed: t.speed,
      heading: t.heading,
      course: t.course ?? null,
      altitude: t.altitude ?? null,
      color: pointFill,
      labelColor: shouldApplyVerifiedTrackGreen(t) || disp === "neutral" ? pointFill : style.idColor,
      labelTextSize: Math.max(6, Math.min(22, style.idSize)),
    };
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
    h ^= t.isVirtual === true ? 1 : 0;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= t.isUav === true ? 1 : 0;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= isAirTrackBirdGlyph(t) ? 1 : 0;
    h = Math.imul(h, 16777619) >>> 0;
    const lk = resolveTrackLayerKey(t);
    const mapDot = isDotTrackLayerKey(lk);
    h ^= mapDot ? 1 : 0;
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
    h ^= shouldApplyVerifiedTrackGreen(t) ? 1 : 0;
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
  /** 并发 `setTracksAsync` 时只应用最后一次结果 */
  private trackFlushGeneration = 0;
  /**
   * 与航迹几何无关的渲染参数每变一次 +1（如 `factory.assetIcons` 驱动的 `setTrackDispositionAccent`），
   * 使 `setTracks` 的缓存键失效，避免沿用上一帧 GeoJSON。
   */
  private trackRenderRevision = 0;
  /** 上一帧写入三源的签名；与当前帧一致则跳过 `setData`（减轻 MapLibre 压力） */
  private lastSetDataKey = "";
  /** 最近一次 `setTracks` 入参，供威胁序号单独刷新 */
  private lastTracks: Track[] = [];
  /** showID → 威胁序号 1–5（1 为最高威胁度） */
  private threatRankByShowId = new Map<string, number>();

  constructor(map: maplibregl.Map) {
    this.map = map;
  }

  /** 与 `factory.assetIcons` 一致：航迹点颜色走 `resolveTrackMarkerFill` */
  setTrackDispositionAccent(accent: AssetDispositionIconAccent | null) {
    this.dispositionAccent = accent;
    this.trackRenderRevision++;
    this.lastSetDataKey = "";
  }

  /** 应用 `app-config.json` 中 `trackRendering.trackDisplay`（如是否显示名称） */
  applyTrackRenderingLayout() {
    const m = this.map;
    const tr = getTrackRenderingConfig();
    const vis = tr.trackDisplay.showTrackId ? "visible" : "none";
    for (const lid of [TRACK_LABEL, TRACK_LABEL_RADAR]) {
      if (m.getLayer(lid)) {
        m.setLayoutProperty(lid, "visibility", vis);
        m.setLayoutProperty(lid, "text-size", ["coalesce", ["get", "labelTextSize"], 10]);
        m.setPaintProperty(lid, "text-color", ["coalesce", ["get", "labelColor"], "#a1a1aa"]);
      }
    }
    /* 三源构建会读 `trackTypeStyles` 等，配置热变时需重算 */
    this.lastSetDataKey = "";
  }

  /** 折线源 + 融合/雷达点源 + 双高亮层；供后续专题层插在 `HIGHLIGHT_LAYER` 下 */
  installSourceAndHighlight(initialTracks: Track[]) {
    const m = this.map;
    if (m.getSource(TRACK_SOURCE)) {
      if (!m.getSource(TRACK_THREAT_RANK_SOURCE)) {
        m.addSource(TRACK_THREAT_RANK_SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      return;
    }
    const accent = this.dispositionAccent;
    m.addSource(TRACK_SOURCE, {
      type: "geojson",
      data: buildTrackLinesGeoJSON(initialTracks, accent),
    });
    m.addSource(TRACK_FUSION_PTS_SOURCE, {
      type: "geojson",
      data: buildTrackFusionPointsGeoJSON(initialTracks, accent),
    });
    m.addSource(TRACK_RADAR_PTS_SOURCE, {
      type: "geojson",
      data: buildTrackRadarPointsGeoJSON(initialTracks, accent),
    });
    m.addSource(TRACK_THREAT_RANK_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    if (!m.getLayer(HIGHLIGHT_LAYER)) {
      m.addLayer({
        id: HIGHLIGHT_LAYER,
        type: "symbol",
        source: TRACK_FUSION_PTS_SOURCE,
        filter: filterPointsOnly(["in", "id", ""]),
        layout: {
          "icon-image": TRACK_SELECT_RING_ID,
          "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.58, 10, 0.86, 15, 1.12],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-rotation-alignment": "viewport",
          "icon-pitch-alignment": "viewport",
        },
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
          layout: {
            "icon-image": TRACK_SELECT_RING_ID,
            "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.58, 10, 0.86, 15, 1.12],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-rotation-alignment": "viewport",
            "icon-pitch-alignment": "viewport",
          },
          paint: { "icon-opacity": 0.88 },
        },
        HIGHLIGHT_LAYER,
      );
    }
  }

  /** 锁定圈 + 航迹线 + 航迹符号 + 名称；须在雷达/光电安装之后调用 */
  installSymbolLayers() {
    const m = this.map;
    if (!m.getSource(TRACK_SOURCE) || !m.getSource(TRACK_FUSION_PTS_SOURCE) || !m.getSource(TRACK_RADAR_PTS_SOURCE))
      return;

    const lockFilter = filterPointsOnly(["in", "id", ""]);

    if (!m.getLayer(LOCK_ON)) {
      m.addLayer({
        id: LOCK_ON,
        type: "symbol",
        source: TRACK_FUSION_PTS_SOURCE,
        filter: lockFilter,
        layout: {
          "icon-image": LOCK_ON_IMAGE_ID,
          "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 0.72, 15, 1.05],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-rotation-alignment": "viewport",
          "icon-pitch-alignment": "viewport",
        },
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
          layout: {
            "icon-image": LOCK_ON_IMAGE_ID,
            "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 0.72, 15, 1.05],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-rotation-alignment": "viewport",
            "icon-pitch-alignment": "viewport",
          },
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
        layout: {
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
            ["coalesce", ["get", "heading"], 0],
          ],
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          /* `["zoom"]` 只能作为**顶层** `interpolate`/`step` 的输入，不能包在 `*` 里 */
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
        },
      });
    }
    if (!m.getLayer(TRACK_TRAIL)) {
      m.addLayer(
        {
          id: TRACK_TRAIL,
          type: "line",
          source: TRACK_SOURCE,
          filter: LINE_TRAIL_FILTER,
          /**
           * 尾迹用圆点串显示：line-cap=round + line-dasharray=[0, N] 时每个"dash"退化为圆点。
           * N 控制点间距（单位 = line-width），值越小点越密。
           */
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
    if (!m.getLayer(TRACK_DOT)) {
      m.addLayer(
        {
          id: TRACK_DOT,
          type: "circle",
          source: TRACK_RADAR_PTS_SOURCE,
          filter: filterPointsOnly(null),
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
    }
    if (!m.getLayer(TRACK_LABEL)) {
      m.addLayer({
        id: TRACK_LABEL,
        type: "symbol",
        source: TRACK_FUSION_PTS_SOURCE,
        filter: filterPointsOnly(null),
        layout: {
          "text-field": ["coalesce", ["get", "mapLabelText"], ["get", "name"], ""],
          "text-font": ["Open Sans Regular"],
          "text-size": 10,
          "text-offset": [0, 2.2],
          "text-anchor": "top",
          "text-max-width": 10,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
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
        layout: {
          "text-field": ["coalesce", ["get", "mapLabelText"], ["get", "name"], ""],
          "text-font": ["Open Sans Regular"],
          "text-size": 10,
          "text-offset": [0, 2.2],
          "text-anchor": "top",
          "text-max-width": 10,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
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

  /** 更新告警航迹威胁 Top5 序号（1=最高威胁度） */
  setThreatRankByShowId(rankByShowId: Map<string, number>) {
    this.threatRankByShowId = rankByShowId;
    this.lastSetDataKey = "";
    void this.setTracksAsync(this.lastTracks);
  }

  setTracks(tracks: Track[]) {
    this.lastTracks = tracks;
    void this.setTracksAsync(tracks);
  }

  /** 自定义融合色会生成新的 `symbolId`，须先 `addImage` 再 `setData`，否则图标空白 */
  private async setTracksAsync(tracks: Track[]) {
    const srcLines = this.map.getSource(TRACK_SOURCE) as maplibregl.GeoJSONSource | undefined;
    const srcFus = this.map.getSource(TRACK_FUSION_PTS_SOURCE) as maplibregl.GeoJSONSource | undefined;
    const srcRad = this.map.getSource(TRACK_RADAR_PTS_SOURCE) as maplibregl.GeoJSONSource | undefined;
    const srcRank = this.map.getSource(TRACK_THREAT_RANK_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!srcLines || !srcFus || !srcRad || !srcRank) return;
    const gen = ++this.trackFlushGeneration;
    const vis = useAppStore.getState().layerVisibility;
    const sub = useTrackDisplayStore.getState().trackSubtypeVisible;
    const airSub = useTrackDisplayStore.getState().airFusionSubtypeVisible;
    const filtered = filterTracksForMapRender(tracks, vis, sub, airSub);
    const visSig = trackMapVisibilitySignature(vis, sub, airSub);
    const trd = getTrackRenderingConfig().trackDisplay;
    const maxVp = trd.maxViewportPoints;
    const maxHist = trd.maxHistoryPointsPerTrack;
    const drawTrails = trackMapDrawHistoryTrails(filtered) ? 1 : 0;
    const tdRev = useTrackDisplayStore.getState().displayRevision;
    const affRev = useTrackStore.getState().mapManualAffiliationRev;
    const verRev = useVerifiedTrackStore.getState().mapVerifiedRev;
    const fp = fnv1aTrackDataFingerprint(filtered);
    const rankSig = [...this.threatRankByShowId.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join("|");
    const key = `${this.trackRenderRevision}:${maxVp}:${maxHist}:${drawTrails}:${tdRev}:${affRev}:${verRev}:${visSig}:${filtered.length}:${fp}:${rankSig}`;
    if (key === this.lastSetDataKey) return;
    try {
      await this.ensureTrackSymbolImages(filtered);
    } catch (e) {
      console.warn("[tracks-maplibre] ensureTrackSymbolImages:", e);
    }
    if (gen !== this.trackFlushGeneration) return;
    this.lastSetDataKey = key;
    const accent = this.dispositionAccent;
    srcLines.setData(buildTrackLinesGeoJSON(filtered, accent) as GeoJSON.FeatureCollection);
    srcFus.setData(buildTrackFusionPointsGeoJSON(filtered, accent) as GeoJSON.FeatureCollection);
    srcRad.setData(buildTrackRadarPointsGeoJSON(filtered, accent) as GeoJSON.FeatureCollection);
    srcRank.setData(
      buildThreatRankPointsGeoJSON(filtered, this.threatRankByShowId) as GeoJSON.FeatureCollection,
    );
  }

  /** 按需注册军标：中立融合自定义色 + 光电查证完成（`-ov` 绿色军标） */
  private async ensureTrackSymbolImages(tracks: Track[]) {
    const m = this.map;
    const td = useTrackDisplayStore.getState();
    const accent = this.dispositionAccent;
    const tr = getTrackRenderingConfig();
    const seen = new Set<string>();
    for (const t of tracks) {
      if (isDotTrackLayerKey(resolveTrackLayerKey(t))) continue;
      const disp = getTrackDispositionForRendering(t);
      const style = tr.trackTypeStyles[t.type] ?? tr.trackTypeStyles.sea;
      const friendlyFill = disp === "friendly" ? style.idColor : undefined;
      const neutralFusion =
        disp === "neutral" ? neutralFusionColorForTrack(t, td.seaFusionColor, td.airFusionColor) : undefined;
      const airBirdGlyph = isAirTrackBirdGlyph(t);
      const airFuseGlyph = resolveTrackLayerKey(t) === "fuse_air" && airBirdGlyph;
      const opticallyVerified = shouldApplyVerifiedTrackGreen(t);
      const needsCustomNeutral = disp === "neutral" && !opticallyVerified;
      const needsVerifiedIcon = opticallyVerified;
      if (!needsCustomNeutral && !needsVerifiedIcon) continue;

      const id = getMarkerSymbolId(
        t.type,
        disp,
        t.isVirtual === true,
        friendlyFill,
        neutralFusion,
        airBirdGlyph,
        airFuseGlyph,
        opticallyVerified,
      );
      if (seen.has(id)) continue;
      seen.add(id);
      if (m.hasImage(id)) continue;
      const srcData = buildMarkerSymbolDataUrl(
        t.type,
        disp,
        accent,
        t.isVirtual === true,
        friendlyFill,
        neutralFusion,
        airBirdGlyph,
        airFuseGlyph,
        opticallyVerified,
      );
      m.addImage(id, await loadSvgImage(srcData, 64), { pixelRatio: 2 });
    }
  }

  setHighlightFilter(ids: string[]) {
    const f = filterPointsOnly(
      ids.length ? (["in", "id", ...ids] as FilterSpecification) : (["in", "id", ""] as FilterSpecification),
    );
    if (this.map.getLayer(HIGHLIGHT_LAYER)) this.map.setFilter(HIGHLIGHT_LAYER, f);
    if (this.map.getLayer(HIGHLIGHT_RADAR_LAYER)) this.map.setFilter(HIGHLIGHT_RADAR_LAYER, f);
  }

  setLockOnFilter(selectedId: string | null) {
    const f = filterPointsOnly(
      selectedId ? (["==", "id", selectedId] as FilterSpecification) : (["in", "id", ""] as FilterSpecification),
    );
    if (this.map.getLayer(LOCK_ON)) this.map.setFilter(LOCK_ON, f);
    if (this.map.getLayer(LOCK_ON_RADAR)) this.map.setFilter(LOCK_ON_RADAR, f);
  }

  dispose() {
    const m = this.map;
    for (const id of [
      TRACK_THREAT_RANK,
      TRACK_LABEL_RADAR,
      TRACK_LABEL,
      TRACK_VECTOR,
      TRACK_TRAIL,
      TRACK_DOT,
      TRACK_SYMBOL,
      LOCK_ON_RADAR,
      LOCK_ON,
      HIGHLIGHT_RADAR_LAYER,
      HIGHLIGHT_LAYER,
    ]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    for (const sid of [
      TRACK_THREAT_RANK_SOURCE,
      TRACK_RADAR_PTS_SOURCE,
      TRACK_FUSION_PTS_SOURCE,
      TRACK_SOURCE,
    ]) {
      if (m.getSource(sid)) m.removeSource(sid);
    }
  }
}
