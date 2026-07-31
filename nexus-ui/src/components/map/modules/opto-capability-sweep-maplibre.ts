/**
 * 光电「能力」扫描：按 entity `visibleP` 分段距离旋转实心扇形，10s 一周。
 * 视场角取 `sensorParameters.fieldOfView.horizontal.max`（camServer 按 maxZ 标定表 zoom=1 的 maxhs）。
 * 独立 MapLibre source，由图层面板「能力」子节点控制。
 */
import type maplibregl from "maplibre-gl";
import type { AssetData } from "@/stores/asset-store";
import { formatCapabilityRangeM, geoCircleCoords, geoSectorCoords, sweepPhaseOffsetDeg } from "@/lib/map-icons";
import {
  shouldRenderOptoCameraCapability,
  type OptoDeviceVisibilityMap,
} from "@/lib/opto-device-layer-visibility";
import { canonicalEntityId } from "@/lib/camera-entity-id";
import { cameraIndexFromOwnerEntityId, maxZoomForCameraIndex } from "@/lib/camera-management-client";
import {
  isThirdPartyCameraEntityId,
  normThirdPartyEntityId,
} from "@/lib/eo-video/thirdPartyEntityId";

export const OPTO_CAP_SWEEP_SOURCE = "opto-cap-sweep-source";
export const OPTO_CAP_SWEEP_FILL = "opto-cap-sweep-fill";
export const OPTO_CAP_SWEEP_EDGE = "opto-cap-sweep-edge";
export const OPTO_CAP_SWEEP_OUTER = "opto-cap-sweep-outer";
export const OPTO_CAP_SWEEP_LABEL = "opto-cap-sweep-label";

const OPTO_CAP_CYCLE_MS = 10_000;
const OPTO_CAP_TICK_MS = 40;
/** 无 fieldOfView.horizontal.max / maxZ 兜底时的视场（度） */
const OPTO_CAP_FOV_FALLBACK_DEG = 30;
const OPTO_CAP_FILL_OPACITY = 0.28;
const OPTO_CAP_EDGE_OPACITY = 0.75;
/** 能力扫描固定黄色 */
export const OPTO_CAP_SWEEP_COLOR = "#eab308";

export type VisiblePSegment = {
  start: number;
  end: number;
  distanceM: number;
};

export type OptoCapSweepStation = {
  id: string;
  lng: number;
  lat: number;
  color: string;
  /** 视场开角（度）：优先 fieldOfView.horizontal.max（maxZ 标定最广角） */
  fovDeg: number;
  segments: VisiblePSegment[];
  /** 无分段命中时的兜底半径（公里） */
  fallbackRadiusKm: number;
  /** 相对全局时钟的起始相位（度），避免与其它站/雷达前缘对齐 */
  phaseOffsetDeg: number;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function normDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}

function resolveSensorParameters(props: Record<string, unknown>): Record<string, unknown> | null {
  const nested = asRecord(props.properties);
  return (
    asRecord(props.sensorParameters) ??
    asRecord(nested?.sensorParameters) ??
    (props.fieldOfView != null || props.capabilities != null ? props : null)
  );
}

/** `sensorParameters.capabilities.visibleP` → 分段列表（兼容摊平/嵌套） */
export function parseVisiblePSegments(props: unknown): VisiblePSegment[] {
  const p = asRecord(props);
  if (!p) return [];
  const nestedProps = asRecord(p.properties);
  const sp = resolveSensorParameters(p) ?? asRecord(p);
  const cap =
    asRecord(sp?.capabilities) ??
    asRecord(p.capabilities) ??
    asRecord(nestedProps?.capabilities);
  const raw =
    cap?.visibleP ??
    cap?.visible_p ??
    p.visibleP ??
    p.visible_p ??
    nestedProps?.visibleP ??
    nestedProps?.visible_p;
  if (!Array.isArray(raw)) return [];
  const out: VisiblePSegment[] = [];
  for (const item of raw) {
    const o = asRecord(item);
    if (!o) continue;
    const start = Number(o.start);
    const end = Number(o.end);
    const distanceM = Number(o.distance ?? o.dis ?? o.distanceM);
    if (![start, end, distanceM].every((n) => Number.isFinite(n)) || distanceM <= 0) continue;
    out.push({ start, end, distanceM });
  }
  return out;
}

