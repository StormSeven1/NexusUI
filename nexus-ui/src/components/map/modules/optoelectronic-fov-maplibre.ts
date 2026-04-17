import type maplibregl from "maplibre-gl";
import { parseMapAssetTypeStrict, type Asset } from "@/lib/map-entity-model";
import type { AssetData } from "@/stores/asset-store";
import { parseForceDisposition } from "@/lib/theme-colors";
import { mergeRootAndDeviceVisible } from "@/lib/utils";
import type { AssetDispositionIconAccent, AssetStatus } from "@/lib/map-icons";
import {
  assetMapLabelTextColor,
  geoCircleCoords,
  geoSectorCoords,
  getAssetSymbolId,
  MAP_FRIENDLY_COLOR_PROP,
  MAPLIBRE_ASSET_CENTER_ICON_SIZE,
} from "@/lib/map-icons";
import type { AppConfigSectorBundle } from "@/lib/map-app-config";
import { laserLabelStyleFromBundle, laserSectorBorderFromBundle, sectorBundleAnyMergedVisible } from "@/lib/map-app-config";

/**
 * 光电 FOV：GeoJSON 构建、`FOV_*` 常量、`OptoelectronicFovModule`，以及本文件内的 **`cameras.devices[]` → `AssetData`**（供 `map-app-config` 合并资产底数）。
 * **`airports`** 解析与地图图层见 **`airport-maplibre.ts`**；**无人机**见 **`drones-maplibre.ts`**。
 */

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

