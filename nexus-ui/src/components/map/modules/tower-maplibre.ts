/**
 * **电侦（tower / 电子侦察）**：独立 MapLibre source / 图层。
 *
 * 与光电（optoelectronic-fov-maplibre）完全分离：
 *   - 独立的 source / FOV fill / FOV line / icon 层 / label 层，不与光电共享任何 MapLibre 资源
 *   - 独立的图层显隐控制（LYR_TOWER）
 *   - 电侦图标使用 电侦.svg（PUBLIC_MAP_SVG_FILES.tower）
 *   - 电侦显示名为"电侦XXX"（formatTowerMapLabel），不是"相机XXX"
 *   - 电侦有 FOV 扇区（与光电逻辑相同但完全独立 source/layer）
 */

import type maplibregl from "maplibre-gl";
import type { Asset } from "@/lib/map-entity-model";
import type { AssetDispositionIconAccent, AssetStatus } from "@/lib/map-icons";
import {
  assetMapLabelTextColor,
  geoCircleCoords,
  geoSectorCoords,
  getAssetSymbolId,
  MAPLIBRE_ASSET_CENTER_ICON_SIZE,
} from "@/lib/map-icons";
import type { AppConfigSectorBundle } from "@/lib/map-app-config";
import { resolveTowerFovStyle } from "@/lib/map-app-config";

/* ── MapLibre source / layer 常量 ── */

/** 电侦 FOV 扇区 source（fill + line 共用） */
export const TOWER_FOV_SOURCE = "tower-fov-source";
export const TOWER_FOV_FILL = "tower-fov-fill";
export const TOWER_FOV_LINE = "tower-fov-line";

/** 电侦图标 + 名称标签 source（独立于 FOV source） */
export const TOWER_SOURCE = "tower-source";
/** 电侦中心图标层 */
export const TOWER_ICON_LAYER = "tower-icon";
/** 电侦名称标签层 */
export const TOWER_LABEL_LAYER = "tower-label";

export const TOWER_LAYER_IDS = [TOWER_FOV_FILL, TOWER_FOV_LINE, TOWER_ICON_LAYER, TOWER_LABEL_LAYER] as const;

function assetStatusFromLabel(s: string | undefined): AssetStatus {
  const x = String(s ?? "online");
  if (x === "offline" || x === "degraded" || x === "online") return x;
  return "online";
}

/**
 * 构建电侦 FOV 扇区 GeoJSON（多边形）。
 * 仅处理 type === "tower" 且有 range 的资产。
 */
