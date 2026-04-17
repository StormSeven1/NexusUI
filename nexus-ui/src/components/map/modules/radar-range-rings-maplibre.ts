import type maplibregl from "maplibre-gl";
import type { AssetData } from "@/stores/asset-store";
import { parseMapAssetTypeStrict } from "@/lib/map-entity-model";
import { parseForceDisposition } from "@/lib/theme-colors";
import { mergeRootAndDeviceVisible } from "@/lib/utils";
import type { AssetDispositionIconAccent, AssetStatus } from "@/lib/map-icons";
import {
  assetMapLabelTextColor,
  geoCircleCoords,
  getAssetSymbolId,
  MAP_FRIENDLY_COLOR_PROP,
  MAPLIBRE_ASSET_CENTER_ICON_SIZE,
} from "@/lib/map-icons";
import type { Asset } from "@/lib/map-entity-model";

/**
 * 雷达距离环覆盖：构建 GeoJSON，行为对齐 V2 `RangeRingManager` 与 `map-app-config`。
 */

export const RADAR_COVERAGE_SOURCE = "radar-coverage-source";
export const RADAR_BAND_FILL = "radar-band-fill";
export const RADAR_RING_LINE = "radar-ring-line";
export const RADAR_CROSSHAIR = "radar-crosshair";
export const RADAR_DIST_LABEL = "radar-dist-label";
export const RADAR_ANGLE_LABEL = "radar-angle-label";
export const RADAR_CENTER_NAME = "radar-center-name";

/** 雷达中心资产图标 GeoJSON 的 source / layer id，由本文件内 `RadarCoverageModule` 挂载 */
export const RADAR_ASSET_ICON_SOURCE = "radar-asset-icon-src";
export const RADAR_ASSET_ICON_LAYER = "radar-asset-icon";

export const RADAR_COVERAGE_LAYER_IDS = [
  RADAR_BAND_FILL,
  RADAR_RING_LINE,
  RADAR_CROSSHAIR,
  RADAR_DIST_LABEL,
  RADAR_ANGLE_LABEL,
  RADAR_CENTER_NAME,
] as const;

export type RadarTextBlock = {
  fontSize?: number;
  fontColor?: string;
  haloColor?: string;
  haloWidth?: number;
  textOffset?: [number, number];
  textFont?: string[];
};

