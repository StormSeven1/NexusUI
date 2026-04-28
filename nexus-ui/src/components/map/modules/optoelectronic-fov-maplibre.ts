/**
 * ══════════════════════════════════════════════════════════════════════
 *  光电 FOV 渲染模块 —— FOV 扇区 + 名称标签 + 中心图标
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 光电/电侦渲染全链路 ──
 *
 *   1. 接收:
 *      ├─ 光电: WS entity_status → specificType="CAMERA"/"OPTOELECTRONIC"/"OPTICAL"/"光电" → asset_type="camera"
 *      │        或 camera/optoelectronic 独立消息 → 仅更新朝向/视场角/坐标
 *      └─ 电侦: WS entity_status → specificType="TOWER"/"ESM"/"电侦" → asset_type="tower"
 *
 *   2. 入资产:
 *      ├─ 静态: cameras.devices[] → mapCamerasDevicesPayload() → configAssetBase
 *      ├─ 动态: applyAssetListFromWs() → mergeDynamicAndStaticAssets() → asset-store
 *      └─ camera 独立消息 → 直接 patch asset-store 中已有光电的 heading/fov_angle/range_km
 *
 *   3. 渲染: asset-store → OptoelectronicFovModule.setFromAssets()
 *      ├─ buildFovGeoJSON() → 生成 FOV 扇区多边形 (geomKind="fov")
 *      │   ├─ 仅 camera 类型画 FOV 扇区；tower 由 tower-maplibre.ts 独立渲染
 *      │   ├─ 名称标签 (geomKind="lbl"): 有 name 且 nameLabelVisible≠false 就画，不依赖 range
 *      │   └─ 中心图标 (geomKind="ico"): 敌我配色 SVG 图标
 *      └─ 颜色: friendly → friendlyMapColor / label.textColor; hostile → FORCE_COLORS.hostile
 *
 *   4. 更新:
 *      ├─ entity_status 周期推送 → 整体替换 asset-store → 重新渲染
 *      └─ camera 消息 → parseCameraBearingDeg/parseCameraHorizontalFovDeg/parseCameraRangeKm
 *          与静态 cameras.devices 同 id 合并默认 bearing/angle/range
 *
 *   5. 超时: 无独立超时机制
 */
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
  MAP_LABEL_FONT_COLOR_PROP,
  MAPLIBRE_ASSET_CENTER_ICON_SIZE,
} from "@/lib/map-icons";
import type { AppConfigSectorBundle } from "@/lib/map-app-config";
import { laserLabelStyleFromBundle, laserSectorBorderFromBundle, resolveOptoFovStyle, sectorBundleAnyMergedVisible } from "@/lib/map-app-config";

/**
 * 光电（camera）FOV：GeoJSON 构建、`FOV_*` 常量、`OptoelectronicFovModule`。
 *
 * 【注意】本模块仅处理 camera（光电），不含 tower（电侦）。
 * 电侦的渲染完全独立，见 `tower-maplibre.ts`。
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

/** 根键 `cameras` → 静态光电塔等 `AssetData[]` */
export function mapCamerasDevicesPayload(camerasRoot: unknown): AssetData[] {
  const root = asRecord(camerasRoot);
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
    const a = mapCameraDeviceRow(item as Record<string, unknown>, defM, vis, rootAssetFriendlyColor, rootLabelFontColor);
    if (a) out.push(a);
  }
  return out;
}

export const FOV_SOURCE = "fov-source";
export const FOV_FILL = "fov-fill";
export const FOV_LINE = "fov-line";
export const FOV_LABEL = "fov-label";

/** 光电(camera) 中心图标（电侦见 `tower-maplibre.ts`，机场见 `airport-maplibre.ts`） */
export const OPTO_ASSET_ICON_SOURCE = "opto-asset-icon-src";
export const OPTO_ASSET_ICON_LAYER = "opto-asset-icon";

export const FOV_LAYER_IDS = [FOV_FILL, FOV_LINE, FOV_LABEL] as const;

function assetStatusFromLabel(s: string | undefined): AssetStatus {
  const x = String(s ?? "online");
  if (x === "offline" || x === "degraded" || x === "online") return x;
  return "online";
}

