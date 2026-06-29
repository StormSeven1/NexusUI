/**
 * **飞弹**（静态 `missiles.devices`）：`app-config` 行 → `AssetData`，以及 MapLibre 独立 source/图层。
 */

import type maplibregl from "maplibre-gl";
import { isVirtualFromProperties, parseMapAssetTypeStrict, type Asset } from "@/lib/map-entity-model";
import type { AssetData } from "@/stores/asset-store";
import { parseForceDisposition } from "@/lib/theme-colors";
import { mergeRootAndDeviceVisible } from "@/lib/utils";
import type { AssetDispositionIconAccent, AssetStatus } from "@/lib/map-icons";
import {
  assetMapLabelTextColor,
  buildAssetSymbolDataUrl,
  getAssetSymbolId,
  getAssetSymbolRasterSize,
  MAP_FRIENDLY_COLOR_PROP,
  MAP_LABEL_FONT_COLOR_PROP,
  MAPLIBRE_ASSET_CENTER_ICON_SIZE,
} from "@/lib/map-icons";
import type { AppConfigSectorBundle } from "@/lib/map-app-config";
import { laserLabelStyleFromBundle, sectorBundleAnyMergedVisible } from "@/lib/map-app-config";
import { weaponBlinkOpacity } from "@/lib/weapon/weapon-power-state";

export const MISSILE_STATIC_SOURCE = "nexus-missile-static";
export const MISSILE_ICON_LAYER = "nexus-missile-icon";
export const MISSILE_LABEL_LAYER = "nexus-missile-label";

