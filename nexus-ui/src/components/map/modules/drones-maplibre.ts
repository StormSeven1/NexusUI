import type maplibregl from "maplibre-gl";
import { parseMapAssetTypeStrict, type Asset } from "@/lib/map-entity-model";
import type { AssetData } from "@/stores/asset-store";
import { parseForceDisposition } from "@/lib/theme-colors";
import { mergeRootAndDeviceVisible } from "@/lib/utils";
import type { AssetDispositionIconAccent, AssetStatus } from "@/lib/map-icons";
import {
  assetMapLabelTextColor,
  buildAssetSymbolDataUrl,
  geoSectorCoords,
  getAssetSymbolId,
  MAP_FRIENDLY_COLOR_PROP,
  MAPLIBRE_ASSET_CENTER_ICON_SIZE,
} from "@/lib/map-icons";
import {
  getDroneMapRenderingConfig,
  laserLabelStyleFromBundle,
  type AppConfigSectorBundle,
} from "@/lib/map-app-config";
import type { DroneTelemetry } from "@/stores/drone-store";
import { useDroneStore } from "@/stores/drone-store";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function rootVisibilityField(vis: Record<string, unknown> | null | undefined, key: string): boolean | undefined {
  if (!vis || !(key in vis)) return undefined;
  return vis[key] !== false;
}

function isoNow() {
  return new Date().toISOString();
}