/** `cameras.devices[]` / `airports.devices[]` 与 cameras 同形的一行 → `AssetData` */
function mapCameraDeviceRow(
  r: Record<string, unknown>,
  defaultRangeM: number,
  camerasVisibility: Record<string, unknown> | null | undefined,
  rootFriendlyLabelColor?: string | null,
): AssetData | null {
  const id = String(r.deviceId ?? "");
  const c = r.center;
  if (!id || !Array.isArray(c) || c.length < 2) return null;
  const lng = Number(c[0]);
  const lat = Number(c[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  const rangeM = Number.isFinite(Number(r.range)) ? Number(r.range) : defaultRangeM;
  const assetType = parseMapAssetTypeStrict(r.assetType, `devices[${id}].assetType`);
  const bearing = Number(r.bearing);
  const heading = Number.isFinite(bearing) ? bearing : 0;
  const fovAngle = Number.isFinite(Number(r.fovAngle)) ? Number(r.fovAngle) : 90;
  const virtualTroop = r.virtualTroop === true;
  const now = isoNow();

  const centerNameVisible = mergeRootAndDeviceVisible(
    rootVisibilityField(camerasVisibility, "centerNameVisible"),
    r.centerNameVisible,
  );
  const centerIconVisible = mergeRootAndDeviceVisible(
    rootVisibilityField(camerasVisibility, "centerIconVisible"),
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

/** 根键 `cameras` → 静态光电塔等 `AssetData[]` */
export function mapCamerasDevicesPayload(camerasRoot: unknown): AssetData[] {
  const root = asRecord(camerasRoot);
  if (!root || !Array.isArray(root.devices)) return [];
  const defM = Number(root.defaultRange) || 15_000;
  const vis = asRecord(root.visibility);
  const rootLbl = asRecord(root.label);
  const rootFriendly =
    typeof rootLbl?.fontColor === "string" && rootLbl.fontColor.trim() ? rootLbl.fontColor.trim() : undefined;
  const out: AssetData[] = [];
  for (const item of root.devices) {
    if (!item || typeof item !== "object") continue;
    const a = mapCameraDeviceRow(item as Record<string, unknown>, defM, vis, rootFriendly);
    if (a) out.push(a);
  }
  return out;
}

export const FOV_SOURCE = "fov-source";
export const FOV_FILL = "fov-fill";
export const FOV_LINE = "fov-line";
export const FOV_LABEL = "fov-label";

/** camera / tower 中心图标（机场见 `airport-maplibre.ts`） */
export const OPTO_ASSET_ICON_SOURCE = "opto-asset-icon-src";
export const OPTO_ASSET_ICON_LAYER = "opto-asset-icon";

export const FOV_LAYER_IDS = [FOV_FILL, FOV_LINE, FOV_LABEL] as const;

function assetStatusFromLabel(s: string | undefined): AssetStatus {
  const x = String(s ?? "online");
  if (x === "offline" || x === "degraded" || x === "online") return x;
  return "online";
}

/** 构建 FOV 多边形 + 名称点：geomKind 为 poly | lbl；名称字色与中心图标一致，走 `assetMapLabelTextColor`（含 `factory.assetIcons`） */
export function buildFovGeoJSON(assetList: Asset[], accent?: AssetDispositionIconAccent | null) {
  const polyFeatures = assetList
    .filter(
      (a) =>
        a.showFov !== false &&
        a.range &&
        a.range > 0 &&
        a.type !== "radar" &&
        a.type !== "laser" &&
        a.type !== "tdoa" &&
        a.type !== "airport" &&
        a.type !== "drone",
    )
    .map((a) => {
      const isSector = a.fovAngle !== undefined && a.fovAngle < 360 && a.heading !== undefined;
      const coords = isSector
        ? geoSectorCoords(a.lng, a.lat, a.range!, a.heading!, a.fovAngle!)
        : geoCircleCoords(a.lng, a.lat, a.range!);
      return {
        type: "Feature" as const,
        geometry: { type: "Polygon" as const, coordinates: [coords] },
        properties: {
          geomKind: "poly",
          id: a.id,
          name: a.name,
          status: a.status,
          assetType: a.type,
          isVirtual: a.isVirtual === true ? 1 : 0,
        },
      };
    });

  const labelFeatures: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const a of assetList) {
    if (a.type === "radar" || a.type === "laser" || a.type === "tdoa" || a.type === "drone" || a.type === "airport")
      continue;
    const isCameraLike = a.type === "camera" || a.type === "tower";
    if (isCameraLike) {
      if (a.showFov === false || !a.range || a.range <= 0) continue;
    }
    const showName = a.nameLabelVisible !== false && String(a.name ?? "").trim() !== "";
    if (!showName) continue;
    const disp = a.disposition ?? "friendly";
    const st = assetStatusFromLabel(a.status);
    const friendlyOv = disp === "friendly" ? a.friendlyMapColor : undefined;
    const labelColor = assetMapLabelTextColor(disp, st, accent ?? null, friendlyOv);
    labelFeatures.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [a.lng, a.lat] },
      properties: {
        geomKind: "lbl",
        id: a.id,
        assetType: a.type,
        labelText: a.name,
        labelColor,
      },
    });
  }

  return {
    type: "FeatureCollection" as const,
    features: [...polyFeatures, ...labelFeatures] as GeoJSON.Feature[],
  };
}