async function loadSvgImage(src: string, size: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(size, size);
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

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

function mapMissileConfigDeviceRow(
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
  const assetType = parseMapAssetTypeStrict(r.assetType, `missiles.devices[${id}].assetType`);
  const bearing = Number(r.bearing);
  const heading = Number.isFinite(bearing) ? bearing : 0;
  const fovAngle = Number.isFinite(Number(r.fovAngle)) ? Number(r.fovAngle) : 90;
  const rowProperties = asRecord(r.properties as unknown);
  const virtualTroop = isVirtualFromProperties(r) || isVirtualFromProperties(rowProperties);
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
      ...(rowProperties ?? {}),
      config_kind: "missile",
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

/** 根键 `missiles.devices[]` → `AssetData`（`assetType` 须为 `missile`） */
export function mapMissilesDevicesPayload(missilesRoot: unknown): AssetData[] {
  const root = asRecord(missilesRoot);
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
    if (raw == null || String(raw).trim() === "") r.assetType = "missile";
    const t = String(r.assetType).trim().toLowerCase();
    if (t !== "missile") {
      const id = String(r.deviceId ?? "?");
      throw new Error(`missiles.devices[${id}].assetType 必须为 missile（当前为 ${t || "空"}）`);
    }
    const a = mapMissileConfigDeviceRow(r, defM, vis, rootAssetFriendlyColor, rootLabelFontColor);
    if (a) out.push(a);
  }
  return out;
}

function assetStatusFromLabel(s: string | undefined): AssetStatus {
  const x = String(s ?? "online");
  if (x === "offline" || x === "degraded" || x === "online") return x;
  return "online";
}

const VIRTUAL_MISSILE_SYMBOL_OPACITY = 0.6;

type MissileIconOpacityPaint = NonNullable<maplibregl.SymbolLayerSpecification["paint"]>["icon-opacity"];

function missileIconOpacityExpression(armingOpacity: number): MissileIconOpacityPaint {
  return [
    "case",
    ["==", ["get", "isArming"], true],
    ["*", ["coalesce", ["get", "symbolOpacity"], 1], armingOpacity],
    ["coalesce", ["get", "symbolOpacity"], 1],
  ] as unknown as MissileIconOpacityPaint;
}

function buildMissileStaticGeoJSON(
  assetList: Asset[],
  accent: AssetDispositionIconAccent | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const a of assetList) {
    if (a.type !== "missile") continue;
    if (a.centerIconVisible === false) continue;
    const props = a.properties && typeof a.properties === "object" ? (a.properties as Record<string, unknown>) : {};
    const isArming = props.munition_frontend_arming === true;
    const isVirtual = a.isVirtual === true || isVirtualFromProperties(props);
    const rowStatus = assetStatusFromLabel(a.status);
    const disp = a.disposition ?? "friendly";
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [a.lng, a.lat] },
      properties: {
        kind: "icon",
        id: a.id,
        assetType: a.type,
        heading: a.heading ?? 0,
        symbolId: getAssetSymbolId(
          a.type,
          rowStatus,
          isVirtual,
          disp,
          disp === "friendly" ? a.friendlyMapColor : undefined,
        ),
        isVirtual: isVirtual ? 1 : 0,
        symbolOpacity: isVirtual ? VIRTUAL_MISSILE_SYMBOL_OPACITY : 1,
        isArming,
      },
    });
  }
  for (const a of assetList) {
    if (a.type !== "missile") continue;
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

export class MissileStaticMaplibre {
  private map: maplibregl.Map;
  private beforeId?: string;
  private assetDispositionAccent: AssetDispositionIconAccent | null = null;
  private lastAssets: Asset[] | null = null;
  private bundle: AppConfigSectorBundle | null = null;
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private ensuredSymbolIds = new Set<string>();

  constructor(map: maplibregl.Map, options?: { insertBeforeLayerId?: string }) {
    this.map = map;
    this.beforeId = options?.insertBeforeLayerId;
  }

  install() {
    const m = this.map;
    const b = this.beforeId;

    if (!m.getSource(MISSILE_STATIC_SOURCE)) {
      m.addSource(MISSILE_STATIC_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
    const iconLayout: maplibregl.SymbolLayerSpecification["layout"] = {
      "icon-image": ["get", "symbolId"],
      "icon-size": MAPLIBRE_ASSET_CENTER_ICON_SIZE,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-rotate": ["coalesce", ["get", "heading"], 0],
      "icon-rotation-alignment": "map",
      "icon-pitch-alignment": "map",
    };
    if (!m.getLayer(MISSILE_ICON_LAYER)) {
      m.addLayer(
        {
          id: MISSILE_ICON_LAYER,
          type: "symbol",
          source: MISSILE_STATIC_SOURCE,
          filter: ["==", ["get", "kind"], "icon"],
          layout: iconLayout,
          paint: {
            "icon-opacity": missileIconOpacityExpression(weaponBlinkOpacity()),
          },
        },
        b,
      );
    }
    if (!m.getLayer(MISSILE_LABEL_LAYER)) {
      m.addLayer(
        {
          id: MISSILE_LABEL_LAYER,
          type: "symbol",
          source: MISSILE_STATIC_SOURCE,
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
    this.applyMissilesBundle(null);
  }

  setAssetDispositionAccent(accent: AssetDispositionIconAccent | null) {
    this.assetDispositionAccent = accent;
    this.refreshData();
  }

  applyMissilesBundle(bundle: AppConfigSectorBundle | null) {
    this.bundle = bundle;
    const m = this.map;
    const L = laserLabelStyleFromBundle(bundle);
    for (const lid of [MISSILE_LABEL_LAYER]) {
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
    setVis(MISSILE_ICON_LAYER, iconOn);
    setVis(MISSILE_LABEL_LAYER, labelOn);
  }

  setFromAssets(assets: Asset[]) {
    this.lastAssets = assets;
    this.refreshData();
    this.syncBlinkTimer();
  }

  private refreshData() {
    const m = this.map;
    const src = m.getSource(MISSILE_STATIC_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src || !this.lastAssets) return;
    void this.ensureMissileSymbolImages(this.lastAssets);
    src.setData(buildMissileStaticGeoJSON(this.lastAssets, this.assetDispositionAccent) as GeoJSON.FeatureCollection);
  }

  private async ensureMissileSymbolImages(assets: Asset[]) {
    const m = this.map;
    const rasterPx = getAssetSymbolRasterSize("missile");
    for (const a of assets) {
      if (a.type !== "missile") continue;
      if (a.centerIconVisible === false) continue;
      const props = a.properties && typeof a.properties === "object" ? (a.properties as Record<string, unknown>) : {};
      const isVirtual = a.isVirtual === true || isVirtualFromProperties(props);
      const status = assetStatusFromLabel(a.status);
      const disposition = a.disposition ?? "friendly";
      const friendlyFill = disposition === "friendly" ? a.friendlyMapColor : undefined;
      const symbolId = getAssetSymbolId("missile", status, isVirtual, disposition, friendlyFill);
      if (this.ensuredSymbolIds.has(symbolId)) continue;
      this.ensuredSymbolIds.add(symbolId);
      try {
        const src = await buildAssetSymbolDataUrl(
          "missile",
          status,
          isVirtual,
          disposition,
          this.assetDispositionAccent,
          friendlyFill,
          { applyVirtualOpacity: false },
        );
        const img = await loadSvgImage(src, rasterPx);
        if (m.hasImage(symbolId)) {
          m.removeImage(symbolId);
        }
        m.addImage(symbolId, img, { pixelRatio: 2 });
        m.triggerRepaint?.();
      } catch (error) {
        this.ensuredSymbolIds.delete(symbolId);
        console.warn("[missile-maplibre] ensure symbol image failed", symbolId, error);
      }
    }
  }

  private hasArmingMissile(): boolean {
    for (const a of this.lastAssets ?? []) {
      if (a.type !== "missile") continue;
      const props = a.properties && typeof a.properties === "object" ? (a.properties as Record<string, unknown>) : {};
      if (props.munition_frontend_arming === true) return true;
    }
    return false;
  }

  private stopBlinkTimer() {
    if (this.blinkTimer) clearInterval(this.blinkTimer);
    this.blinkTimer = null;
  }

  private syncBlinkTimer() {
    if (this.hasArmingMissile()) {
      this.applyBlinkOpacity();
      if (!this.blinkTimer) this.blinkTimer = setInterval(() => this.applyBlinkOpacity(), 500);
    } else {
      this.applyBlinkOpacity(1);
      this.stopBlinkTimer();
    }
  }

  private applyBlinkOpacity(forceOpacity?: number) {
    const m = this.map;
    if (!m.getLayer(MISSILE_ICON_LAYER)) return;
    const opacity = forceOpacity ?? weaponBlinkOpacity();
    m.setPaintProperty(MISSILE_ICON_LAYER, "icon-opacity", missileIconOpacityExpression(opacity));
    m.triggerRepaint?.();
  }

  dispose() {
    this.stopBlinkTimer();
    const m = this.map;
    for (const id of [MISSILE_LABEL_LAYER, MISSILE_ICON_LAYER]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource(MISSILE_STATIC_SOURCE)) m.removeSource(MISSILE_STATIC_SOURCE);
  }
}