/** 构建 FOV 多边形 + 名称点：仅处理 camera（光电），不含 tower（电侦） */
export function buildFovGeoJSON(assetList: Asset[], accent?: AssetDispositionIconAccent | null) {
  /* 仅光电(camera)画 FOV 扇区；电侦(tower)由 tower-maplibre 独立渲染 */
  const polyFeatures = assetList
    .filter(
      (a) =>
        a.type === "camera" &&
        a.showFov !== false &&
        a.range &&
        a.range > 0,
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
    /* 仅光电(camera)画 FOV 名称标签；电侦(tower)由 tower-maplibre 独立渲染 */
    if (a.type !== "camera") continue;
    const showName = a.nameLabelVisible !== false && String(a.name ?? "").trim() !== "";
    if (!showName) continue;
    const disp = a.disposition ?? "friendly";
    const st = assetStatusFromLabel(a.status);
    const friendlyOv = disp === "friendly" ? a.labelFontColor : undefined;
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

/** 光电(camera) 中心图标（电侦/tower 已移至 `tower-maplibre.ts`，不再在此处理） */
export function buildOptoAssetIconGeoJSON(assetList: Asset[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: assetList
      .filter(
        (a) =>
          a.type === "camera" &&
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

/** 光电 FOV 扇区线色（仅 camera 类型会走此分支）；初始值会被 `applyFovStyleFromBundle` 从配置覆盖 */
let _fovLineColor = "#9333ea";
let _fovLineDashVirtual: number[] = [6, 4];
let _fovLineDashReal: number[] = [3, 3];

const FOV_LINE_COLOR_BY_ASSET: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "assetType"],
  "camera",
  "#9333ea",
  "#9333ea",
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
  /** 光电/塔台中心图标（`opto-asset-icon`）；须与名称标签分开，勿复用 `fovLabelVisible` */
  fovIconVisible: boolean;
};

const fovVisDefault: OptoelectronicFovVisibility = {
  fovFillVisible: true,
  fovLineVisible: true,
  fovLabelVisible: true,
  fovIconVisible: true,
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
  private lastFovDataSig = "";
  private lastIconDataSig = "";

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
            /* 光电 FOV 填充色（仅 camera） */
            "fill-color": "rgba(147,51,234,0.10)",
            "fill-opacity": 0.10,
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
            /* 光电 FOV 线色（仅 camera） */
            "line-color": "#9333ea",
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
    this.applyFovStyleFromBundle(null);
    this.applyCoverageLayerVisibility();
  }

  /**
   * 从 cameras bundle 读取光电 FOV 扇区颜色（fill / line / dash）并应用到 MapLibre 图层。
   * bundle 为 null 时使用代码内默认值（与历史行为一致）。
   */
  applyFovStyleFromBundle(bundle: AppConfigSectorBundle | null) {
    const m = this.map;
    const style = resolveOptoFovStyle(bundle);

    /* 更新模块级变量，供 applyCamerasBundle 里 border.emit=false 分支使用 */
    _fovLineColor = style.lineColor;
    _fovLineDashVirtual = style.lineDashVirtual;
    _fovLineDashReal = style.lineDashReal;

    /* 应用填充色 + 透明度 */
    if (m.getLayer(FOV_FILL)) {
      m.setPaintProperty(FOV_FILL, "fill-color", style.fillColor);
      m.setPaintProperty(FOV_FILL, "fill-opacity", style.fillOpacity);
    }

    /* 应用线色 / 线宽 / 透明度 / 虚线 */
    if (m.getLayer(FOV_LINE)) {
      m.setPaintProperty(FOV_LINE, "line-color", style.lineColor);
      m.setPaintProperty(FOV_LINE, "line-width", style.lineWidth);
      m.setPaintProperty(FOV_LINE, "line-opacity", style.lineOpacity);
      m.setPaintProperty(FOV_LINE, "line-dasharray", [
        "case",
        ["==", ["get", "isVirtual"], 1],
        ["literal", style.lineDashVirtual],
        ["literal", style.lineDashReal],
      ] as maplibregl.ExpressionSpecification);
    }
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
    this.lastFovDataSig = "";
    this.lastIconDataSig = "";
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
    const nextSig = this.buildOptoIconDataSig(assets);
    if (nextSig === this.lastIconDataSig) return;
    const os = m.getSource(OPTO_ASSET_ICON_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (os) {
      os.setData(buildOptoAssetIconGeoJSON(assets) as GeoJSON.FeatureCollection);
      this.lastIconDataSig = nextSig;
    }
  }

  applyCamerasBundle(bundle: AppConfigSectorBundle | null) {
    const m = this.map;
    const border = laserSectorBorderFromBundle(bundle);
    const vis = bundle?.visibility;
    this.applyFovLabelStyleFromBundle(bundle);
    this.applyFovStyleFromBundle(bundle);
    this.setCoverageLayerVisibility({
      fovFillVisible: vis?.sectorFillVisible !== false,
      fovLineVisible: border.emit,
      fovLabelVisible: sectorBundleAnyMergedVisible(bundle, "centerNameVisible"),
      fovIconVisible: sectorBundleAnyMergedVisible(bundle, "centerIconVisible"),
    });
    if (!m.getLayer(FOV_LINE)) return;
    const rm = m as maplibregl.Map & { removePaintProperty?: (id: string, prop: string) => void };
    if (border.emit) {
      m.setPaintProperty(FOV_LINE, "line-width", border.lineWidth);
      m.setPaintProperty(
        FOV_LINE,
        "line-color",
        border.lineColorFixed ? border.lineColorFixed : _fovLineColor,
      );
      if (border.lineDash.length >= 2) {
        m.setPaintProperty(FOV_LINE, "line-dasharray", [border.lineDash[0]!, border.lineDash[1]!]);
      } else {
        rm.removePaintProperty?.(FOV_LINE, "line-dasharray");
      }
    } else {
      const style = resolveOptoFovStyle(bundle);
      m.setPaintProperty(FOV_LINE, "line-width", style.lineWidth);
      m.setPaintProperty(FOV_LINE, "line-color", _fovLineColor);
      m.setPaintProperty(FOV_LINE, "line-dasharray", [
        "case",
        ["==", ["get", "isVirtual"], 1],
        ["literal", _fovLineDashVirtual],
        ["literal", _fovLineDashReal],
      ] as maplibregl.ExpressionSpecification);
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
    setVis(OPTO_ASSET_ICON_LAYER, this.coverageVis.fovIconVisible);
  }

  setFromAssets(assets: Asset[]) {
    this.lastFovAssets = assets;
    const m = this.map;
    const f = m.getSource(FOV_SOURCE) as maplibregl.GeoJSONSource | undefined;
    const nextFovSig = this.buildFovDataSig(assets);
    if (f) {
      f.setData(
        buildFovGeoJSON(assets, this.assetDispositionAccent) as GeoJSON.FeatureCollection,
      );
    }
    this.lastFovDataSig = nextFovSig;
    this.refreshOptoIcons();
  }

  /**
   * camera FOV 的轻量指纹：无关键字段变化时跳过 `setData`，降低 symbol 重排导致的闪烁。
   */
  private buildFovDataSig(assets: Asset[]): string {
    const quantizeDeg = (v: number | undefined): string => {
      const n = Number(v ?? 0);
      if (!Number.isFinite(n)) return "0.0";
      /* 角度容差：小于 0.1° 的变化视为同一档，避免微抖动触发重绘 */
      const q = Math.round(n * 10) / 10;
      return q.toFixed(1);
    };
    const rows = assets
      .filter((a) => a.type === "camera")
      .map((a) => {
        const range = Number(a.range ?? 0);
        return [
          a.id,
          Number(a.lng).toFixed(6),
          Number(a.lat).toFixed(6),
          Number.isFinite(range) ? range.toFixed(3) : "0",
          quantizeDeg(a.heading),
          quantizeDeg(a.fovAngle ?? 360),
          a.showFov === false ? "0" : "1",
          a.nameLabelVisible === false ? "0" : "1",
          a.name ?? "",
          a.status ?? "",
          a.disposition ?? "",
          a.labelFontColor ?? "",
        ].join("|");
      })
      .sort();
    return rows.join(";");
  }

  /**
   * 光电中心图标指纹：仅图标相关字段变化时刷新 icon source。
   */
  private buildOptoIconDataSig(assets: Asset[]): string {
    const rows = assets
      .filter((a) => a.type === "camera")
      .map((a) =>
        [
          a.id,
          Number(a.lng).toFixed(6),
          Number(a.lat).toFixed(6),
          a.centerIconVisible === false ? "0" : "1",
          a.status ?? "",
          a.disposition ?? "",
          a.isVirtual === true ? "1" : "0",
          a.friendlyMapColor ?? "",
        ].join("|"),
      )
      .sort();
    return rows.join(";");
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