/** 与 `cameras` / `airports` 同形；仅用于本文件的 `drones.devices` 解析（不依赖光电模块） */
function mapDroneConfigDeviceRow(
  r: Record<string, unknown>,
  defaultRangeM: number,
  dronesVisibility: Record<string, unknown> | null | undefined,
  rootFriendlyLabelColor?: string | null,
): AssetData | null {
  const id = String(r.deviceId ?? "");
  const c = r.center;
  if (!id || !Array.isArray(c) || c.length < 2) return null;
  const lng = Number(c[0]);
  const lat = Number(c[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  const rangeM = Number.isFinite(Number(r.range)) ? Number(r.range) : defaultRangeM;
  const assetType = parseMapAssetTypeStrict(r.assetType, `drones.devices[${id}].assetType`);
  const bearing = Number(r.bearing);
  const heading = Number.isFinite(bearing) ? bearing : 0;
  const fovAngle = Number.isFinite(Number(r.fovAngle)) ? Number(r.fovAngle) : 90;
  const virtualTroop = r.virtualTroop === true;
  const now = isoNow();

  const centerNameVisible = mergeRootAndDeviceVisible(
    rootVisibilityField(dronesVisibility, "centerNameVisible"),
    r.centerNameVisible,
  );
  const centerIconVisible = mergeRootAndDeviceVisible(
    rootVisibilityField(dronesVisibility, "centerIconVisible"),
    r.centerIconVisible,
  );
  const fovSectorVisible = r.showSector !== false;

  const rowLbl = asRecord(r.label);
  const rowFc = typeof rowLbl?.fontColor === "string" && rowLbl.fontColor.trim() ? rowLbl.fontColor.trim() : "";
  const rootFc =
    typeof rootFriendlyLabelColor === "string" && rootFriendlyLabelColor.trim()
      ? rootFriendlyLabelColor.trim()
      : "";
  const mapFriendly = rowFc || rootFc;

  return {
    id,
    name: String(r.name ?? id),
    asset_type: assetType,
    status: String(r.status ?? "online"),
    disposition: parseForceDisposition(r.disposition, "friendly"),
    lat,
    lng,
    range_km: rangeM > 0 ? rangeM / 1000 : null,
    heading,
    fov_angle: Number.isFinite(fovAngle) ? fovAngle : 90,
    properties: {
      ...(asRecord(r.properties as unknown) ?? {}),
      config_kind: "camera",
      is_virtual: virtualTroop,
      virtual_troop: virtualTroop,
      center_name_visible: centerNameVisible,
      center_icon_visible: centerIconVisible,
      fov_sector_visible: fovSectorVisible,
      ...(mapFriendly ? { [MAP_FRIENDLY_COLOR_PROP]: mapFriendly } : {}),
    },
    mission_status: "monitoring",
    assigned_target_id: null,
    target_lat: null,
    target_lng: null,
    created_at: String(r.created_at ?? now),
    updated_at: now,
  };
}

export const DRONES_SOURCE = "nexus-drones-src";
export const DRONES_ROUTE_SOLID = "nexus-drones-route-solid";
export const DRONES_ROUTE_DASH = "nexus-drones-route-dash";
export const DRONES_TRAIL_SOLID = "nexus-drones-trail-solid";
export const DRONES_TRAIL_DASH = "nexus-drones-trail-dash";
export const DRONES_FOV_LAYER = "nexus-drones-fov";
export const DRONES_SYMBOL_LAYER = "nexus-drones-symbol";
export const DRONES_LABEL_LAYER = "nexus-drones-label";
/** 配置 / 资产 store 中的静态 `asset_type: drone` 站址（图标 + 名称），与实时机队 `DRONES_SOURCE` 分离 */
export const DRONES_STATIC_SOURCE = "nexus-drones-static-sites";
export const DRONES_STATIC_SYMBOL_LAYER = "nexus-drones-static-symbol";
export const DRONES_STATIC_LABEL_LAYER = "nexus-drones-static-label";

export const DRONE_MAP_IMAGE_REAL = "nexus-drone-fleet-real";
export const DRONE_MAP_IMAGE_VIRT = "nexus-drone-fleet-virt";

/** 根键 `drones.devices[]` → `AssetData`（与 `cameras` 同形；`assetType` 须为 `drone`） */
export function mapDronesDevicesPayload(dronesRoot: unknown): AssetData[] {
  const root = asRecord(dronesRoot);
  if (!root || !Array.isArray(root.devices)) return [];
  const defM = Number(root.defaultRange) || 15_000;
  const vis = asRecord(root.visibility);
  const rootLbl = asRecord(root.label);
  const rootFriendly =
    typeof rootLbl?.fontColor === "string" && rootLbl.fontColor.trim() ? rootLbl.fontColor.trim() : undefined;
  const out: AssetData[] = [];
  for (const item of root.devices) {
    if (!item || typeof item !== "object") continue;
    const r: Record<string, unknown> = { ...(item as Record<string, unknown>) };
    const raw = r.assetType;
    if (raw == null || String(raw).trim() === "") r.assetType = "drone";
    const t = String(r.assetType).trim().toLowerCase();
    if (t !== "drone") {
      const id = String(r.deviceId ?? "?");
      throw new Error(`drones.devices[${id}].assetType 必须为 drone（当前为 ${t || "空"}）`);
    }
    const a = mapDroneConfigDeviceRow(r, defM, vis, rootFriendly);
    if (a) out.push(a);
  }
  return out;
}

function assetStatusFromLabel(s: string | undefined): AssetStatus {
  const x = String(s ?? "online");
  if (x === "offline" || x === "degraded" || x === "online") return x;
  return "online";
}

/** 静态无人机站点：中心图标 + 名称（数据源与 `nexus-drones-src` 实时机队分离） */
export function buildStaticDroneSitesGeoJSON(
  assetList: Asset[],
  accent: AssetDispositionIconAccent | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const a of assetList) {
    if (a.type !== "drone") continue;
    if (a.centerIconVisible === false) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [a.lng, a.lat] },
      properties: {
        kind: "site",
        id: a.id,
        symbolId: getAssetSymbolId(
          a.type,
          a.status,
          a.isVirtual ?? false,
          a.disposition ?? "friendly",
          (a.disposition ?? "friendly") === "friendly" ? a.friendlyMapColor : undefined,
        ),
        symbolOpacity: 1,
      },
    });
  }
  for (const a of assetList) {
    if (a.type !== "drone") continue;
    if (a.nameLabelVisible === false || !String(a.name ?? "").trim()) continue;
    const disp = a.disposition ?? "friendly";
    const st = assetStatusFromLabel(a.status);
    const friendlyOv = disp === "friendly" ? a.friendlyMapColor : undefined;
    const labelColor = assetMapLabelTextColor(disp, st, accent ?? null, friendlyOv);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [a.lng, a.lat] },
      properties: {
        kind: "lbl",
        id: a.id,
        labelText: a.name,
        labelColor,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function readLatLng(d: Record<string, unknown>): { lat: number; lng: number } | null {
  const lat = Number(d.latitude ?? d.lat);
  const lng = Number(d.longitude ?? d.lng ?? d.lon);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return null;
}

function readHeading(d: Record<string, unknown>): number | null {
  const h = Number(d.heading ?? d.attitude_head ?? d.course ?? d.yaw);
  return Number.isFinite(h) ? h : null;
}

/** 与 V2 `DroneRenderer.calculateCameraRange` 一致 */
function calculateCameraRange(
  altitudeM: number,
  _pitch: number,
  gimbalPitch: number,
  maxRangeM: number,
): number {
  if (!altitudeM || altitudeM <= 0) return maxRangeM;
  const totalPitch = gimbalPitch || 0;
  if (totalPitch >= -10) return maxRangeM;
  const pitchRad = (Math.abs(totalPitch) * Math.PI) / 180;
  const distance = altitudeM / Math.tan(pitchRad);
  return Math.min(Math.max(distance, 100), maxRangeM);
}

function latestPayloadForFov(tele: DroneTelemetry): Record<string, unknown> | null {
  const cfg = getDroneMapRenderingConfig();
  const now = Date.now();
  if (
    tele.highFreq &&
    tele.highFreqReceivedAt != null &&
    now - tele.highFreqReceivedAt < cfg.highFreqPositionMaxAgeMs
  ) {
    return tele.highFreq;
  }
  if (tele.status) return tele.status;
  if (tele.legacy) return tele.legacy;
  return null;
}

function fovFeatureForDrone(tele: DroneTelemetry): GeoJSON.Feature<GeoJSON.Polygon> | null {
  const cfg = getDroneMapRenderingConfig();
  if (!cfg.showFovSector) return null;
  const pose = mergedDronePose(tele);
  if (!pose) return null;
  const raw = latestPayloadForFov(tele);
  if (!raw) return null;

  const height = Number(raw.height ?? raw.altitude ?? raw.alt ?? 0);
  const effectiveAlt = height > 0 ? height : 100;
  const attitudePitch = Number(raw.attitude_pitch ?? (raw.attitude as Record<string, unknown>)?.pitch ?? 0);
  const gimbalPitch = Number(raw.gimbal_pitch ?? (raw.gimbal as Record<string, unknown>)?.pitch ?? 0);
  const rangeM = calculateCameraRange(
    effectiveAlt,
    attitudePitch,
    gimbalPitch,
    cfg.maxFovRange,
  );
  if (rangeM <= 100) return null;

  const gimbalYaw = Number(raw.gimbal_yaw ?? (raw.gimbal as Record<string, unknown>)?.yaw ?? raw.attitude_head ?? 0);
  const bearing = Number.isFinite(gimbalYaw) ? gimbalYaw : pose.headingDeg;
  const ring = geoSectorCoords(pose.lng, pose.lat, rangeM / 1000, bearing, cfg.horizontalFov, 24);
  return {
    type: "Feature",
    properties: { kind: "fov", sn: tele.sn },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

function waypointsLineString(
  task: Record<string, unknown> | null,
  virtualTroop: boolean,
): GeoJSON.Feature<GeoJSON.LineString> | null {
  if (!task) return null;
  const wps = task.waypoints;
  if (!Array.isArray(wps) || wps.length < 2) return null;
  const coords: Array<[number, number]> = [];
  for (const wp of wps) {
    if (!wp || typeof wp !== "object") continue;
    const o = wp as Record<string, unknown>;
    const lng = Number(o.longitude ?? o.lng ?? o.lon);
    const lat = Number(o.latitude ?? o.lat);
    if (Number.isFinite(lng) && Number.isFinite(lat)) coords.push([lng, lat]);
  }
  if (coords.length < 2) return null;
  return {
    type: "Feature",
    properties: { kind: "route", virt: virtualTroop ? 1 : 0 },
    geometry: { type: "LineString", coordinates: coords },
  };
}

function trailLineString(tele: DroneTelemetry): GeoJSON.Feature<GeoJSON.LineString> | null {
  const cfg = getDroneMapRenderingConfig();
  if (!cfg.showHistoryTrail || tele.historyTrail.length < 2) return null;
  return {
    type: "Feature",
    properties: { kind: "trail", sn: tele.sn, virt: tele.virtualTroop ? 1 : 0 },
    geometry: { type: "LineString", coordinates: tele.historyTrail },
  };
}

/** 与 V2 一致：在 `highFreqPositionMaxAgeMs` 内优先高频位置 */
export function mergedDronePose(t: DroneTelemetry): {
  lat: number;
  lng: number;
  headingDeg: number;
} | null {
  const cfg = getDroneMapRenderingConfig();
  const now = Date.now();
  const hf = t.highFreq;
  const st = t.status;
  const leg = t.legacy;

  const hfFresh = t.highFreqReceivedAt != null && now - t.highFreqReceivedAt < cfg.highFreqPositionMaxAgeMs;
  if (hf && hfFresh) {
    const p = readLatLng(hf);
    if (p) {
      const h = readHeading(hf);
      return { ...p, headingDeg: h ?? t.headingDeg ?? 0 };
    }
  }
  if (st) {
    const p = readLatLng(st);
    if (p) {
      const h = readHeading(st);
      return { ...p, headingDeg: h ?? t.headingDeg ?? 0 };
    }
  }
  if (leg) {
    const p = readLatLng(leg);
    if (p) {
      const h = readHeading(leg);
      return { ...p, headingDeg: h ?? t.headingDeg ?? 0 };
    }
  }
  if (t.lat != null && t.lng != null) {
    return { lat: t.lat, lng: t.lng, headingDeg: t.headingDeg ?? 0 };
  }
  return null;
}

function buildDroneGeoJSON(drones: Record<string, DroneTelemetry>): GeoJSON.FeatureCollection {
  const cfg = getDroneMapRenderingConfig();
  const features: GeoJSON.Feature[] = [];
  for (const [, tele] of Object.entries(drones)) {
    const pose = mergedDronePose(tele);
    if (!pose) continue;

    if (cfg.showPlannedRoute) {
      const route = waypointsLineString(tele.flightPath, tele.virtualTroop);
      if (route) features.push(route);
    }
    const trail = trailLineString(tele);
    if (trail) features.push(trail);

    const fov = fovFeatureForDrone(tele);
    if (fov) features.push(fov);

    features.push({
      type: "Feature",
      properties: {
        kind: "marker",
        sn: tele.sn,
        heading: pose.headingDeg,
        virt: tele.virtualTroop ? 1 : 0,
      },
      geometry: { type: "Point", coordinates: [pose.lng, pose.lat] },
    });
    if (cfg.showSnLabel) {
      features.push({
        type: "Feature",
        properties: { kind: "label", sn: tele.sn },
        geometry: { type: "Point", coordinates: [pose.lng, pose.lat] },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/**
 * 无人机：**实时机队**（`useDroneStore` → `nexus-drones-src`）+ **静态站址**（`drones.devices` / 资产 store 中 `type: drone` → `nexus-drones-static-sites`）。
 */
export class DronesMaplibre {
  private map: maplibregl.Map;
  private beforeId?: string;
  private unsub: (() => void) | null = null;
  private timeoutTimer: ReturnType<typeof setInterval> | null = null;

  constructor(map: maplibregl.Map, options?: { insertBeforeLayerId?: string }) {
    this.map = map;
    this.beforeId = options?.insertBeforeLayerId;
  }

  async install(accent: AssetDispositionIconAccent) {
    const m = this.map;
    const b = this.beforeId;
    const cfg0 = getDroneMapRenderingConfig();

    if (!m.getSource(DRONES_SOURCE)) {
      m.addSource(DRONES_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
    const loadDroneImg = async (virtual: boolean, imageId: string) => {
      if (m.hasImage(imageId)) return;
      const fc = getDroneMapRenderingConfig().mapFriendlyColor;
      const url = await buildAssetSymbolDataUrl("drone", "online", virtual, "friendly", accent, fc);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image(56, 56);
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("drone icon load failed"));
        image.src = url;
      });
      m.addImage(imageId, img, { pixelRatio: 2 });
    };
    await loadDroneImg(false, DRONE_MAP_IMAGE_REAL);
    await loadDroneImg(true, DRONE_MAP_IMAGE_VIRT);

    if (!m.getSource(DRONES_STATIC_SOURCE)) {
      m.addSource(DRONES_STATIC_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
    if (!m.getLayer(DRONES_STATIC_SYMBOL_LAYER)) {
      m.addLayer(
        {
          id: DRONES_STATIC_SYMBOL_LAYER,
          type: "symbol",
          source: DRONES_STATIC_SOURCE,
          filter: ["==", ["get", "kind"], "site"],
          layout: {
            "icon-image": ["get", "symbolId"],
            "icon-size": MAPLIBRE_ASSET_CENTER_ICON_SIZE,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-rotation-alignment": "viewport",
            "icon-pitch-alignment": "viewport",
          },
          paint: { "icon-opacity": ["coalesce", ["get", "symbolOpacity"], 1] },
        },
        b,
      );
    }
    if (!m.getLayer(DRONES_STATIC_LABEL_LAYER)) {
      m.addLayer(
        {
          id: DRONES_STATIC_LABEL_LAYER,
          type: "symbol",
          source: DRONES_STATIC_SOURCE,
          filter: ["==", ["get", "kind"], "lbl"],
          layout: {
            "text-field": ["get", "labelText"],
            "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
            "text-size": 13,
            "text-anchor": "top",
            "text-offset": [0, 1.25],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "text-max-width": 12,
          },
          paint: {
            "text-color": ["coalesce", ["get", "labelColor"], "#e5e5e5"],
            "text-halo-color": "#000000",
            "text-halo-width": 2,
            "text-opacity": 0.95,
          },
        },
        b,
      );
    }

    const addLine = (id: string, filter: maplibregl.FilterSpecification, paint: Record<string, unknown>) => {
      if (m.getLayer(id)) return;
      m.addLayer(
        {
          id,
          type: "line",
          source: DRONES_SOURCE,
          filter,
          layout: { "line-cap": "round", "line-join": "round" },
          paint,
        },
        b,
      );
    };

    const routePaintBase = {
      "line-color": cfg0.routeLineColor,
      "line-width": cfg0.routeLineWidth,
      "line-opacity": cfg0.routeLineOpacity,
    };
    addLine(DRONES_ROUTE_SOLID, ["all", ["==", ["get", "kind"], "route"], ["!=", ["get", "virt"], 1]], routePaintBase);
    addLine(DRONES_ROUTE_DASH, ["all", ["==", ["get", "kind"], "route"], ["==", ["get", "virt"], 1]], {
      ...routePaintBase,
      "line-dasharray": [5, 4],
    });
    const trailPaintBase = {
      "line-color": cfg0.routeLineColor,
      "line-width": Math.max(1, cfg0.routeLineWidth - 0.5),
      "line-opacity": Math.min(1, cfg0.routeLineOpacity * 0.85),
    };
    addLine(DRONES_TRAIL_SOLID, ["all", ["==", ["get", "kind"], "trail"], ["!=", ["get", "virt"], 1]], trailPaintBase);
    addLine(DRONES_TRAIL_DASH, ["all", ["==", ["get", "kind"], "trail"], ["==", ["get", "virt"], 1]], {
      ...trailPaintBase,
      "line-dasharray": [5, 4],
    });

    if (!m.getLayer(DRONES_FOV_LAYER)) {
      m.addLayer(
        {
          id: DRONES_FOV_LAYER,
          type: "fill",
          source: DRONES_SOURCE,
          filter: ["==", ["get", "kind"], "fov"],
          paint: {
            "fill-color": cfg0.fovFillColor,
            "fill-opacity": cfg0.fovFillOpacity,
            "fill-outline-color": cfg0.fovLineColor,
          },
        },
        b,
      );
    }

    if (!m.getLayer(DRONES_SYMBOL_LAYER)) {
      m.addLayer(
        {
          id: DRONES_SYMBOL_LAYER,
          type: "symbol",
          source: DRONES_SOURCE,
          filter: ["==", ["get", "kind"], "marker"],
          layout: {
            "icon-image": [
              "case",
              ["==", ["get", "virt"], 1],
              DRONE_MAP_IMAGE_VIRT,
              DRONE_MAP_IMAGE_REAL,
            ],
            "icon-rotate": ["coalesce", ["get", "heading"], 0],
            "icon-rotation-alignment": "map",
            "icon-pitch-alignment": "map",
            "icon-size": MAPLIBRE_ASSET_CENTER_ICON_SIZE,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        },
        b,
      );
    }
    if (!m.getLayer(DRONES_LABEL_LAYER)) {
      m.addLayer(
        {
          id: DRONES_LABEL_LAYER,
          type: "symbol",
          source: DRONES_SOURCE,
          filter: ["==", ["get", "kind"], "label"],
          layout: {
            "text-field": ["get", "sn"],
            "text-font": ["Open Sans Regular"],
            "text-size": 10,
            "text-offset": [0, 2.1],
            "text-anchor": "top",
          },
          paint: {
            "text-color": "#bae6fd",
            "text-halo-color": "#09090b",
            "text-halo-width": 1.2,
          },
        },
        b,
      );
    }

    this.applyPaintFromConfig();
    this.refreshFromStore();
    this.unsub = useDroneStore.subscribe((s) => {
      if (!m.getSource(DRONES_SOURCE)) return;
      const src = m.getSource(DRONES_SOURCE) as maplibregl.GeoJSONSource;
      src.setData(buildDroneGeoJSON(s.drones));
    });

    this.startTimeoutPrune();
  }

  /** 由 `Map2D` 在资产 store 更新时调用：仅刷新 **`asset_type: drone`** 的配置/WS 合并站址（与 `useDroneStore` 无关） */
  setStaticDroneSitesFromAssets(assets: Asset[], accent: AssetDispositionIconAccent | null) {
    const m = this.map;
    const src = m.getSource(DRONES_STATIC_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(buildStaticDroneSitesGeoJSON(assets, accent) as GeoJSON.FeatureCollection);
  }

  /**
   * 根键 **`drones.label`**（与 `cameras` / `laserWeapons` 同形）→ MapLibre：**静态站名**（`nexus-drones-static-label`）的字号/字形/偏移/描边；
   * **实时机队 SN 标签**（`nexus-drones-label`）同步字形与 **`text-color`**（字色仍可由本块 **`fontColor`** 统一）。
   */
  applyDronesSectorLabelStyle(bundle: AppConfigSectorBundle | null) {
    const m = this.map;
    const L = laserLabelStyleFromBundle(bundle);
    for (const lid of [DRONES_STATIC_LABEL_LAYER, DRONES_LABEL_LAYER]) {
      if (!m.getLayer(lid)) continue;
      try {
        m.setLayoutProperty(lid, "text-font", L.textFont as string[]);
        m.setLayoutProperty(lid, "text-size", L.fontSize);
        m.setLayoutProperty(lid, "text-offset", L.textOffset as [number, number]);
        m.setPaintProperty(lid, "text-halo-color", L.haloColor);
        m.setPaintProperty(lid, "text-halo-width", L.haloWidth);
      } catch {
        /* ignore */
      }
    }
    try {
      if (m.getLayer(DRONES_LABEL_LAYER)) {
        m.setPaintProperty(DRONES_LABEL_LAYER, "text-color", L.textColor);
      }
    } catch {
      /* ignore */
    }
  }

  private startTimeoutPrune() {
    if (this.timeoutTimer) clearInterval(this.timeoutTimer);
    const tickMs = Math.max(500, getDroneMapRenderingConfig().timeoutCheckIntervalMs);
    this.timeoutTimer = setInterval(() => {
      const cfg = getDroneMapRenderingConfig();
      const lim = Math.max(1, cfg.timeoutSeconds) * 1000;
      const now = Date.now();
      const state = useDroneStore.getState();
      for (const sn of Object.keys(state.drones)) {
        const d = state.drones[sn];
        if (d && now - d.lastPacketAtMs > lim) {
          state.removeDrone(sn);
        }
      }
    }, tickMs);
  }

  /** 配置热读：刷新线/FOV 颜色（不改变图层 id） */
  applyPaintFromConfig() {
    const m = this.map;
    const cfg = getDroneMapRenderingConfig();
    for (const lid of [DRONES_ROUTE_SOLID, DRONES_ROUTE_DASH]) {
      if (m.getLayer(lid)) {
        m.setPaintProperty(lid, "line-color", cfg.routeLineColor);
        m.setPaintProperty(lid, "line-width", cfg.routeLineWidth);
        m.setPaintProperty(lid, "line-opacity", cfg.routeLineOpacity);
      }
    }
    for (const lid of [DRONES_TRAIL_SOLID, DRONES_TRAIL_DASH]) {
      if (m.getLayer(lid)) {
        m.setPaintProperty(lid, "line-color", cfg.routeLineColor);
        m.setPaintProperty(lid, "line-width", Math.max(1, cfg.routeLineWidth - 0.5));
        m.setPaintProperty(lid, "line-opacity", Math.min(1, cfg.routeLineOpacity * 0.85));
      }
    }
    if (m.getLayer(DRONES_FOV_LAYER)) {
      m.setPaintProperty(DRONES_FOV_LAYER, "fill-color", cfg.fovFillColor);
      m.setPaintProperty(DRONES_FOV_LAYER, "fill-opacity", cfg.fovFillOpacity);
      m.setPaintProperty(DRONES_FOV_LAYER, "fill-outline-color", cfg.fovLineColor);
    }
    if (m.getLayer(DRONES_LABEL_LAYER)) {
      m.setLayoutProperty(DRONES_LABEL_LAYER, "visibility", cfg.showSnLabel ? "visible" : "none");
    }
    for (const lid of [DRONES_ROUTE_SOLID, DRONES_ROUTE_DASH]) {
      if (m.getLayer(lid)) m.setLayoutProperty(lid, "visibility", cfg.showPlannedRoute ? "visible" : "none");
    }
    for (const lid of [DRONES_TRAIL_SOLID, DRONES_TRAIL_DASH]) {
      if (m.getLayer(lid)) m.setLayoutProperty(lid, "visibility", cfg.showHistoryTrail ? "visible" : "none");
    }
    if (m.getLayer(DRONES_FOV_LAYER)) {
      m.setLayoutProperty(DRONES_FOV_LAYER, "visibility", cfg.showFovSector ? "visible" : "none");
    }
  }

  refreshFromStore() {
    const m = this.map;
    const src = m.getSource(DRONES_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(buildDroneGeoJSON(useDroneStore.getState().drones));
  }

  dispose() {
    if (this.timeoutTimer) {
      clearInterval(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    this.unsub?.();
    this.unsub = null;
    const m = this.map;
    for (const id of [
      DRONES_LABEL_LAYER,
      DRONES_SYMBOL_LAYER,
      DRONES_FOV_LAYER,
      DRONES_TRAIL_DASH,
      DRONES_TRAIL_SOLID,
      DRONES_ROUTE_DASH,
      DRONES_ROUTE_SOLID,
      DRONES_STATIC_LABEL_LAYER,
      DRONES_STATIC_SYMBOL_LAYER,
    ]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource(DRONES_SOURCE)) m.removeSource(DRONES_SOURCE);
    if (m.getSource(DRONES_STATIC_SOURCE)) m.removeSource(DRONES_STATIC_SOURCE);
    if (m.hasImage(DRONE_MAP_IMAGE_REAL)) m.removeImage(DRONE_MAP_IMAGE_REAL);
    if (m.hasImage(DRONE_MAP_IMAGE_VIRT)) m.removeImage(DRONE_MAP_IMAGE_VIRT);
  }
}