export type RadarCrosshairBlock = {
  lineWidth?: number;
  lineDash?: number[];
  lineOpacity?: number;
  color?: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function isoNow() {
  return new Date().toISOString();
}

function cssColorToRgba(input: string, alpha: number): string | null {
  const s = input.trim();
  const a = Math.min(1, Math.max(0, alpha));
  if (!s) return null;
  if (s.startsWith("rgba(")) return s;
  if (s.startsWith("rgb(")) {
    const m = s.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
    if (!m) return null;
    return `rgba(${m[1]},${m[2]},${m[3]},${a})`;
  }
  let hex = s.replace(/^#/, "");
  if (hex.length === 3) {
    hex = hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!;
  }
  if (hex.length !== 6) return null;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (![r, g, b].every((x) => Number.isFinite(x))) return null;
  return `rgba(${r},${g},${b},${a})`;
}

/** 闭合圆环折线（LineString），点列来自 `geoCircleCoords` */
function circleLineStringKm(lng: number, lat: number, radiusKm: number, segments = 64): GeoJSON.Position[] {
  const ring = geoCircleCoords(lng, lat, radiusKm, segments);
  return ring.map(([x, y]) => [x, y] as GeoJSON.Position);
}

function normalizePolygonOuterRing(ring: Array<[number, number]>): Array<[number, number]> {
  if (ring.length < 4) return ring;
  let a = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    a += x1 * y2 - x2 * y1;
  }
  if (a < 0) {
    const copy = [...ring];
    copy.reverse();
    return copy;
  }
  return ring;
}

/** 由起点、距离 distanceM（米）、方位角 bearingDeg（度）求终点，与 V2 大地算法一致 */
export function pointAtBearingMeters(
  centerLng: number,
  centerLat: number,
  distanceM: number,
  bearingDeg: number,
): [number, number] {
  const R = 6_371_000;
  const d = distanceM / R;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (centerLat * Math.PI) / 180;
  const lng1 = (centerLng * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

function parseTextBlock(raw: unknown, fallback: Required<RadarTextBlock>): Required<RadarTextBlock> {
  const o = asRecord(raw) ?? {};
  const off = o.textOffset;
  return {
    fontSize: Number.isFinite(Number(o.fontSize)) ? Number(o.fontSize) : fallback.fontSize,
    fontColor: typeof o.fontColor === "string" ? o.fontColor : fallback.fontColor,
    haloColor: typeof o.haloColor === "string" ? o.haloColor : fallback.haloColor,
    haloWidth: Number.isFinite(Number(o.haloWidth)) ? Number(o.haloWidth) : fallback.haloWidth,
    textOffset:
      Array.isArray(off) && off.length >= 2 && Number.isFinite(Number(off[0])) && Number.isFinite(Number(off[1]))
        ? [Number(off[0]), Number(off[1])]
        : fallback.textOffset!,
    textFont: Array.isArray(o.textFont) && o.textFont.length ? o.textFont.map(String) : fallback.textFont!,
  };
}

function parseCrosshair(raw: unknown): Required<RadarCrosshairBlock> {
  const o = asRecord(raw) ?? {};
  const dash = Array.isArray(o.lineDash) ? (o.lineDash as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n)) : [];
  return {
    lineWidth: Number.isFinite(Number(o.lineWidth)) ? Number(o.lineWidth) : 1,
    lineDash: dash.length ? dash : [4, 4],
    lineOpacity: Number.isFinite(Number(o.lineOpacity)) ? Number(o.lineOpacity) : 0.6,
    color: typeof o.color === "string" ? o.color : "#FFFFFF",
  };
}

/**
 * 将配置行 `radar[]` 映射为 `AssetData`，字段语义对齐 V2 `RangeRingManager` / `NewFront/public/config.js`：
 * - **maxRange** / **interval**：若未显式给 `ringCount`，则 `ringCount = ceil(maxRange/interval)`
 * - **showRings** 为 false 时不绘制距离环
 * - **opacity** 映射为环线 `line-opacity`；**ringFillOpacity** / **ringFillColor** 与 **color** 共同决定填充
 * - **ringLineWidth** / **ringLineDash**：**virtualTroop** 等与 V2 虚线样式一致
 * - **distanceLabelsVisible** / **angleLabelsVisible** / **crosshairVisible** / **centerIconVisible** / **centerNameVisible**：
 *   经 **`radar.visibility`**、`radarVisibility`、`mergeRootAndDeviceVisible` 合并后写入 `properties`；
 *   `RADAR_CENTER_NAME` 还受 **showRings** 与 **center_name_visible** 控制
 * - **distanceLabelColor** / **angleLabelColor** 为 **null** 时用 **color** / **angleLabel.fontColor**
 * - **label** / **distanceLabel** / **angleLabel** 中的 **textFont** 供 MapLibre 符号层使用
 * - **crosshair** 十字线样式见 **crosshair**
 */
export type RadarVisibilityGlobal = {
  centerNameVisible?: boolean;
  centerIconVisible?: boolean;
};

export function mapRadarRowToAssetData(
  r: Record<string, unknown>,
  globals?: RadarVisibilityGlobal | null,
): AssetData | null {
  const id = String(r.id ?? "");
  const c = r.center;
  if (!id || !Array.isArray(c) || c.length < 2) return null;
  const lng = Number(c[0]);
  const lat = Number(c[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  const declared = parseMapAssetTypeStrict(r.assetType ?? r.asset_type, `radar.devices[${id}].assetType`);
  if (declared !== "radar") {
    throw new Error(`radar.devices[${id}].assetType 必须为 radar`);
  }

  const maxRangeM = Number(r.maxRange);
  if (!Number.isFinite(maxRangeM) || maxRangeM <= 0) return null;

  const intervalM = Number(r.interval);
  if (!Number.isFinite(intervalM) || intervalM <= 0) return null;

  const ringCountExplicit =
    r.ringCount !== undefined && r.ringCount !== null ? Number(r.ringCount) : NaN;
  const ringCount = Number.isFinite(ringCountExplicit) && ringCountExplicit > 0
    ? Math.floor(ringCountExplicit)
    : Math.ceil(maxRangeM / intervalM);

  const showRings = r.showRings !== false;
  const opacity = Number(r.opacity);
  const ringLineOpacity = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.85;

  const fillOp = Number(r.ringFillOpacity);
  const ringFillOpacity = Number.isFinite(fillOp) ? Math.min(1, Math.max(0, fillOp)) : 0;

  const ringColor = typeof r.color === "string" ? r.color : "#FF0000";
  const ringFillColor = typeof r.ringFillColor === "string" ? r.ringFillColor : ringColor;

  const lw = Number(r.ringLineWidth);
  const ringLineWidth = Number.isFinite(lw) && lw > 0 ? lw : 2;

  const dashRaw = r.ringLineDash;
  const ringLineDash = Array.isArray(dashRaw)
    ? (dashRaw as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n))
    : [];

  const virtualTroop = r.virtualTroop === true;

  const label = parseTextBlock(r.label, {
    fontSize: 13,
    fontColor: "#FFFFFF",
    haloColor: "#000000",
    haloWidth: 2,
    textOffset: [0, 0.4],
    textFont: ["Open Sans Semibold", "Arial Unicode MS Bold"],
  });
  const distanceLabel = parseTextBlock(r.distanceLabel, {
    fontSize: 12,
    fontColor: "#FFFFFF",
    haloColor: "#000000",
    haloWidth: 1.5,
    textOffset: [0, -0.2],
    textFont: ["Open Sans Semibold", "Arial Unicode MS Bold"],
  });
  const angleLabel = parseTextBlock(r.angleLabel, {
    fontSize: 11,
    fontColor: "#FFFF00",
    haloColor: "#000000",
    haloWidth: 1,
    textOffset: [0, 0],
    textFont: ["Open Sans Semibold", "Arial Unicode MS Bold"],
  });
  const crosshair = parseCrosshair(r.crosshair);

  const now = isoNow();
  const props: Record<string, unknown> = {
    config_kind: "radar",
    showRings,
    max_range_m: maxRangeM,
    ring_interval_m: intervalM,
    ring_count: ringCount,
    ring_color: ringColor,
    ring_line_width: ringLineWidth,
    ring_line_dash: ringLineDash,
    ring_line_opacity: ringLineOpacity,
    ring_fill_opacity: ringFillOpacity,
    ring_fill_color: ringFillColor,
    virtual_troop: virtualTroop,
    is_virtual: virtualTroop,
    distance_labels_visible: r.distanceLabelsVisible !== false,
    angle_labels_visible: r.angleLabelsVisible !== false,
    crosshair_visible: r.crosshairVisible !== false,
    center_icon_visible: mergeRootAndDeviceVisible(globals?.centerIconVisible, r.centerIconVisible),
    center_name_visible: mergeRootAndDeviceVisible(globals?.centerNameVisible, r.centerNameVisible),
    angle_label_interval_deg: Number.isFinite(Number(r.angleLabelInterval)) ? Number(r.angleLabelInterval) : 30,
    distance_label_color:
      r.distanceLabelColor === null ? null : typeof r.distanceLabelColor === "string" ? r.distanceLabelColor : undefined,
    angle_label_color:
      r.angleLabelColor === null ? null : typeof r.angleLabelColor === "string" ? r.angleLabelColor : undefined,
    label_block: label,
    distance_label_block: distanceLabel,
    angle_label_block: angleLabel,
    crosshair_block: crosshair,
    ...(typeof label.fontColor === "string" && label.fontColor.trim()
      ? { [MAP_FRIENDLY_COLOR_PROP]: label.fontColor.trim() }
      : {}),
  };

  return {
    id,
    name: String(r.name ?? id),
    asset_type: "radar",
    status: String(r.status ?? "online"),
    disposition: parseForceDisposition(r.disposition, "friendly"),
    lat,
    lng,
    range_km: maxRangeM / 1000,
    heading: r.heading != null ? Number(r.heading) : null,
    fov_angle: 360,
    properties: props,
    mission_status: "monitoring",
    assigned_target_id: null,
    target_lat: null,
    target_lng: null,
    created_at: String(r.created_at ?? now),
    updated_at: now,
  };
}

/** 兼容 `radar: [...]` 与 `radar: { visibility, devices }`；与 cameras 下 `stations` 写法类似 */
export function extractRadarStationRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const o = asRecord(payload);
  if (!o) return [];
  if (Array.isArray(o.devices)) return o.devices;
  if (Array.isArray(o.stations)) return o.stations;
  return [];
}

export function mapRadarPayload(payload: unknown, globals?: RadarVisibilityGlobal | null): AssetData[] {
  const rows = extractRadarStationRows(payload);
  const out: AssetData[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const a = mapRadarRowToAssetData(item as Record<string, unknown>, globals);
    if (a) out.push(a);
  }
  return out;
}

function rowAssetStatus(status: string): AssetStatus {
  if (status === "online" || status === "offline" || status === "degraded") return status;
  return "online";
}

function annulusPolygonKm(
  lng: number,
  lat: number,
  outerKm: number,
  innerKm: number,
): GeoJSON.Polygon {
  const outer = normalizePolygonOuterRing(geoCircleCoords(lng, lat, outerKm));
  if (!(innerKm > 0.00001)) {
    return { type: "Polygon", coordinates: [outer] };
  }
  let inner = geoCircleCoords(lng, lat, innerKm);
  inner = [...inner].reverse();
  return { type: "Polygon", coordinates: [outer, inner] };
}

/** 由 `AssetData` 雷达行生成覆盖 GeoJSON；`showRings === false` 时跳过 */
export function buildRadarCoverageGeoJSON(
  rows: AssetData[],
  accent?: AssetDispositionIconAccent | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const row of rows) {
    if (String(row.asset_type ?? "").toLowerCase() !== "radar") continue;
    const p = (row.properties ?? {}) as Record<string, unknown>;
    if (p.showRings === false) continue;
    const maxRangeM = Number(p.max_range_m);
    const intervalM = Number(p.ring_interval_m);
    if (!Number.isFinite(maxRangeM) || maxRangeM <= 0 || !Number.isFinite(intervalM) || intervalM <= 0) continue;

    const ringCount = Number.isFinite(Number(p.ring_count)) && Number(p.ring_count) > 0 ? Math.floor(Number(p.ring_count)) : Math.ceil(maxRangeM / intervalM);
    const actualMaxM = ringCount * intervalM;

    const lng = row.lng;
    const lat = row.lat;
    const ringColor = String(p.ring_color ?? "#FF0000");
    const lineW = Number(p.ring_line_width) > 0 ? Number(p.ring_line_width) : 2;
    const lineOp = Number.isFinite(Number(p.ring_line_opacity)) ? Math.min(1, Math.max(0, Number(p.ring_line_opacity))) : 0.85;
    const fillOp = Number.isFinite(Number(p.ring_fill_opacity)) ? Math.min(1, Math.max(0, Number(p.ring_fill_opacity))) : 0;
    const fillColorBase = String(p.ring_fill_color ?? ringColor);
    const fillRgba = cssColorToRgba(fillColorBase, fillOp) ?? fillColorBase;
    const distVis = p.distance_labels_visible !== false;
    const angVis = p.angle_labels_visible !== false;
    const crossVis = p.crosshair_visible !== false;
    const nameVis = p.center_name_visible !== false;
    const disp = parseForceDisposition(row.disposition, "friendly");
    const rowStatus = rowAssetStatus(String(row.status ?? "online"));

    const dl = asRecord(p.distance_label_block) ?? {};
    const al = asRecord(p.angle_label_block) ?? {};
    const distColorRaw = p.distance_label_color;
    const distColor =
      distColorRaw === null || distColorRaw === undefined
        ? String(p.ring_color ?? "#FF0000")
        : String(distColorRaw);
    const angColorRaw = p.angle_label_color;
    const angColor =
      angColorRaw === null || angColorRaw === undefined ? String(al.fontColor ?? "#FFFF00") : String(angColorRaw);

    const angleStep = Number.isFinite(Number(p.angle_label_interval_deg)) ? Number(p.angle_label_interval_deg) : 30;

    for (let i = 1; i <= ringCount; i++) {
      const radiusM = i * intervalM;
      const radiusKm = radiusM / 1000;
      const coords = circleLineStringKm(lng, lat, radiusKm);
      features.push({
        type: "Feature",
        properties: {
          kind: "ring-line",
          radarId: row.id,
          ringLineColor: ringColor,
          ringLineWidth: lineW,
          ringLineOpacity: lineOp,
        },
        geometry: { type: "LineString", coordinates: coords },
      });

      if (fillOp > 0) {
        const innerKm = ((i - 1) * intervalM) / 1000;
        const outerKm = radiusM / 1000;
        const poly = annulusPolygonKm(lng, lat, outerKm, innerKm);
        features.push({
          type: "Feature",
          properties: {
            kind: "ring-band",
            radarId: row.id,
            fillColor: fillRgba,
          },
          geometry: poly,
        });
      }

      if (distVis) {
        const pt = pointAtBearingMeters(lng, lat, radiusM, 0);
        const labelText = radiusM >= 1000 ? `${(radiusM / 1000).toFixed(0)}km` : `${Math.round(radiusM)}m`;
        features.push({
          type: "Feature",
          properties: {
            kind: "dist-label",
            radarId: row.id,
            labelText,
            fontSize: Number(dl.fontSize) > 0 ? Number(dl.fontSize) : 12,
            fontColor: distColor,
            haloColor: String(dl.haloColor ?? "#000000"),
            haloWidth: Number.isFinite(Number(dl.haloWidth)) ? Number(dl.haloWidth) : 1.5,
            textOffsetX: Array.isArray(dl.textOffset) ? Number(dl.textOffset[0]) : 0,
            textOffsetY: Array.isArray(dl.textOffset) ? Number(dl.textOffset[1]) : -0.2,
          },
          geometry: { type: "Point", coordinates: pt },
        });
      }
    }

    if (crossVis) {
      const ch = asRecord(p.crosshair_block) ?? {};
      const chColor = String(ch.color ?? "#FFFFFF");
      const chOp = Number.isFinite(Number(ch.lineOpacity)) ? Number(ch.lineOpacity) : 0.6;
      const north = pointAtBearingMeters(lng, lat, actualMaxM, 0);
      const south = pointAtBearingMeters(lng, lat, actualMaxM, 180);
      const east = pointAtBearingMeters(lng, lat, actualMaxM, 90);
      const west = pointAtBearingMeters(lng, lat, actualMaxM, 270);
      features.push({
        type: "Feature",
        properties: {
          kind: "crosshair",
          radarId: row.id,
          lineColor: chColor,
          lineOpacity: chOp,
          lineWidth: Number.isFinite(Number(ch.lineWidth)) ? Number(ch.lineWidth) : 1,
        },
        geometry: { type: "LineString", coordinates: [south, [lng, lat], north] },
      });
      features.push({
        type: "Feature",
        properties: {
          kind: "crosshair",
          radarId: row.id,
          lineColor: chColor,
          lineOpacity: chOp,
          lineWidth: Number.isFinite(Number(ch.lineWidth)) ? Number(ch.lineWidth) : 1,
        },
        geometry: { type: "LineString", coordinates: [west, [lng, lat], east] },
      });
    }

    if (angVis) {
      for (let deg = 0; deg < 360; deg += angleStep) {
        const pt = pointAtBearingMeters(lng, lat, actualMaxM, deg);
        features.push({
          type: "Feature",
          properties: {
            kind: "angle-label",
            radarId: row.id,
            labelText: `${deg}\u00b0`,
            fontSize: Number(al.fontSize) > 0 ? Number(al.fontSize) : 11,
            fontColor: angColor,
            haloColor: String(al.haloColor ?? "#000000"),
            haloWidth: Number.isFinite(Number(al.haloWidth)) ? Number(al.haloWidth) : 1,
          },
          geometry: { type: "Point", coordinates: pt },
        });
      }
    }

    if (nameVis) {
      const lb = asRecord(p.label_block) ?? {};
      const friendlyOv =
        disp === "friendly" && typeof lb.fontColor === "string" && lb.fontColor.trim() ? lb.fontColor.trim() : undefined;
      const fontColor = assetMapLabelTextColor(disp, rowStatus, accent ?? null, friendlyOv);
      features.push({
        type: "Feature",
        properties: {
          kind: "radar-name",
          radarId: row.id,
          labelText: row.name,
          fontSize: Number(lb.fontSize) > 0 ? Number(lb.fontSize) : 13,
          fontColor,
          haloColor: String(lb.haloColor ?? "#000000"),
          haloWidth: Number.isFinite(Number(lb.haloWidth)) ? Number(lb.haloWidth) : 2,
          textOffsetX: Array.isArray(lb.textOffset) ? Number(lb.textOffset[0]) : 0,
          textOffsetY: Array.isArray(lb.textOffset) ? Number(lb.textOffset[1]) : 0.4,
        },
        geometry: { type: "Point", coordinates: [lng, lat] },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

/** 从首条雷达行取距离/角度/中心名的字体与 text-offset，用于统一 layout */
export function pickRadarTypographyFromRows(rows: AssetData[]): {
  center: Required<RadarTextBlock>;
  distance: Required<RadarTextBlock>;
  angle: Required<RadarTextBlock>;
} {
  const fb = (r: AssetData): Record<string, unknown> => ((r.properties ?? {}) as Record<string, unknown>) ?? {};
  const first = rows.find((r) => String(r.asset_type ?? "").toLowerCase() === "radar");
  const p = first ? fb(first) : {};
  const center = parseTextBlock(p.label_block, {
    fontSize: 13,
    fontColor: "#FFFFFF",
    haloColor: "#000000",
    haloWidth: 2,
    textOffset: [0, 0.4],
    textFont: ["Open Sans Semibold", "Arial Unicode MS Bold"],
  });
  const distance = parseTextBlock(p.distance_label_block, {
    fontSize: 12,
    fontColor: "#FFFFFF",
    haloColor: "#000000",
    haloWidth: 1.5,
    textOffset: [0, -0.2],
    textFont: ["Open Sans Semibold", "Arial Unicode MS Bold"],
  });
  const angle = parseTextBlock(p.angle_label_block, {
    fontSize: 11,
    fontColor: "#FFFF00",
    haloColor: "#000000",
    haloWidth: 1,
    textOffset: [0, 0],
    textFont: ["Open Sans Semibold", "Arial Unicode MS Bold"],
  });
  return { center, distance, angle };
}

/** 雷达站中心点资产图标 GeoJSON，与 `RADAR_COVERAGE_*` 各层同图叠加 */
export function buildRadarAssetIconGeoJSON(assetList: Asset[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: assetList
      .filter((a) => a.type === "radar" && a.centerIconVisible !== false)
      .map((a) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [a.lng, a.lat] as [number, number] },
        properties: {
          id: a.id,
          assetType: "radar",
          symbolId: getAssetSymbolId(
            "radar",
            a.status,
            a.isVirtual ?? false,
            a.disposition ?? "friendly",
            (a.disposition ?? "friendly") === "friendly" ? a.friendlyMapColor : undefined,
          ),
          symbolOpacity: 1,
        },
      })),
  };
}

export type RadarCoverageVisibility = {
  radarFillVisible: boolean;
  radarLineVisible: boolean;
};

const radarVisDefault: RadarCoverageVisibility = {
  radarFillVisible: true,
  radarLineVisible: true,
};

/**
 * 雷达距离环覆盖 + 雷达中心图标：MapLibre source/layer 生命周期与数据更新（与纯 GeoJSON 构建函数同文件）。
 */
export class RadarCoverageModule {
  private map: maplibregl.Map;
  private beforeId?: string;
  private vis: RadarCoverageVisibility = { ...radarVisDefault };
  private assetDispositionAccent: AssetDispositionIconAccent | null = null;
  private lastAssets: Asset[] | null = null;
  private lastRawAssets: AssetData[] | null = null;

  constructor(map: maplibregl.Map, options?: { insertBeforeLayerId?: string }) {
    this.map = map;
    this.beforeId = options?.insertBeforeLayerId;
  }

  install() {
    const m = this.map;
    const b = this.beforeId;

    if (!m.getSource(RADAR_COVERAGE_SOURCE)) {
      m.addSource(RADAR_COVERAGE_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
    if (!m.getLayer(RADAR_BAND_FILL)) {
      m.addLayer(
        {
          id: RADAR_BAND_FILL,
          type: "fill",
          source: RADAR_COVERAGE_SOURCE,
          filter: ["==", ["get", "kind"], "ring-band"],
          paint: {
            "fill-color": ["get", "fillColor"],
            "fill-opacity": 1,
          },
        },
        b,
      );
    }
    if (!m.getLayer(RADAR_RING_LINE)) {
      m.addLayer(
        {
          id: RADAR_RING_LINE,
          type: "line",
          source: RADAR_COVERAGE_SOURCE,
          filter: ["==", ["get", "kind"], "ring-line"],
          paint: {
            "line-color": ["get", "ringLineColor"],
            "line-width": ["get", "ringLineWidth"],
            "line-opacity": ["get", "ringLineOpacity"],
          },
        },
        b,
      );
    }
    if (!m.getLayer(RADAR_CROSSHAIR)) {
      m.addLayer(
        {
          id: RADAR_CROSSHAIR,
          type: "line",
          source: RADAR_COVERAGE_SOURCE,
          filter: ["==", ["get", "kind"], "crosshair"],
          paint: {
            "line-color": ["get", "lineColor"],
            "line-width": ["get", "lineWidth"],
            "line-opacity": ["get", "lineOpacity"],
            "line-dasharray": [4, 4],
          },
        },
        b,
      );
    }
    if (!m.getLayer(RADAR_DIST_LABEL)) {
      m.addLayer(
        {
          id: RADAR_DIST_LABEL,
          type: "symbol",
          source: RADAR_COVERAGE_SOURCE,
          filter: ["==", ["get", "kind"], "dist-label"],
          layout: {
            "text-field": ["get", "labelText"],
            "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
            "text-size": ["get", "fontSize"],
            "text-anchor": "bottom",
            "text-offset": [0, -0.2],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: {
            "text-color": ["get", "fontColor"],
            "text-halo-color": ["get", "haloColor"],
            "text-halo-width": ["get", "haloWidth"],
          },
        },
        b,
      );
    }
    if (!m.getLayer(RADAR_ANGLE_LABEL)) {
      m.addLayer(
        {
          id: RADAR_ANGLE_LABEL,
          type: "symbol",
          source: RADAR_COVERAGE_SOURCE,
          filter: ["==", ["get", "kind"], "angle-label"],
          layout: {
            "text-field": ["get", "labelText"],
            "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
            "text-size": ["get", "fontSize"],
            "text-anchor": "center",
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: {
            "text-color": ["get", "fontColor"],
            "text-halo-color": ["get", "haloColor"],
            "text-halo-width": ["get", "haloWidth"],
          },
        },
        b,
      );
    }
    if (!m.getLayer(RADAR_CENTER_NAME)) {
      m.addLayer(
        {
          id: RADAR_CENTER_NAME,
          type: "symbol",
          source: RADAR_COVERAGE_SOURCE,
          filter: ["==", ["get", "kind"], "radar-name"],
          layout: {
            "text-field": ["get", "labelText"],
            "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
            "text-size": ["get", "fontSize"],
            "text-anchor": "top",
            "text-offset": [0, 0.4],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: {
            "text-color": ["get", "fontColor"],
            "text-halo-color": ["get", "haloColor"],
            "text-halo-width": ["get", "haloWidth"],
          },
        },
        b,
      );
    }

    if (!m.getSource(RADAR_ASSET_ICON_SOURCE)) {
      m.addSource(RADAR_ASSET_ICON_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
    const sensorIconLayout: maplibregl.SymbolLayerSpecification["layout"] = {
      "icon-image": ["get", "symbolId"],
      "icon-size": MAPLIBRE_ASSET_CENTER_ICON_SIZE,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-rotation-alignment": "viewport",
      "icon-pitch-alignment": "viewport",
    };
    const sensorIconPaint: maplibregl.SymbolLayerSpecification["paint"] = {
      "icon-opacity": ["coalesce", ["get", "symbolOpacity"], 1],
    };
    if (!m.getLayer(RADAR_ASSET_ICON_LAYER)) {
      m.addLayer(
        {
          id: RADAR_ASSET_ICON_LAYER,
          type: "symbol",
          source: RADAR_ASSET_ICON_SOURCE,
          layout: sensorIconLayout,
          paint: sensorIconPaint,
        },
        b,
      );
    }

    this.applyVisibility();
  }

  setLayerVisibility(partial: Partial<RadarCoverageVisibility>) {
    this.vis = { ...this.vis, ...partial };
    this.applyVisibility();
  }

  private applyVisibility() {
    const m = this.map;
    const setVis = (id: string, show: boolean) => {
      if (!m.getLayer(id)) return;
      m.setLayoutProperty(id, "visibility", show ? "visible" : "none");
    };
    setVis(RADAR_BAND_FILL, this.vis.radarFillVisible);
    for (const id of [RADAR_RING_LINE, RADAR_CROSSHAIR, RADAR_DIST_LABEL, RADAR_ANGLE_LABEL, RADAR_CENTER_NAME]) {
      setVis(id, this.vis.radarLineVisible);
    }
    setVis(RADAR_ASSET_ICON_LAYER, this.vis.radarLineVisible);
  }

  setAssetDispositionAccent(accent: AssetDispositionIconAccent | null) {
    this.assetDispositionAccent = accent;
    const m = this.map;
    const rc = m.getSource(RADAR_COVERAGE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (rc && this.lastRawAssets) {
      rc.setData(buildRadarCoverageGeoJSON(this.lastRawAssets, accent) as GeoJSON.FeatureCollection);
    }
    this.refreshRadarIcons();
  }

  private refreshRadarIcons() {
    const m = this.map;
    const assets = this.lastAssets;
    if (!assets) return;
    const rs = m.getSource(RADAR_ASSET_ICON_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (rs) rs.setData(buildRadarAssetIconGeoJSON(assets) as GeoJSON.FeatureCollection);
  }

  setFromAssets(assets: Asset[], rawAssets: AssetData[]) {
    this.lastAssets = assets;
    this.lastRawAssets = rawAssets;
    const m = this.map;
    const radarRows = rawAssets.filter((a) => String(a.asset_type ?? "").toLowerCase() === "radar");
    const typ = pickRadarTypographyFromRows(radarRows);
    for (const [layerId, t] of [
      [RADAR_DIST_LABEL, typ.distance] as const,
      [RADAR_ANGLE_LABEL, typ.angle] as const,
      [RADAR_CENTER_NAME, typ.center] as const,
    ]) {
      if (!m.getLayer(layerId)) continue;
      m.setLayoutProperty(layerId, "text-font", t.textFont as string[]);
      m.setLayoutProperty(layerId, "text-offset", t.textOffset as [number, number]);
    }

    const p0 = radarRows[0]?.properties as Record<string, unknown> | undefined;
    const firstDash = p0?.ring_line_dash;
    const dash = Array.isArray(firstDash)
      ? (firstDash as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n))
      : [];
    if (m.getLayer(RADAR_RING_LINE)) {
      if (dash.length >= 2) {
        m.setPaintProperty(RADAR_RING_LINE, "line-dasharray", dash as [number, number]);
      } else {
        const rm = m as maplibregl.Map & { removePaintProperty?: (id: string, prop: string) => void };
        rm.removePaintProperty?.(RADAR_RING_LINE, "line-dasharray");
      }
    }

    const ch = p0?.crosshair_block as Record<string, unknown> | undefined;
    const chDash = ch && Array.isArray(ch.lineDash)
      ? (ch.lineDash as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n))
      : [4, 4];
    if (m.getLayer(RADAR_CROSSHAIR) && chDash.length >= 2) {
      m.setPaintProperty(RADAR_CROSSHAIR, "line-dasharray", chDash as [number, number]);
    }

    const rc = m.getSource(RADAR_COVERAGE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (rc) rc.setData(buildRadarCoverageGeoJSON(rawAssets, this.assetDispositionAccent) as GeoJSON.FeatureCollection);
    this.refreshRadarIcons();
  }

  dispose() {
    const m = this.map;
    for (const id of [RADAR_ASSET_ICON_LAYER, ...[...RADAR_COVERAGE_LAYER_IDS].reverse()]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource(RADAR_ASSET_ICON_SOURCE)) m.removeSource(RADAR_ASSET_ICON_SOURCE);
    if (m.getSource(RADAR_COVERAGE_SOURCE)) m.removeSource(RADAR_COVERAGE_SOURCE);
  }
}
