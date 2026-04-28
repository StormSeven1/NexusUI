/**
 * **机场**（Dock / 静态 `airports.devices`）：`app-config` 行 → `AssetData`，以及 MapLibre 独立 source/图层（**不**放在光电模块内）。
 */

import type maplibregl from "maplibre-gl";
import { parseMapAssetTypeStrict, type Asset } from "@/lib/map-entity-model";
import type { AssetData } from "@/stores/asset-store";
import { parseForceDisposition } from "@/lib/theme-colors";
import { mergeRootAndDeviceVisible } from "@/lib/utils";
import type { AssetDispositionIconAccent, AssetStatus } from "@/lib/map-icons";
import {
  assetMapLabelTextColor,
  getAssetSymbolId,
  MAP_FRIENDLY_COLOR_PROP,
  MAP_LABEL_FONT_COLOR_PROP,
  MAPLIBRE_ASSET_CENTER_ICON_SIZE,
} from "@/lib/map-icons";
import type { AppConfigSectorBundle } from "@/lib/map-app-config";
import { laserLabelStyleFromBundle, sectorBundleAnyMergedVisible } from "@/lib/map-app-config";

export const AIRPORT_STATIC_SOURCE = "nexus-airport-static";
export const AIRPORT_ICON_LAYER = "nexus-airport-icon";
export const AIRPORT_LABEL_LAYER = "nexus-airport-label";

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

function mapAirportConfigDeviceRow(
  r: Record<string, unknown>,
  defaultRangeM: number,
  visibility: Record<string, unknown> | null | undefined,
  rootAssetFriendlyColor?: string | null,
  rootLabelFontColor?: string | null,
): AssetData | null {
  const id = String(r.deviceId ?? "");
  const c = r.center;
  if (!id || !Array.isArray(c) || c.length < 2) return null;
  const lng = Number(c[0]);
  const lat = Number(c[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  const rangeM = Number.isFinite(Number(r.range)) ? Number(r.range) : defaultRangeM;
  const assetType = parseMapAssetTypeStrict(r.assetType, `airports.devices[${id}].assetType`);
  const bearing = Number(r.bearing);
  const heading = Number.isFinite(bearing) ? bearing : 0;
  const fovAngle = Number.isFinite(Number(r.fovAngle)) ? Number(r.fovAngle) : 90;
  const virtualTroop = r.virtualTroop === true;
  const now = isoNow();

  const centerNameVisible = mergeRootAndDeviceVisible(
    rootVisibilityField(visibility, "centerNameVisible"),
    r.centerNameVisible,
  );
  const centerIconVisible = mergeRootAndDeviceVisible(
    rootVisibilityField(visibility, "centerIconVisible"),
    r.centerIconVisible,
  );
  const fovSectorVisible = r.showSector !== false;

  const rowLbl = asRecord(r.label);
  const rowLabelColor = typeof rowLbl?.fontColor === "string" && rowLbl.fontColor.trim() ? rowLbl.fontColor.trim() : "";
  const rootLabelColor =
    typeof rootLabelFontColor === "string" && rootLabelFontColor.trim() ? rootLabelFontColor.trim() : "";
  const mapLabelColor = rowLabelColor || rootLabelColor;
  const rowAssetColor =
    typeof r.assetFriendlyColor === "string" && r.assetFriendlyColor.trim() ? r.assetFriendlyColor.trim() : "";
  const rootAssetColor =
    typeof rootAssetFriendlyColor === "string" && rootAssetFriendlyColor.trim() ? rootAssetFriendlyColor.trim() : "";
  const mapFriendly = rowAssetColor || rootAssetColor;

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
      ...(mapLabelColor ? { [MAP_LABEL_FONT_COLOR_PROP]: mapLabelColor } : {}),
    },
    mission_status: "monitoring",
    assigned_target_id: null,
    target_lat: null,
    target_lng: null,
    created_at: String(r.created_at ?? now),
    updated_at: now,
  };
}

/** 根键 `airports.devices[]` → `AssetData`（`assetType` 须为 `airport`） */
export function mapAirportsDevicesPayload(airportsRoot: unknown): AssetData[] {
  const root = asRecord(airportsRoot);
  if (!root || !Array.isArray(root.devices)) return [];
  const defM = Number(root.defaultRange) || 15_000;
  const vis = asRecord(root.visibility);
  const rootLbl = asRecord(root.label);
  const rootLabelFontColor =
    typeof rootLbl?.fontColor === "string" && rootLbl.fontColor.trim() ? rootLbl.fontColor.trim() : undefined;
  const rootAssetFriendlyColor =
    typeof root.assetFriendlyColor === "string" && root.assetFriendlyColor.trim() ? root.assetFriendlyColor.trim() : undefined;
  const out: AssetData[] = [];
  for (const item of root.devices) {
    if (!item || typeof item !== "object") continue;
    const r: Record<string, unknown> = { ...(item as Record<string, unknown>) };
    const raw = r.assetType;
    if (raw == null || String(raw).trim() === "") r.assetType = "airport";
    const t = String(r.assetType).trim().toLowerCase();
    if (t !== "airport") {
      const id = String(r.deviceId ?? "?");
      throw new Error(`airports.devices[${id}].assetType 必须为 airport（当前为 ${t || "空"}）`);
    }
    const a = mapAirportConfigDeviceRow(r, defM, vis, rootAssetFriendlyColor, rootLabelFontColor);
    if (a) out.push(a);
  }
  return out;
}

