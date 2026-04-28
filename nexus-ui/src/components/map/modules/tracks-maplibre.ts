import type maplibregl from "maplibre-gl";
import type { FilterSpecification } from "maplibre-gl";
import type { Track } from "@/lib/map-entity-model";
import {
  getMarkerSymbolId,
  TRACK_SELECT_RING_ID,
  LOCK_ON_IMAGE_ID,
  resolveTrackMarkerFill,
  type AssetDispositionIconAccent,
} from "@/lib/map-icons";
import { getTrackRenderingConfig, getTrackIdModeConfig } from "@/lib/map-app-config";

/** GeoJSON source id：航迹点、折线、高亮环、锁定圈共用 */
export const TRACK_SOURCE = "tracks-source";

/** 多选高亮环：`insertBeforeLayerId` 指向本层时，雷达/光电等专题层会插在其下（由下至上绘制，高亮环盖在专题层之上） */
export const HIGHLIGHT_LAYER = "tracks-highlight";

export const TRACK_TRAIL = "tracks-trail";
export const TRACK_SYMBOL = "tracks-symbol";
export const TRACK_LABEL = "tracks-label";
/** 锁定圈：`setLockOnFilter` 更新 filter */
export const LOCK_ON = "tracks-lock-on";

/** 与点符号/高亮/锁定混用同一 GeoJSON 源时，排除折线要素（须用旧版 `$type` 过滤器，勿用 `["geometry-type"]` 表达式，否则 MapLibre 报 string expected, array found） */
const GEOM_POINT: FilterSpecification = ["==", "$type", "Point"];

function filterPointsOnly(extra: FilterSpecification | null): FilterSpecification {
  if (!extra) return GEOM_POINT;
  return ["all", GEOM_POINT, extra] as unknown as FilterSpecification;
}

/** 图层面板 `lyr-tracks`、事件绑定等与 `layer.id` 一致 */
export const TRACK_LAYER_IDS = [TRACK_TRAIL, TRACK_SYMBOL, TRACK_LABEL, HIGHLIGHT_LAYER, LOCK_ON] as const;

/**
 * 与 `trackRendering.trackDisplay.maxViewportPoints` 对齐的顶点估算：每条航迹计 `1 + len(historyTrail)`（当前点 + 历史折线顶点数）。
 * **不修改** `Track`；仅用于判断是否绘制历史折线。
 */
export function trackMapVertexEstimate(tracks: ReadonlyArray<Track>): number {
  return tracks.reduce((n, t) => n + 1 + (t.historyTrail?.length ?? 0), 0);
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

/**
 * `Track[]` → GeoJSON：**Point**（当前位置）始终输出；**LineString** 仅在 `trackMapDrawHistoryTrails(trackList)` 为真且存在 `historyTrail` 时输出。
 */
export function buildTrackGeoJSON(
  trackList: Track[],
  accent?: AssetDispositionIconAccent | null,
): GeoJSON.FeatureCollection {
  const tr = getTrackRenderingConfig();
  const drawTrails = trackMapDrawHistoryTrails(trackList);
  const features: GeoJSON.Feature[] = [];

  for (const t of trackList) {
    const trail = t.historyTrail;
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
            lineColor: resolveTrackMarkerFill(
              t.disposition,
              accent ?? null,
              t.disposition === "friendly"
                ? (tr.trackTypeStyles[t.type] ?? tr.trackTypeStyles.sea).idColor
                : undefined,
            ),
          },
        });
      }
    }

    const ts = tr.trackTypeStyles[t.type] ?? tr.trackTypeStyles.sea;
    const v = t.isVirtual === true;
    const iconScale = Math.max(0.55, Math.min(1.5, ts.pointSize / 3.5));
    const friendlyFill = t.disposition === "friendly" ? ts.idColor : undefined;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [t.lng, t.lat] as [number, number] },
      properties: {
        id: t.id,
        showID: t.showID,
        uniqueID: t.uniqueID,
        trackId: t.trackId ?? null,
        isAirTrack: t.isAirTrack ?? false,
        targetType: t.targetType ?? null,
        name: t.name,
        /** 地图标牌：18.141 模式(distinguishSeaAir=false)显示 trackId；28.9 模式对空显示 showID，对海显示 trackId */
        mapLabelText: getTrackIdModeConfig().distinguishSeaAir
          ? (t.type === "air" ? t.showID : (t.trackId ?? t.showID))
          : (t.trackId ?? t.showID),
        type: t.type,
        disposition: t.disposition,
        speed: t.speed,
        heading: t.heading,
        course: t.course ?? null,
        altitude: t.altitude ?? null,
        color: resolveTrackMarkerFill(t.disposition, accent ?? null, friendlyFill),
        symbolId: getMarkerSymbolId(t.type, t.disposition, v, friendlyFill),
        labelColor: ts.idColor,
        labelTextSize: Math.max(6, Math.min(22, ts.idSize)),
        iconScale,
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
    for (let i = 0; i < t.disposition.length; i++) {
      h ^= t.disposition.charCodeAt(i);
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
  }
  return h >>> 0;
}