/**
 * 视场开角：优先 `fieldOfView.horizontal.max`（camServer ProcessCameraState 里 HVPTZ[1]=maxhs，与 maxZ 标定对应），
 * 否则按相机序号 `GetMaxZ` 数值作度，再兜底 30°。
 */
export function parseOptoCapFovDeg(props: unknown, entityId: string): number {
  const p = asRecord(props);
  if (p) {
    const sp = resolveSensorParameters(p);
    const fov = asRecord(sp?.fieldOfView) ?? asRecord(p.fieldOfView);
    const horizontal = asRecord(fov?.horizontal);
    const maxHs = Number(horizontal?.max ?? horizontal?.maxHorizontalView);
    if (Number.isFinite(maxHs) && maxHs > 0.1 && maxHs < 180) return maxHs;
  }
  const camIdx = cameraIndexFromOwnerEntityId(entityId);
  if (camIdx != null && Number.isFinite(camIdx) && camIdx >= 0) {
    const mz = maxZoomForCameraIndex(camIdx);
    if (Number.isFinite(mz) && mz > 0.1 && mz < 180) return mz;
  }
  return OPTO_CAP_FOV_FALLBACK_DEG;
}

/** 方位角落在哪一段（含跨 0°）；无命中时用 fallback（visibleP 常有方位空隙） */
export function distanceMAtBearing(segments: readonly VisiblePSegment[], bearingDeg: number, fallbackM: number): number {
  if (segments.length === 0) return fallbackM;
  const b = normDeg(bearingDeg);
  for (const s of segments) {
    const start = normDeg(s.start);
    const end = normDeg(s.end);
    if (start === end) continue;
    if (start < end) {
      if (b >= start && b < end) return s.distanceM;
    } else if (b >= start || b < end) {
      return s.distanceM;
    }
  }
  return fallbackM > 0 ? fallbackM : Math.max(...segments.map((s) => s.distanceM), 0);
}

export function collectOptoCapSweepStations(
  rows: AssetData[],
  perDevice: Readonly<OptoDeviceVisibilityMap>,
  panelCameraIds: ReadonlySet<string> | null,
  excludeFromOptoFovIds?: ReadonlySet<string> | null,
): OptoCapSweepStation[] {
  const out: OptoCapSweepStation[] = [];
  for (const row of rows) {
    if (String(row.asset_type ?? "").toLowerCase() !== "camera") continue;
    const id = canonicalEntityId(row.id);
    if (
      isThirdPartyCameraEntityId(id) &&
      excludeFromOptoFovIds?.has(normThirdPartyEntityId(id))
    ) {
      continue;
    }
    if (!shouldRenderOptoCameraCapability(id, perDevice, panelCameraIds)) continue;
    if (!Number.isFinite(row.lng) || !Number.isFinite(row.lat)) continue;
    if (row.lng === 0 && row.lat === 0) continue;

    const p = (row.properties ?? {}) as Record<string, unknown>;
    let segments = parseVisiblePSegments(p);
    if (segments.length === 0) {
      segments = parseVisiblePSegments({
        sensorParameters: p.sensorParameters,
        capabilities: p.capabilities,
        visibleP: p.visibleP,
        properties: p,
      });
    }
    const sp = resolveSensorParameters(p);
    const cap = asRecord(sp?.capabilities);
    const visM = Number(cap?.visibility ?? p.visibility);
    const fromRange =
      Number.isFinite(Number(row.range_km)) && Number(row.range_km) > 0
        ? Number(row.range_km) * 1000
        : NaN;
    const fallbackM =
      Number.isFinite(fromRange) && fromRange > 0
        ? fromRange
        : Number.isFinite(visM) && visM > 0
          ? visM
          : 5000;
    const fallbackRadiusKm = fallbackM / 1000;
    if (segments.length === 0 && !(fallbackRadiusKm > 0)) continue;

    out.push({
      id,
      lng: row.lng,
      lat: row.lat,
      color: OPTO_CAP_SWEEP_COLOR,
      fovDeg: parseOptoCapFovDeg(p, id),
      segments,
      fallbackRadiusKm,
      phaseOffsetDeg: sweepPhaseOffsetDeg(id),
    });
  }
  return out;
}

/** 外接圆半径：visibleP 各段最大距离，否则兜底半径 */
function optoCapOuterRadiusKm(st: OptoCapSweepStation): number {
  if (st.segments.length > 0) {
    const maxM = Math.max(...st.segments.map((s) => s.distanceM));
    if (Number.isFinite(maxM) && maxM > 0) return maxM / 1000;
  }
  return st.fallbackRadiusKm;
}