function assetStatusFromLabel(s: string | undefined): AssetStatus {
  const x = String(s ?? "online");
  if (x === "offline" || x === "degraded" || x === "online") return x;
  return "online";
}

function buildAirportStaticGeoJSON(
  assetList: Asset[],
  accent: AssetDispositionIconAccent | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const a of assetList) {
    if (a.type !== "airport") continue;
    if (a.centerIconVisible === false) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [a.lng, a.lat] },
      properties: {
        kind: "icon",
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
    });
  }
  for (const a of assetList) {
    if (a.type !== "airport") continue;
    if (a.nameLabelVisible === false || !String(a.name ?? "").trim()) continue;
    const disp = a.disposition ?? "friendly";
    const st = assetStatusFromLabel(a.status);
    const friendlyOv = disp === "friendly" ? a.labelFontColor : undefined;
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

/**
 * 机场站址图标 + 名称（独立 source；图层面板 **`lyr-airport`** 在 `Map2D.LAYER_MAPPING` 中绑定图层 id）。
 */
export class AirportStaticMaplibre {
  private map: maplibregl.Map;
  private beforeId?: string;
  private assetDispositionAccent: AssetDispositionIconAccent | null = null;
  private lastAssets: Asset[] | null = null;
  private bundle: AppConfigSectorBundle | null = null;

  constructor(map: maplibregl.Map, options?: { insertBeforeLayerId?: string }) {
    this.map = map;
    this.beforeId = options?.insertBeforeLayerId;
  }

  install() {
    const m = this.map;
    const b = this.beforeId;

    if (!m.getSource(AIRPORT_STATIC_SOURCE)) {
      m.addSource(AIRPORT_STATIC_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
    const iconLayout: maplibregl.SymbolLayerSpecification["layout"] = {
      "icon-image": ["get", "symbolId"],
      "icon-size": MAPLIBRE_ASSET_CENTER_ICON_SIZE,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-rotation-alignment": "viewport",
      "icon-pitch-alignment": "viewport",
    };
    if (!m.getLayer(AIRPORT_ICON_LAYER)) {
      m.addLayer(
        {
          id: AIRPORT_ICON_LAYER,
          type: "symbol",
          source: AIRPORT_STATIC_SOURCE,
          filter: ["==", ["get", "kind"], "icon"],
          layout: iconLayout,
          paint: { "icon-opacity": ["coalesce", ["get", "symbolOpacity"], 1] },
        },
        b,
      );
    }
    if (!m.getLayer(AIRPORT_LABEL_LAYER)) {
      m.addLayer(
        {
          id: AIRPORT_LABEL_LAYER,
          type: "symbol",
          source: AIRPORT_STATIC_SOURCE,
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
    this.applyAirportsBundle(null);
  }

  setAssetDispositionAccent(accent: AssetDispositionIconAccent | null) {
    this.assetDispositionAccent = accent;
    this.refreshData();
  }

  applyAirportsBundle(bundle: AppConfigSectorBundle | null) {
    this.bundle = bundle;
    const m = this.map;
    const L = laserLabelStyleFromBundle(bundle);
    for (const lid of [AIRPORT_LABEL_LAYER]) {
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
    this.applyBundleVisibility();
    this.refreshData();
  }

  private applyBundleVisibility() {
    const m = this.map;
    const b = this.bundle;
    const iconOn = sectorBundleAnyMergedVisible(b, "centerIconVisible");
    const labelOn = sectorBundleAnyMergedVisible(b, "centerNameVisible");
    const setVis = (id: string, show: boolean) => {
      if (!m.getLayer(id)) return;
      m.setLayoutProperty(id, "visibility", show ? "visible" : "none");
    };
    setVis(AIRPORT_ICON_LAYER, iconOn);
    setVis(AIRPORT_LABEL_LAYER, labelOn);
  }

  setFromAssets(assets: Asset[]) {
    this.lastAssets = assets;
    this.refreshData();
  }

  private refreshData() {
    const m = this.map;
    const src = m.getSource(AIRPORT_STATIC_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src || !this.lastAssets) return;
    src.setData(buildAirportStaticGeoJSON(this.lastAssets, this.assetDispositionAccent) as GeoJSON.FeatureCollection);
  }

  dispose() {
    const m = this.map;
    for (const id of [AIRPORT_LABEL_LAYER, AIRPORT_ICON_LAYER]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource(AIRPORT_STATIC_SOURCE)) m.removeSource(AIRPORT_STATIC_SOURCE);
  }
}