function buildTowerFovGeoJSON(assetList: Asset[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const a of assetList) {
    if (a.type !== "tower") continue;
    if (a.showFov === false) continue;
    if (!a.range || a.range <= 0) continue;

    /* 有 fovAngle < 360 且有 heading → 扇形；否则圆形 */
    const isSector = a.fovAngle !== undefined && a.fovAngle < 360 && a.heading !== undefined;
    const coords = isSector
      ? geoSectorCoords(a.lng, a.lat, a.range, a.heading!, a.fovAngle!)
      : geoCircleCoords(a.lng, a.lat, a.range);

    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [coords] },
      properties: {
        kind: "fov",
        id: a.id,
        assetType: a.type,
        isVirtual: a.isVirtual === true ? 1 : 0,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/**
 * 构建电侦图标 + 名称标签 GeoJSON。
 * 仅处理 type === "tower" 的资产。
 */
function buildTowerIconGeoJSON(
  assetList: Asset[],
  accent: AssetDispositionIconAccent | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  /* 中心图标点 */
  for (const a of assetList) {
    if (a.type !== "tower") continue;
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

  /* 名称标签点 */
  for (const a of assetList) {
    if (a.type !== "tower") continue;
    if (a.nameLabelVisible === false || !String(a.name ?? "").trim()) continue;
    const disp = a.disposition ?? "friendly";
    const st = assetStatusFromLabel(a.status);
    const friendlyOv = disp === "friendly" ? a.labelFontColor : undefined;
    const labelColor = assetMapLabelTextColor(disp, st, accent, friendlyOv);
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

/** 电侦图层显隐 */
export type TowerLayerVisibility = {
  fovFillVisible: boolean;
  fovLineVisible: boolean;
  iconVisible: boolean;
  labelVisible: boolean;
};

const towerVisDefault: TowerLayerVisibility = {
  fovFillVisible: true,
  fovLineVisible: true,
  iconVisible: true,
  labelVisible: true,
};

/**
 * 电侦资产渲染模块：独立 FOV 扇区 + 图标 + 标签，与光电完全分离。
 *
 * 使用方式（见 Map2D）：
 * ```
 * const towerMod = new TowerMaplibre(map, { insertBeforeLayerId: ... });
 * towerMod.install();
 * towerMod.setAssetDispositionAccent(accent);
 * towerMod.setFromAssets(adaptedAssets);
 * ```
 */
export class TowerMaplibre {
  private map: maplibregl.Map;
  private beforeId?: string;
  private assetDispositionAccent: AssetDispositionIconAccent | null = null;
  private lastAssets: Asset[] | null = null;
  private vis: TowerLayerVisibility = { ...towerVisDefault };

  constructor(map: maplibregl.Map, options?: { insertBeforeLayerId?: string }) {
    this.map = map;
    this.beforeId = options?.insertBeforeLayerId;
  }

  install() {
    const m = this.map;
    const b = this.beforeId;

    /* ── FOV 扇区 source（fill + line 共用）── */
    if (!m.getSource(TOWER_FOV_SOURCE)) {
      m.addSource(TOWER_FOV_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }

    /* 电侦 FOV 填充层 */
    if (!m.getLayer(TOWER_FOV_FILL)) {
      m.addLayer(
        {
          id: TOWER_FOV_FILL,
          type: "fill",
          source: TOWER_FOV_SOURCE,
          filter: ["==", ["get", "kind"], "fov"],
          paint: {
            /* 电侦扇区填充色：青绿色半透明 */
            "fill-color": "rgba(52,211,153,0.10)",
            "fill-opacity": 0.10,
          },
        },
        b,
      );
    }

    /* 电侦 FOV 描边层 */
    if (!m.getLayer(TOWER_FOV_LINE)) {
      m.addLayer(
        {
          id: TOWER_FOV_LINE,
          type: "line",
          source: TOWER_FOV_SOURCE,
          filter: ["==", ["get", "kind"], "fov"],
          paint: {
            /* 电侦扇区描边色：青绿色 */
            "line-color": "#34d399",
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

    /* ── 图标 + 标签 source（独立于 FOV source）── */
    if (!m.getSource(TOWER_SOURCE)) {
      m.addSource(TOWER_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }

    /* 电侦中心图标层 */
    if (!m.getLayer(TOWER_ICON_LAYER)) {
      m.addLayer(
        {
          id: TOWER_ICON_LAYER,
          type: "symbol",
          source: TOWER_SOURCE,
          filter: ["==", ["get", "kind"], "icon"],
          layout: {
            "icon-image": ["get", "symbolId"],
            "icon-size": MAPLIBRE_ASSET_CENTER_ICON_SIZE,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-rotation-alignment": "viewport",
            "icon-pitch-alignment": "viewport",
          },
          paint: {
            "icon-opacity": ["coalesce", ["get", "symbolOpacity"], 1],
          },
        },
        b,
      );
    }

    /* 电侦名称标签层 */
    if (!m.getLayer(TOWER_LABEL_LAYER)) {
      m.addLayer(
        {
          id: TOWER_LABEL_LAYER,
          type: "symbol",
          source: TOWER_SOURCE,
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

    this.applyVisibility();
    this.applyFovStyleFromBundle(null);
  }

  /**
   * 从 cameras bundle 读取电侦 FOV 扇区颜色（sectorFillTower / sectorLineTower 等）并应用。
   * bundle 为 null 时使用代码内默认值（青绿色 #34d399）。
   */
  applyFovStyleFromBundle(bundle: AppConfigSectorBundle | null) {
    const m = this.map;
    const style = resolveTowerFovStyle(bundle);

    if (m.getLayer(TOWER_FOV_FILL)) {
      m.setPaintProperty(TOWER_FOV_FILL, "fill-color", style.fillColor);
      m.setPaintProperty(TOWER_FOV_FILL, "fill-opacity", style.fillOpacity);
    }
    if (m.getLayer(TOWER_FOV_LINE)) {
      m.setPaintProperty(TOWER_FOV_LINE, "line-color", style.lineColor);
      m.setPaintProperty(TOWER_FOV_LINE, "line-width", style.lineWidth);
      m.setPaintProperty(TOWER_FOV_LINE, "line-opacity", style.lineOpacity);
      m.setPaintProperty(TOWER_FOV_LINE, "line-dasharray", [
        "case",
        ["==", ["get", "isVirtual"], 1],
        ["literal", style.lineDashVirtual],
        ["literal", style.lineDashReal],
      ] as maplibregl.ExpressionSpecification);
    }
  }

  setAssetDispositionAccent(accent: AssetDispositionIconAccent | null) {
    this.assetDispositionAccent = accent;
    this.refreshData();
  }

  setLayerVisibility(partial: Partial<TowerLayerVisibility>) {
    this.vis = { ...this.vis, ...partial };
    this.applyVisibility();
  }

  private applyVisibility() {
    const m = this.map;
    const setVis = (id: string, show: boolean) => {
      if (!m.getLayer(id)) return;
      m.setLayoutProperty(id, "visibility", show ? "visible" : "none");
    };
    setVis(TOWER_FOV_FILL, this.vis.fovFillVisible);
    setVis(TOWER_FOV_LINE, this.vis.fovLineVisible);
    setVis(TOWER_ICON_LAYER, this.vis.iconVisible);
    setVis(TOWER_LABEL_LAYER, this.vis.labelVisible);
  }

  setFromAssets(assets: Asset[]) {
    this.lastAssets = assets;
    this.refreshData();
  }

  private refreshData() {
    const m = this.map;
    if (!this.lastAssets) return;

    /* FOV 扇区 */
    const fovSrc = m.getSource(TOWER_FOV_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (fovSrc) {
      fovSrc.setData(buildTowerFovGeoJSON(this.lastAssets) as GeoJSON.FeatureCollection);
    }

    /* 图标 + 标签 */
    const iconSrc = m.getSource(TOWER_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (iconSrc) {
      iconSrc.setData(buildTowerIconGeoJSON(this.lastAssets, this.assetDispositionAccent) as GeoJSON.FeatureCollection);
    }
  }

  dispose() {
    const m = this.map;
    for (const id of [TOWER_LABEL_LAYER, TOWER_ICON_LAYER, TOWER_FOV_LINE, TOWER_FOV_FILL]) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource(TOWER_SOURCE)) m.removeSource(TOWER_SOURCE);
    if (m.getSource(TOWER_FOV_SOURCE)) m.removeSource(TOWER_FOV_SOURCE);
  }
}