/** 实心扇形（无渐变）+ 外接圆：中心朝向 leadingDeg，开角 fovDeg，半径取朝向处 visibleP */
export function buildOptoCapSweepGeoJSON(
  stations: readonly OptoCapSweepStation[],
  leadingDeg: number,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const st of stations) {
    const leading = leadingDeg + (st.phaseOffsetDeg || 0);
    const outerKm = optoCapOuterRadiusKm(st);
    if (outerKm > 0) {
      const outer = geoCircleCoords(st.lng, st.lat, outerKm, 72);
      if (outer.length >= 4) {
        features.push({
          type: "Feature",
          properties: {
            kind: "cap-sweep-outer",
            cameraId: st.id,
            lineColor: st.color,
            lineOpacity: 0.55,
            lineWidth: 1.5,
          },
          geometry: {
            type: "LineString",
            coordinates: outer.map(([x, y]) => [x, y] as GeoJSON.Position),
          },
        });
      }
    }

    const fovDeg = Math.min(179, Math.max(0.5, st.fovDeg));
    const fallbackM = st.fallbackRadiusKm * 1000;
    const radiusM = distanceMAtBearing(st.segments, leading, fallbackM);
    const radiusKm = radiusM / 1000;
    if (!(radiusKm > 0)) continue;

    const segs = Math.max(8, Math.ceil(fovDeg / 2));
    const ring = geoSectorCoords(st.lng, st.lat, radiusKm, leading, fovDeg, segs);
    if (ring.length < 4) continue;
    features.push({
      type: "Feature",
      properties: {
        kind: "cap-sweep-band",
        cameraId: st.id,
        fillColor: st.color,
        fillOpacity: OPTO_CAP_FILL_OPACITY,
      },
      geometry: { type: "Polygon", coordinates: [ring] },
    });

    /* 扇区两侧边线，便于辨认前缘 */
    const half = fovDeg / 2;
    for (const sideHeading of [leading - half, leading + half]) {
      const sideRing = geoSectorCoords(st.lng, st.lat, radiusKm, sideHeading, 0.05, 2);
      const tip = (sideRing[1] ?? [st.lng, st.lat]) as [number, number];
      features.push({
        type: "Feature",
        properties: {
          kind: "cap-sweep-edge",
          cameraId: st.id,
          lineColor: st.color,
          lineOpacity: OPTO_CAP_EDGE_OPACITY,
          lineWidth: 1.25,
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [st.lng, st.lat],
            tip,
          ],
        },
      });
    }

    /* 扫描朝向终点：能力距离（海里） */
    const midRing = geoSectorCoords(st.lng, st.lat, radiusKm, leading, 0.05, 2);
    const midTip = (midRing[1] ?? [st.lng, st.lat]) as [number, number];
    const rangeLabel = formatCapabilityRangeM(radiusKm);
    if (rangeLabel) {
      features.push({
        type: "Feature",
        properties: {
          kind: "cap-sweep-label",
          cameraId: st.id,
          labelText: rangeLabel,
          fontColor: st.color,
          haloColor: "#09090b",
          haloWidth: 1.5,
          fontSize: 11,
        },
        geometry: { type: "Point", coordinates: midTip },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

export class OptoCapabilitySweepModule {
  private map: maplibregl.Map;
  private beforeId?: string;
  private stations: OptoCapSweepStation[] = [];
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private lastRaw: AssetData[] | null = null;
  private perDevice: OptoDeviceVisibilityMap = {};
  private panelIds: ReadonlySet<string> | null = null;
  private excludeIds: ReadonlySet<string> = new Set();

  constructor(map: maplibregl.Map, options?: { insertBeforeLayerId?: string }) {
    this.map = map;
    this.beforeId = options?.insertBeforeLayerId;
  }

  install() {
    const m = this.map;
    const b = this.beforeId;
    if (!m.getSource(OPTO_CAP_SWEEP_SOURCE)) {
      m.addSource(OPTO_CAP_SWEEP_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }
    if (!m.getLayer(OPTO_CAP_SWEEP_FILL)) {
      m.addLayer(
        {
          id: OPTO_CAP_SWEEP_FILL,
          type: "fill",
          source: OPTO_CAP_SWEEP_SOURCE,
          filter: ["==", ["get", "kind"], "cap-sweep-band"],
          paint: {
            "fill-color": ["get", "fillColor"],
            "fill-opacity": ["get", "fillOpacity"],
          },
        },
        b,
      );
    }
    if (!m.getLayer(OPTO_CAP_SWEEP_EDGE)) {
      m.addLayer(
        {
          id: OPTO_CAP_SWEEP_EDGE,
          type: "line",
          source: OPTO_CAP_SWEEP_SOURCE,
          filter: ["==", ["get", "kind"], "cap-sweep-edge"],
          paint: {
            "line-color": ["get", "lineColor"],
            "line-opacity": ["get", "lineOpacity"],
            "line-width": ["get", "lineWidth"],
          },
        },
        b,
      );
    }
    if (!m.getLayer(OPTO_CAP_SWEEP_OUTER)) {
      m.addLayer(
        {
          id: OPTO_CAP_SWEEP_OUTER,
          type: "line",
          source: OPTO_CAP_SWEEP_SOURCE,
          filter: ["==", ["get", "kind"], "cap-sweep-outer"],
          paint: {
            "line-color": ["get", "lineColor"],
            "line-opacity": ["get", "lineOpacity"],
            "line-width": ["get", "lineWidth"],
            "line-dasharray": [2, 2],
          },
        },
        b,
      );
    }
    if (!m.getLayer(OPTO_CAP_SWEEP_LABEL)) {
      m.addLayer(
        {
          id: OPTO_CAP_SWEEP_LABEL,
          type: "symbol",
          source: OPTO_CAP_SWEEP_SOURCE,
          filter: ["==", ["get", "kind"], "cap-sweep-label"],
          layout: {
            "text-field": ["get", "labelText"],
            "text-font": ["Open Sans Regular"],
            "text-size": ["coalesce", ["get", "fontSize"], 11],
            "text-anchor": "left",
            "text-offset": [0.6, 0],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: {
            "text-color": ["coalesce", ["get", "fontColor"], OPTO_CAP_SWEEP_COLOR],
            "text-halo-color": ["coalesce", ["get", "haloColor"], "#09090b"],
            "text-halo-width": ["coalesce", ["get", "haloWidth"], 1.5],
          },
        },
        b,
      );
    }
  }

  setPerDeviceVisibility(
    map: Readonly<OptoDeviceVisibilityMap>,
    panelCameraIds?: ReadonlySet<string> | null,
  ) {
    this.perDevice = { ...map };
    if (panelCameraIds !== undefined) this.panelIds = panelCameraIds;
    this.refreshStations();
  }

  setExcludeFromOptoFovIds(ids: ReadonlySet<string>) {
    this.excludeIds = ids;
    this.refreshStations();
  }

  setFromRawAssets(rows: AssetData[]) {
    this.lastRaw = rows;
    this.refreshStations();
  }

  private refreshStations() {
    this.stations = this.lastRaw
      ? collectOptoCapSweepStations(this.lastRaw, this.perDevice, this.panelIds, this.excludeIds)
      : [];
    this.flush();
    this.syncTimer();
  }

  private flush() {
    const src = this.map.getSource(OPTO_CAP_SWEEP_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (this.stations.length === 0) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const leading = ((Date.now() % OPTO_CAP_CYCLE_MS) / OPTO_CAP_CYCLE_MS) * 360;
    src.setData(buildOptoCapSweepGeoJSON(this.stations, leading));
  }

  private syncTimer() {
    if (this.stations.length === 0) {
      if (this.scanTimer != null) {
        clearInterval(this.scanTimer);
        this.scanTimer = null;
      }
      const src = this.map.getSource(OPTO_CAP_SWEEP_SOURCE) as maplibregl.GeoJSONSource | undefined;
      src?.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    if (this.scanTimer != null) return;
    this.flush();
    this.scanTimer = setInterval(() => this.flush(), OPTO_CAP_TICK_MS);
  }

  dispose() {
    if (this.scanTimer != null) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    const m = this.map;
    for (const id of [OPTO_CAP_SWEEP_LABEL, OPTO_CAP_SWEEP_OUTER, OPTO_CAP_SWEEP_EDGE, OPTO_CAP_SWEEP_FILL]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource(OPTO_CAP_SWEEP_SOURCE)) m.removeSource(OPTO_CAP_SWEEP_SOURCE);
  }
}