/**
 * 航迹：单一 GeoJSON 源 + 折线 + 高亮环 / 锁定圈 / 符号 / 名称标签。
 * 安装分两段：`installSourceAndHighlight` 须在雷达/光电等 `insertBeforeLayerId: HIGHLIGHT_LAYER` 之前调用；
 * `installSymbolLayers` 在专题层装完后再调用（锁定圈与符号叠在最上）。
 */
export class TracksMaplibre {
  private map: maplibregl.Map;
  private dispositionAccent: AssetDispositionIconAccent | null = null;
  /**
   * 与航迹几何无关的渲染参数每变一次 +1（如 `factory.assetIcons` 驱动的 `setTrackDispositionAccent`），
   * 使 `setTracks` 的缓存键失效，避免沿用上一帧 GeoJSON。
   */
  private trackRenderRevision = 0;
  /** 上一帧写入 source 的签名；与当前帧一致则跳过 `buildTrackGeoJSON` + `setData`（减轻 MapLibre 压力） */
  private lastSetDataKey = "";

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
    if (m.getLayer(TRACK_LABEL)) {
      m.setLayoutProperty(TRACK_LABEL, "visibility", tr.trackDisplay.showTrackId ? "visible" : "none");
      m.setLayoutProperty(TRACK_LABEL, "text-size", ["coalesce", ["get", "labelTextSize"], 10]);
      m.setPaintProperty(TRACK_LABEL, "text-color", ["coalesce", ["get", "labelColor"], "#a1a1aa"]);
    }
    /* `buildTrackGeoJSON` 会读 `trackTypeStyles` 等，配置热变时需重算 */
    this.lastSetDataKey = "";
  }

  /** source + 多选高亮层；供后续专题层插在下方 */
  installSourceAndHighlight(initialTracks: Track[]) {
    const m = this.map;
    if (m.getSource(TRACK_SOURCE)) return;
    m.addSource(TRACK_SOURCE, {
      type: "geojson",
      data: buildTrackGeoJSON(initialTracks, this.dispositionAccent),
    });
    if (!m.getLayer(HIGHLIGHT_LAYER)) {
      m.addLayer({
        id: HIGHLIGHT_LAYER,
        type: "symbol",
        source: TRACK_SOURCE,
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
  }

  /** 锁定圈 + 航迹线 + 航迹符号 + 名称；须在雷达/光电安装之后调用 */
  installSymbolLayers() {
    const m = this.map;
    if (!m.getSource(TRACK_SOURCE)) return;
    if (!m.getLayer(LOCK_ON)) {
      m.addLayer({
        id: LOCK_ON,
        type: "symbol",
        source: TRACK_SOURCE,
        filter: filterPointsOnly(["in", "id", ""]),
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
    if (!m.getLayer(TRACK_SYMBOL)) {
      m.addLayer({
        id: TRACK_SYMBOL,
        type: "symbol",
        source: TRACK_SOURCE,
        filter: filterPointsOnly(null),
        layout: {
          "icon-image": ["get", "symbolId"],
          "icon-rotate": ["coalesce", ["get", "heading"], 0],
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
          filter: ["==", "$type", "LineString"],
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": ["coalesce", ["get", "lineColor"], "#71717a"],
            "line-width": 2,
            "line-opacity": 0.55,
          },
        },
        TRACK_SYMBOL,
      );
    }
    if (!m.getLayer(TRACK_LABEL)) {
      m.addLayer({
        id: TRACK_LABEL,
        type: "symbol",
        source: TRACK_SOURCE,
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
  }

  setTracks(tracks: Track[]) {
    const src = this.map.getSource(TRACK_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const trd = getTrackRenderingConfig().trackDisplay;
    const maxVp = trd.maxViewportPoints;
    const maxHist = trd.maxHistoryPointsPerTrack;
    const drawTrails = trackMapDrawHistoryTrails(tracks) ? 1 : 0;
    const fp = fnv1aTrackDataFingerprint(tracks);
    const key = `${this.trackRenderRevision}:${maxVp}:${maxHist}:${drawTrails}:${tracks.length}:${fp}`;
    if (key === this.lastSetDataKey) return;
    this.lastSetDataKey = key;
    src.setData(buildTrackGeoJSON(tracks, this.dispositionAccent) as GeoJSON.FeatureCollection);
  }

  setHighlightFilter(ids: string[]) {
    if (!this.map.getLayer(HIGHLIGHT_LAYER)) return;
    this.map.setFilter(
      HIGHLIGHT_LAYER,
      filterPointsOnly(ids.length ? (["in", "id", ...ids] as FilterSpecification) : ["in", "id", ""]),
    );
  }

  setLockOnFilter(selectedId: string | null) {
    if (!this.map.getLayer(LOCK_ON)) return;
    this.map.setFilter(
      LOCK_ON,
      filterPointsOnly(
        selectedId ? (["==", "id", selectedId] as FilterSpecification) : ["in", "id", ""],
      ),
    );
  }

  dispose() {
    const m = this.map;
    for (const id of [TRACK_LABEL, TRACK_TRAIL, TRACK_SYMBOL, LOCK_ON, HIGHLIGHT_LAYER]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource(TRACK_SOURCE)) m.removeSource(TRACK_SOURCE);
  }
}