/** camera / tower 中心点（**不含** `airport` / `drone`；机场见 `airport-maplibre`，无人机站点见 `drones-maplibre`） */
export function buildOptoAssetIconGeoJSON(assetList: Asset[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: assetList
      .filter(
        (a) =>
          (a.type === "camera" || a.type === "tower") &&
          a.centerIconVisible !== false,
      )
      .map((a) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [a.lng, a.lat] as [number, number] },
        properties: {
          id: a.id,
          assetType: a.type,
          symbolId: getAssetSymbolId(
            a.type,
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

const FOV_LINE_COLOR_BY_ASSET: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "assetType"],
  "camera",
  "#9333ea",
  "tower",
  "#34d399",
  "airport",
  "#94a3b8",
  "drone",
  "#38bdf8",
  "laser",
  "#f97316",
  "tdoa",
  "#06b6d4",
  "#34d399",
];

const FOV_LINE_DASH_BY_VIRTUAL: maplibregl.ExpressionSpecification = [
  "case",
  ["==", ["get", "isVirtual"], 1],
  ["literal", [6, 4]],
  ["literal", [3, 3]],
];

export type OptoelectronicFovVisibility = {
  fovFillVisible: boolean;
  fovLineVisible: boolean;
  fovLabelVisible: boolean;
};

const fovVisDefault: OptoelectronicFovVisibility = {
  fovFillVisible: true,
  fovLineVisible: true,
  fovLabelVisible: true,
};

/**
 * 光电 FOV 扇区 + 光电中心图标：MapLibre 生命周期（与 `buildFovGeoJSON` 等同文件）。
 */
export class OptoelectronicFovModule {
  private map: maplibregl.Map;
  private beforeId?: string;
  private coverageVis: OptoelectronicFovVisibility = { ...fovVisDefault };
  private assetDispositionAccent: AssetDispositionIconAccent | null = null;
  private lastFovAssets: Asset[] | null = null;

  constructor(map: maplibregl.Map, options?: { insertBeforeLayerId?: string }) {
    this.map = map;
    this.beforeId = options?.insertBeforeLayerId;
  }

  install() {
    const m = this.map;
    const b = this.beforeId;

    if (!m.getSource(FOV_SOURCE)) {
      m.addSource(FOV_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
    if (!m.getLayer(FOV_FILL)) {
      m.addLayer(
        {
          id: FOV_FILL,
          type: "fill",
          source: FOV_SOURCE,
          filter: ["==", ["get", "geomKind"], "poly"],
          paint: {
            "fill-color": [
              "match",
              ["get", "assetType"],
              "camera",
              "rgba(147,51,234,0.10)",
              "tower",
              "rgba(52,211,153,0.06)",
              "airport",
              "rgba(148,163,184,0.08)",
              "drone",
              "rgba(56,189,248,0.10)",
              "laser",
              "rgba(249,115,22,0.10)",
              "tdoa",
              "rgba(6,182,212,0.10)",
              "rgba(52,211,153,0.06)",
            ],
          },
        },
        b,
      );
    }
    if (!m.getLayer(FOV_LINE)) {
      m.addLayer(
        {
          id: FOV_LINE,
          type: "line",
          source: FOV_SOURCE,
          filter: ["==", ["get", "geomKind"], "poly"],
          paint: {
            "line-color": [
              "match",
              ["get", "assetType"],
              "camera",
              "#9333ea",
              "tower",
              "#34d399",
              "airport",
              "#94a3b8",
              "drone",
              "#38bdf8",
              "laser",
              "#f97316",
              "tdoa",
              "#06b6d4",
              "#34d399",
            ],
            "line-width": 1.2,
            "line-dasharray": [
              "case",
              ["==", ["get", "isVirtual"], 1],
              ["literal", [6, 4]],
              ["literal", [3, 3]],
            ],
            "line-opacity": 0.4,
          },
        },
        b,
      );
    }
    if (!m.getLayer(FOV_LABEL)) {
      m.addLayer(
        {
          id: FOV_LABEL,
          type: "symbol",
          source: FOV_SOURCE,
          filter: ["==", ["get", "geomKind"], "lbl"],
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

    if (!m.getSource(OPTO_ASSET_ICON_SOURCE)) {
      m.addSource(OPTO_ASSET_ICON_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
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
    if (!m.getLayer(OPTO_ASSET_ICON_LAYER)) {
      m.addLayer(
        {
          id: OPTO_ASSET_ICON_LAYER,
          type: "symbol",
          source: OPTO_ASSET_ICON_SOURCE,
          layout: sensorIconLayout,
          paint: sensorIconPaint,
        },
        b,
      );
    }

    this.applyFovLabelStyleFromBundle(null);
    this.applyCoverageLayerVisibility();
  }

  setCoverageLayerVisibility(partial: Partial<OptoelectronicFovVisibility>) {
    this.coverageVis = { ...this.coverageVis, ...partial };
    this.applyCoverageLayerVisibility();
  }

  private applyFovLabelStyleFromBundle(bundle: AppConfigSectorBundle | null) {
    const m = this.map;
    const L = laserLabelStyleFromBundle(bundle);
    for (const lid of [FOV_LABEL]) {
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
    this.refreshFovLabelGeoJson();
  }

  setAssetDispositionAccent(accent: AssetDispositionIconAccent | null) {
    this.assetDispositionAccent = accent;
    this.refreshFovLabelGeoJson();
    this.refreshOptoIcons();
  }

  private refreshFovLabelGeoJson() {
    const m = this.map;
    const f = m.getSource(FOV_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!f || !this.lastFovAssets) return;
    f.setData(
      buildFovGeoJSON(this.lastFovAssets, this.assetDispositionAccent) as GeoJSON.FeatureCollection,
    );
  }

  private refreshOptoIcons() {
    const m = this.map;
    const assets = this.lastFovAssets;
    if (!assets) return;
    const os = m.getSource(OPTO_ASSET_ICON_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (os) os.setData(buildOptoAssetIconGeoJSON(assets) as GeoJSON.FeatureCollection);
  }

  applyCamerasBundle(bundle: AppConfigSectorBundle | null) {
    const m = this.map;
    const border = laserSectorBorderFromBundle(bundle);
    const vis = bundle?.visibility;
    this.applyFovLabelStyleFromBundle(bundle);
    this.setCoverageLayerVisibility({
      fovFillVisible: vis?.sectorFillVisible !== false,
      fovLineVisible: border.emit,
      fovLabelVisible: sectorBundleAnyMergedVisible(bundle, "centerNameVisible"),
    });
    if (!m.getLayer(FOV_LINE)) return;
    const rm = m as maplibregl.Map & { removePaintProperty?: (id: string, prop: string) => void };
    if (border.emit) {
      m.setPaintProperty(FOV_LINE, "line-width", border.lineWidth);
      m.setPaintProperty(
        FOV_LINE,
        "line-color",
        border.lineColorFixed ? border.lineColorFixed : FOV_LINE_COLOR_BY_ASSET,
      );
      if (border.lineDash.length >= 2) {
        m.setPaintProperty(FOV_LINE, "line-dasharray", [border.lineDash[0]!, border.lineDash[1]!]);
      } else {
        rm.removePaintProperty?.(FOV_LINE, "line-dasharray");
      }
    } else {
      m.setPaintProperty(FOV_LINE, "line-width", 1.2);
      m.setPaintProperty(FOV_LINE, "line-color", FOV_LINE_COLOR_BY_ASSET);
      m.setPaintProperty(FOV_LINE, "line-dasharray", FOV_LINE_DASH_BY_VIRTUAL);
    }
  }

  private applyCoverageLayerVisibility() {
    const m = this.map;
    const setVis = (id: string, show: boolean) => {
      if (!m.getLayer(id)) return;
      m.setLayoutProperty(id, "visibility", show ? "visible" : "none");
    };
    setVis(FOV_FILL, this.coverageVis.fovFillVisible);
    setVis(FOV_LINE, this.coverageVis.fovLineVisible);
    setVis(FOV_LABEL, this.coverageVis.fovLabelVisible);
    setVis(OPTO_ASSET_ICON_LAYER, this.coverageVis.fovLabelVisible);
  }

  setFromAssets(assets: Asset[]) {
    this.lastFovAssets = assets;
    const m = this.map;
    const f = m.getSource(FOV_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (f) {
      f.setData(
        buildFovGeoJSON(assets, this.assetDispositionAccent) as GeoJSON.FeatureCollection,
      );
    }
    this.refreshOptoIcons();
  }

  dispose() {
    const m = this.map;
    for (const id of [OPTO_ASSET_ICON_LAYER, FOV_LABEL, FOV_LINE, FOV_FILL]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource(OPTO_ASSET_ICON_SOURCE)) m.removeSource(OPTO_ASSET_ICON_SOURCE);
    if (m.getSource(FOV_SOURCE)) m.removeSource(FOV_SOURCE);
  }
}
