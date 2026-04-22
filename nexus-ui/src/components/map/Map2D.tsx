"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useAppStore } from "@/stores/app-store";
import { useMapPointerStore } from "@/stores/map-pointer-store";
import { useTrackStore } from "@/stores/track-store";
import {
  isVirtualFromProperties,
  normalizeAssetType,
  LYR_AIRPORT,
  LYR_DRONES,
  LYR_LASER,
  LYR_MEASURE,
  LYR_OPTO_FOV,
  LYR_RADAR_COVERAGE,
  LYR_TDOA,
  LYR_TOWER,
  LYR_TRACKS,
  LYR_ZONES,
  type Track,
} from "@/lib/map-entity-model";
import type { Asset } from "@/lib/map-entity-model";
import { useZoneStore } from "@/stores/zone-store";
import { useAssetStore } from "@/stores/asset-store";
import type { AssetData } from "@/stores/asset-store";
import { TargetPlacard, type PlacardKind } from "@/components/map/TargetPlacard";
import {
  buildMarkerSymbolDataUrl,
  getAllMarkerSymbolKeysForPrereg,
  buildLockOnDataUrl,
  LOCK_ON_IMAGE_ID,
  buildSelectionRingDataUrl,
  TRACK_SELECT_RING_ID,
  buildAssetSymbolDataUrl,
  getAllAssetSymbolKeysForPrereg,
  assetFriendlyColorFromProperties,
  buildIconSizeExpr,
  type AssetDispositionIconAccent,
} from "@/lib/map-icons";
import { FORCE_COLORS } from "@/lib/theme-colors";
import { getMaplibreBaseMapOptions } from "@/lib/map-2d-basemap";
import { parseVectorLayersForPanel } from "@/lib/map-2d-basemap-layer-panel";
import {
  loadResolvedAppConfig,
  mergeDynamicAndStaticAssets,
  sectorBundleToLaserLayerVis,
  sectorBundleToTdoaLayerVis,
  laserDevicesFromSectorBundle,
  tdoaDevicesFromSectorBundle,
  laserSectorBorderFromBundle,
  laserLabelStyleFromBundle,
  tdoaSectorBorderFromBundle,
  tdoaLabelStyleFromBundle,
  resolveLaserDefaults,
  resolveTdoaDefaults,
  dispositionFromAssetData,
  formatCameraTowerMapLabel,
  formatTowerMapLabel,
  getAssetFriendlyColorForAssetType,
  shouldDisplayAssetId,
} from "@/lib/map-app-config";
import {
  RadarCoverageModule,
  RADAR_COVERAGE_LAYER_IDS,
  RADAR_ASSET_ICON_LAYER,
} from "@/components/map/modules/radar-range-rings-maplibre";
import {
  AirportStaticMaplibre,
  AIRPORT_ICON_LAYER,
  AIRPORT_LABEL_LAYER,
} from "@/components/map/modules/airport-maplibre";
import { OptoelectronicFovModule, FOV_LAYER_IDS, OPTO_ASSET_ICON_LAYER } from "@/components/map/modules/optoelectronic-fov-maplibre";
import { TowerMaplibre, TOWER_LAYER_IDS, TOWER_ICON_LAYER } from "@/components/map/modules/tower-maplibre";
import { DistanceMeasureMaplibre, DIST_MEASURE_LAYER_IDS } from "@/components/map/modules/distance-measure-maplibre";
import { AngleMeasureMaplibre, ANGLE_LAYER_IDS } from "@/components/map/modules/angle-measure-maplibre";
import { PolygonDrawMaplibre, POLY_DRAW_LAYER_IDS, POLY_ZONES_LAYER_IDS } from "@/components/map/modules/polygon-draw-maplibre";
import { LaserMaplibre, LASER_CENTER, LASER_LAYER_IDS, type LaserDevice } from "@/components/map/modules/laser-maplibre";
import { TdoaMaplibre, TDOA_CENTER, TDOA_LAYER_IDS, type TdoaDevice } from "@/components/map/modules/tdoa-maplibre";
import {
  TracksMaplibre,
  TRACK_TRAIL,
  TRACK_SYMBOL,
  TRACK_LABEL,
  HIGHLIGHT_LAYER,
  LOCK_ON,
} from "@/components/map/modules/tracks-maplibre";
import {
  DronesMaplibre,
  DRONES_FOV_LAYER,
  DRONES_ROUTE_SOLID,
  DRONES_ROUTE_DASH,
  DRONES_STATIC_LABEL_LAYER,
  DRONES_STATIC_SYMBOL_LAYER,
  DRONES_TRAIL_SOLID,
  DRONES_TRAIL_DASH,
  DRONES_SYMBOL_LAYER,
  DRONES_LABEL_LAYER,
} from "@/components/map/modules/drones-maplibre";
import type { PolygonDrawCompletePayload } from "@/components/map/modules/polygon-draw-maplibre";
import {
  registerMapMeasureHandlers,
  useMapMeasureUi,
  type Map2DMeasureHandlers,
} from "@/stores/map-measure-bridge";

/* 2D 地图：航迹 / 资产 / 限制区 + 测量与扇区工具 */

/** 手绘多边形命名弹窗：默认描边/填充（与原先写死在 `commitPolyArea` 中的蓝色一致） */
const POLY_DIALOG_DEFAULT_STROKE = "#3b82f6";
const POLY_DIALOG_DEFAULT_FILL = "#3b82f6";
const POLY_DIALOG_DEFAULT_FILL_OPACITY = 0.28;

/**
 * 测量工具相关 layer id（含 lyr-measure）；须与 MapLibre layer.id 一致
 */
const MEASURE_TOOL_LAYER_IDS = [
  ...DIST_MEASURE_LAYER_IDS,
  ...ANGLE_LAYER_IDS,
  ...POLY_DRAW_LAYER_IDS,
];

/** 仅各资产站点图标层（雷达/光电符号 + 激光/TDOA 中心图标）；不含 fill/扫描/文字标签，避免误开标牌 */
/** 资产点选：**仅中心图标** symbol 层（不拾取名称文字层） */
const ASSET_POINT_PICK_LAYERS = [
  RADAR_ASSET_ICON_LAYER,
  OPTO_ASSET_ICON_LAYER,
  AIRPORT_ICON_LAYER,
  DRONES_STATIC_SYMBOL_LAYER,
  DRONES_SYMBOL_LAYER,
  LASER_CENTER,
  TDOA_CENTER,
];

/*
 * ── 限制区 / 多边形在地图上的三套东西（勿混为一谈）──
 *
 * 1) 业务限制区（zone-store / WS 等 → `PolygonDrawMaplibre.setCommittedZones`）
 *    MapLibre：`POLY_ZONES_*`（如 `polydraw2-zones-fill`），由 `LAYER_MAPPING["lyr-zones"]` 控制显隐。
 *
 * 2) 标绘草稿（鼠标正在画、尚未提交）
 *    MapLibre：`POLY_DRAW_*`，与 1) 不同源；提交后草稿结束，不应留在「限制区」数据里。
 *
 * 3) 已提交的手绘/工具多边形（`app-store.drawnAreas` → 本文件下方 subscribe 里动态 `area-source-*` + `area-fill-*` / `area-line-*` / `area-label-*`）
 *    不进 `POLY_ZONES_SOURCE`；图层面板同一开关「限制区域」(`lyr-zones`) 必须在 `applyLayerPanelVisibilityFromStore`
 *    里对 `drawnAreas` 再扫一遍，否则开关只影响 1) 不影响 3)。
 *
 * 新建 3) 时 MapLibre 默认 layer 多为 visible；若当前 `lyr-zones` 为关，需在 `addLayer` 之后补一次 apply，见该 subscribe 末尾。
 */
const LAYER_MAPPING: Record<string, string[]> = {
  [LYR_TRACKS]: [TRACK_TRAIL, TRACK_SYMBOL, TRACK_LABEL, HIGHLIGHT_LAYER, LOCK_ON],
  [LYR_DRONES]: [
    DRONES_ROUTE_SOLID,
    DRONES_ROUTE_DASH,
    DRONES_TRAIL_SOLID,
    DRONES_TRAIL_DASH,
    DRONES_FOV_LAYER,
    DRONES_SYMBOL_LAYER,
    DRONES_LABEL_LAYER,
    DRONES_STATIC_SYMBOL_LAYER,
    DRONES_STATIC_LABEL_LAYER,
  ],
  [LYR_AIRPORT]: [AIRPORT_ICON_LAYER, AIRPORT_LABEL_LAYER],
  [LYR_LASER]: [...LASER_LAYER_IDS],
  [LYR_TDOA]: [...TDOA_LAYER_IDS],
  [LYR_RADAR_COVERAGE]: [...RADAR_COVERAGE_LAYER_IDS, RADAR_ASSET_ICON_LAYER],
  [LYR_OPTO_FOV]: [...FOV_LAYER_IDS, OPTO_ASSET_ICON_LAYER],
  [LYR_TOWER]: [...TOWER_LAYER_IDS],
  [LYR_MEASURE]: [...MEASURE_TOOL_LAYER_IDS],
  [LYR_ZONES]: [...POLY_ZONES_LAYER_IDS],
};

/** 图层面板签名：底图矢量 / 数据图层变化时触发 apply 与 redraw */
function layerPanelVisibilitySignature(s: ReturnType<typeof useAppStore.getState>): string {
  const lv = Object.keys(s.layerVisibility)
    .sort()
    .map((k) => `${k}:${s.layerVisibility[k] ? "1" : "0"}`)
    .join(",");
  const bv = Object.keys(s.basemapVectorVisibility)
    .sort()
    .map((k) => `${k}:${s.basemapVectorVisibility[k] === false ? "0" : "1"}`)
    .join(",");
  const bl = s.basemapVectorLayers.map((l) => l.id).join(",");
  return `${s.basemapGroupVisible ? "1" : "0"}|${bl}|${bv}|${lv}`;
}

/**
 * 从 store 同步到 MapLibre `layer.id` 的 `layout.visibility`。
 *
 * 不依赖 `isStyleLoaded()` 全局守卫：逐图层 try-catch，图层未挂上时静默跳过。
 * pending 机制由外层 subscribe effect 在 `idle` 时补调。
 *
 * `lyr-zones`：除 `POLY_ZONES_LAYER_IDS` 外，另对 `drawnAreas` 对应的 `area-*` 图层同步同一开关（见文件顶部大块注释）。
 */
function applyLayerPanelVisibilityFromStore(
  map: maplibregl.Map,
  s: ReturnType<typeof useAppStore.getState>
): void {
  const master = s.basemapGroupVisible;
  const per = s.basemapVectorVisibility;
  for (const l of s.basemapVectorLayers) {
    try {
      if (!map.getLayer(l.id)) continue;
      map.setLayoutProperty(l.id, "visibility", master && per[l.id] !== false ? "visible" : "none");
    } catch { /* 图层尚未就绪，跳过 */ }
  }
  for (const [lid, mlIds] of Object.entries(LAYER_MAPPING)) {
    const v = s.layerVisibility[lid] ?? true;
    for (const ml of mlIds) {
      try {
        if (!map.getLayer(ml)) continue;
        map.setLayoutProperty(ml, "visibility", v ? "visible" : "none");
      } catch { /* 图层尚未就绪，跳过 */ }
    }
  }
  /* 与 `LAYER_MAPPING["lyr-zones"]` 同值：业务限制区 + 本 store 手绘区一起显隐 */
  const zoneVis = s.layerVisibility[LYR_ZONES] ?? true;
  for (const area of s.drawnAreas) {
    for (const suffix of ["area-fill-", "area-line-", "area-label-"] as const) {
      const ml = `${suffix}${area.id}`;
      try {
        if (!map.getLayer(ml)) continue;
        map.setLayoutProperty(ml, "visibility", zoneVis ? "visible" : "none");
      } catch { /* 图层尚未就绪，跳过 */ }
    }
  }
}

/**
 * 将 store 中的 `AssetData`（合并后的静态配置 + WS 等）转成地图专题层使用的 `Asset`。
 * - 字段映射：`range_km`→`range`、`fov_angle`→`fovAngle`；`heading` 原样供光电 FOV 扇形朝向。
 * - `properties` 布尔：雷达 `showRings`；非雷达的 `center_icon_visible` / `center_name_visible` / `fov_sector_visible`→`centerIconVisible` / `nameLabelVisible` / `showFov`。
 *
 * 地图资产渲染有两条路线（各自独立 GeoJSON source + layers，独立显隐控制）：
 *
 * 路线 A — 资产路线（本函数 + 各 module.setFromAssets）：
 *   asset-store → adaptAssets → Asset[] → 分发给各专题模块
 *   ├─ 雷达    → RadarCoverageModule  画同心圆环、距离标注、角度标注
 *   ├─ 光电/塔 → OptoelectronicFovModule 画 FOV 扇区、中心图标、名称标签
 *   ├─ 机场    → AirportStaticMaplibre  画机场图标 + 名称标签
 *   └─ 无人机  → DronesMaplibre.setStaticDroneSitesFromAssets  画静态机位点图标
 *   激光/TDOA 不走本路线，由 laserDevicesFromSectorBundle / tdoaDevicesFromSectorBundle 单独生成
 *
 * 路线 B — 遥测路线（各 module 直接读 store）：
 *   drone-store → DronesMaplibre.setDrones  画实时无人机位置、航向、历史轨迹、航线、FOV
 *   dock-store → dock_status 更新机场坐标/属性（通过 asset-store mergeAssetFields）
 *   track-store → TracksMaplibre  画航迹点、航迹线、锁定圈
 */
function adaptAssets(assets: AssetData[]): Asset[] {
  return assets
    .filter((a) => shouldDisplayAssetId(a.asset_type, a.id, a.name))
    .map((a) => {
    const p = a.properties as Record<string, unknown> | null | undefined;
    const isRadar = String(a.asset_type ?? "").toLowerCase() === "radar";
    let showRings: boolean | undefined;
    if (isRadar) {
      if (p && typeof p.showRings === "boolean") showRings = p.showRings;
      else showRings = true;
    }
    const centerIconVisible = p?.center_icon_visible === false ? false : undefined;
    /** 非雷达：中心名与光电 `fov-label` / 机场 `nexus-airport-label` 等；`center_name_visible===false` 时隐藏 */
    let nameLabelVisible: boolean | undefined;
    if (!isRadar && p?.center_name_visible === false) nameLabelVisible = false;
    const showFov = p?.fov_sector_visible === false ? false : undefined;
    if (!a.asset_type) console.warn("[Map2D] asset_type 为空:", a.id, a);
    const t = normalizeAssetType(a.asset_type);
    const disp = dispositionFromAssetData(a);
    let friendlyMapColor: string | undefined;
    if (disp === "friendly") {
      friendlyMapColor =
        assetFriendlyColorFromProperties(p ?? null) ??
        getAssetFriendlyColorForAssetType(t) ??
        FORCE_COLORS.friendly;
    }
    // 机场和无人机的 name 在入资产时已解析好，直接用；光电/电侦走 id 提取数字
    let displayName = a.name;
    if (t === "camera") displayName = formatCameraTowerMapLabel(a.id);
    else if (t === "tower") displayName = formatTowerMapLabel(a.id);
    return {
      id: a.id,
      name: displayName,
      type: t,
      status: a.status as Asset["status"],
      disposition: disp,
      lat: a.lat,
      lng: a.lng,
      range: a.range_km ?? undefined,
      heading: a.heading ?? undefined,
      fovAngle: a.fov_angle ?? undefined,
      isVirtual: isVirtualFromProperties(a.properties),
      ...(showRings !== undefined ? { showRings } : {}),
      ...(centerIconVisible === false ? { centerIconVisible: false } : {}),
      ...(nameLabelVisible === false ? { nameLabelVisible: false } : {}),
      ...(showFov === false ? { showFov: false } : {}),
      ...(friendlyMapColor ? { friendlyMapColor } : {}),
    };
  });
}

/**
 * Asset（asset-store 动态实体）→ LaserDevice（激光专题层 upsert）。
 *
 * - WS 动态实体不含激光扫描/脉动参数，使用默认 scan（enabled:false）；
 *   若该 id 已被静态 bundle upsert 过，则 scan/脉动参数保持不变（upsert 覆盖）。
 * - range/heading/fovAngle 等从 Asset 对应字段直接映射。
 */
function adaptAssetToLaserDevice(a: Asset): LaserDevice {
  return {
    id: a.id,
    lng: a.lng,
    lat: a.lat,
    /* Asset.range 单位 km；LaserDevice.rangeKm 也是 km，直接传递 */
    rangeKm: a.range ?? 12,
    headingDeg: a.heading ?? 0,
    openingDeg: a.fovAngle ?? 90,
    virtual: a.isVirtual,
    disposition: a.disposition,
    friendlyMapColor: (a.disposition ?? "friendly") === "friendly" ? a.friendlyMapColor : undefined,
    centerNameVisible: a.nameLabelVisible,
    /* 激光中心图标由 LaserMaplibre 专题层独立管理，不受资产层 center_icon_visible 影响。
     * 资产数据中 center_icon_visible: false 是为了不让资产符号层画激光图标，
     * 但激光专题层应该始终有中心图标（由 bundle 配置控制）。设为 undefined，
     * LaserMaplibre.flush() 中 centerIconVisible !== false → true，保留专题层图标。 */
    centerIconVisible: undefined,
    name: a.name,
    /* 动态 WS 实体不含扫描参数，默认关闭扫描动画；保留已有设备的扫描参数由 upsert 处理 */
    scan: { enabled: false, cycleMs: 4000, tickMs: 90, bandCount: 9, bandWidthMeters: 1 },
  };
}

/**
 * Asset（asset-store 动态实体）→ TdoaDevice（TDOA 专题层 upsert）。
 *
 * 与激光同理，动态实体不含 TDOA 扫描参数，使用默认 scan（enabled:false）。
 */
function adaptAssetToTdoaDevice(a: Asset): TdoaDevice {
  return {
    id: a.id,
    lng: a.lng,
    lat: a.lat,
    rangeKm: a.range ?? 12,
    headingDeg: a.heading ?? 0,
    openingDeg: a.fovAngle ?? 90,
    virtual: a.isVirtual,
    disposition: a.disposition,
    friendlyMapColor: (a.disposition ?? "friendly") === "friendly" ? a.friendlyMapColor : undefined,
    centerNameVisible: a.nameLabelVisible,
    /* TDOA 中心图标由 TdoaMaplibre 专题层独立管理，同激光 */
    centerIconVisible: undefined,
    name: a.name,
    scan: { enabled: false, cycleMs: 2000, tickMs: 100, bandCount: 9, bandWidthMeters: 2 },
  };
}

/**
 * 专题层要素 → 资产 id
 * - FOV/相机等多边形用 `id`；雷达覆盖用 `radarId`
 * - 无人机/机场 GeoJSON 用 `sn`（deviceSn/dockSn），与 asset-store key 一致
 */
function assetIdFromPickFeature(f: maplibregl.MapGeoJSONFeature): string | undefined {
  const p = f.properties as Record<string, unknown> | null | undefined;
  if (!p) return undefined;
  if (typeof p.id === "string" && p.id.length) return p.id;
  if (typeof p.radarId === "string" && p.radarId.length) return p.radarId;
  if (typeof p.sn === "string" && p.sn.length) return p.sn;
  return undefined;
}

function pickCoordsFromFeature(f: maplibregl.MapGeoJSONFeature, e: maplibregl.MapMouseEvent): [number, number] {
  const g = f.geometry;
  if (g.type === "Point") return [g.coordinates[0], g.coordinates[1]];
  return [e.lngLat.lng, e.lngLat.lat];
}

async function loadSvgImage(src: string, size: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image(size, size);
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`failed to load marker: ${src.slice(0, 48)}`));
    image.src = src;
  });
}

/* ---------- Map2D ---------- */

export function Map2D() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const lastFlySeqRef = useRef<number>(-1);
  const routeIdsRef = useRef<string[]>([]);
  const areaIdsRef = useRef<string[]>([]);
  const radarCovRef = useRef<RadarCoverageModule | null>(null);
  const optoFovRef = useRef<OptoelectronicFovModule | null>(null);
  const towerModRef = useRef<TowerMaplibre | null>(null);
  const airportStaticRef = useRef<AirportStaticMaplibre | null>(null);
  const tracksRef = useRef<TracksMaplibre | null>(null);
  /** 同帧内多次 `setTracks` 合并为一次 `requestAnimationFrame`，减轻 WS 突发压力 */
  const tracksPendingRef = useRef<Track[]>([]);
  const tracksFlushRafRef = useRef<number | null>(null);
  const dronesRef = useRef<DronesMaplibre | null>(null);
  /** 供静态无人机站址图层与资产更新时 `assetMapLabelTextColor` 等一致 */
  const assetDispositionAccentRef = useRef<AssetDispositionIconAccent>({});
  const polygonDrawRef = useRef<PolygonDrawMaplibre | null>(null);
  const measureToolRefs = useRef<{
    dist: DistanceMeasureMaplibre;
    angle: AngleMeasureMaplibre;
    poly: PolygonDrawMaplibre;
    laser: LaserMaplibre;
    tdoa: TdoaMaplibre;
  } | null>(null);
  const [polyPending, setPolyPending] = useState<PolygonDrawCompletePayload | null>(null);
  const [polyAreaName, setPolyAreaName] = useState("");
  /** 对应 `DrawnArea.color` / `fillColor` / `fillOpacity`，弹窗打开时复位为默认 */
  const [polyStrokeColor, setPolyStrokeColor] = useState(POLY_DIALOG_DEFAULT_STROKE);
  const [polyFillColor, setPolyFillColor] = useState(POLY_DIALOG_DEFAULT_FILL);
  const [polyFillOpacity, setPolyFillOpacity] = useState(POLY_DIALOG_DEFAULT_FILL_OPACITY);
  const [placard, setPlacard] = useState<{
    kind: PlacardKind;
    id: string;
    lng: number;
    lat: number;
    x: number;
    y: number;
  } | null>(null);
  const { setZoomLevel, selectTrack, selectAsset } = useAppStore();

  const selectTrackRef = useRef(selectTrack);
  useEffect(() => { selectTrackRef.current = selectTrack; }, [selectTrack]);
  const selectAssetRef = useRef(selectAsset);
  useEffect(() => { selectAssetRef.current = selectAsset; }, [selectAsset]);

  const placardRef = useRef(placard);
  useEffect(() => { placardRef.current = placard; }, [placard]);

  /** 手绘多边形确认入库：`drawnAreas` → 动态 `area-*` 图层；颜色来自弹窗状态（`DrawnArea` 三字段） */
  const commitPolyArea = useCallback(() => {
    if (!polyPending) return;
    const p = polyPending;
    const name = polyAreaName.trim() || "未命名区域";
    const areaLabel =
      p.areaM2 >= 1e6 ? `${(p.areaM2 / 1e6).toFixed(3)} km²` : `${Math.round(p.areaM2)} m²`;
    const perimLabel =
      p.perimeterM >= 1000 ? `${(p.perimeterM / 1000).toFixed(2)} km` : `${Math.round(p.perimeterM)} m`;
    const id = `poly-${Date.now()}`;
    useAppStore.getState().addDrawnArea({
      id,
      points: p.ring.map(([lng, lat]) => ({ lng, lat })),
      color: polyStrokeColor,
      fillColor: polyFillColor,
      fillOpacity: polyFillOpacity,
      label: `${name}\n面积 ${areaLabel} · 周长 ${perimLabel}`,
    });
    setPolyPending(null);
  }, [polyPending, polyAreaName, polyStrokeColor, polyFillColor, polyFillOpacity]);

  /* 初始化 MapLibre */
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const { style, transformStyle, zoom, ...mapOpts } = getMaplibreBaseMapOptions("main");
    const map = new maplibregl.Map({
      container: mapContainer.current,
      ...mapOpts,
      zoom,
      pitch: 0, bearing: 0,
      attributionControl: false,
    });
    map.setStyle(style, { transformStyle });

    /** style 变化后把图层面板 visibility 再写一遍（函数内逐图层 try-catch，无需守卫） */
    const applyPanelVisIfStyleLoaded = () => {
      applyLayerPanelVisibilityFromStore(map, useAppStore.getState());
    };
    map.on("styledata", applyPanelVisIfStyleLoaded);

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-left");
    map.on("mousemove", (e) =>
      useMapPointerStore.getState().setMouseCoords({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    );
    map.on("zoomend", () => setZoomLevel(Math.round(map.getZoom())));
    map.on("load", () => {
      /* `parseVectorLayersForPanel` → `setBasemapVectorInfo`：填充 `basemapVectorLayers` / `basemapVectorVisibility`（图层面板勾底图矢量子层） */
      try {
        const parsed = parseVectorLayersForPanel(map.getStyle());
        useAppStore.getState().setBasemapVectorInfo({
          name: parsed.styleName,
          layers: parsed.layers,
        });
      } catch (e) {
        console.warn("basemap style parse:", e);
      }

      /* 首帧 idle 后再应用 `layerVisibility` / `basemapVectorVisibility`，减轻 symbol 首帧闪烁 */
      map.once("idle", () => {
        applyLayerPanelVisibilityFromStore(map, useAppStore.getState());
      });

      const init = async () => {
        /* `loadResolvedAppConfig`：仅 fetch + 解析应用配置 JSON（模块内 Promise 单例），得到 `cameras` / `laserWeapons` / `tdoa`、`configAssetBase` 等；不包含与 zustand 的合并 */
        const appCfg = await loadResolvedAppConfig();
        /* `mergeDynamicAndStaticAssets`：以 `configAssetBase` 为底，再按 id 叠 `useAssetStore.assets`（同 id 以 store 为准；store 数据可来自 WS 或其它写入）；得到合并后的 `AssetData[]` */
        const mergedAssetData = mergeDynamicAndStaticAssets(
          appCfg.configAssetBase,
          useAssetStore.getState().assets,
        );
        const _assets = adaptAssets(mergedAssetData);

        const assetIconAccent: AssetDispositionIconAccent = appCfg.assetDispositionIconAccent ?? {};
        assetDispositionAccentRef.current = assetIconAccent;
        /* `map.addImage` 预注册各图层 `layout["icon-image"]` 用到的位图；`hasImage` 为真则跳过。并行加载以缩短首帧等待 */
        await Promise.all([
          /* 航迹点符号：空/海/潜 × 敌我中（`getAllMarkerSymbolKeys`），供 `TRACK_SYMBOL` 等 */
          ...getAllMarkerSymbolKeysForPrereg(appCfg.trackRendering).map(async ({ id, type, disposition, virtual, friendlyFill }) => {
            if (!map.hasImage(id)) {
              map.addImage(
                id,
                await loadSvgImage(buildMarkerSymbolDataUrl(type, disposition, assetIconAccent, virtual, friendlyFill), 64),
                { pixelRatio: 2 },
              );
            }
          }),
          /* 多选航迹高亮环（`TRACK_SELECT_RING_ID`）→ `HIGHLIGHT_LAYER` */
          (async () => {
            if (!map.hasImage(TRACK_SELECT_RING_ID)) map.addImage(TRACK_SELECT_RING_ID, await loadSvgImage(buildSelectionRingDataUrl(), 96), { pixelRatio: 2 });
          })(),
          /* 锁定目标锁定圈（`LOCK_ON_IMAGE_ID`）→ `LOCK_ON` */
          (async () => {
            if (!map.hasImage(LOCK_ON_IMAGE_ID)) map.addImage(LOCK_ON_IMAGE_ID, await loadSvgImage(buildLockOnDataUrl(), 128), { pixelRatio: 2 });
          })(),
          /* 五类站址图标全组合（`getAssetSymbolId` → `asset-{type}-…`），激光/TDOA 中心图标也走同一条路径 */
          ...getAllAssetSymbolKeysForPrereg(appCfg.configAssetBase).map(async ({ id, type, status, virtual, disposition, friendlyFill }) => {
            if (!map.hasImage(id)) {
              const src = await buildAssetSymbolDataUrl(type, status, virtual, disposition, assetIconAccent, friendlyFill);
              map.addImage(id, await loadSvgImage(src, 56), { pixelRatio: 2 });
            }
          }),
        ]);

        /* 限制区：`POLY_ZONES_SOURCE`（`polydraw2-zones-src`）；数据 `useZoneStore.zones`。标绘草稿为另一套：`POLY_DRAW_SOURCE`（`polydraw2-source`），由 `poly.initDraft()` 挂载，见 `polygon-draw-maplibre.ts` */
        const poly = new PolygonDrawMaplibre(map, {
          onComplete: (p) => {
            poly.deactivate();
            useMapMeasureUi.getState().setActiveDrawTool(null);
            setPolyAreaName("");
            setPolyStrokeColor(POLY_DIALOG_DEFAULT_STROKE);
            setPolyFillColor(POLY_DIALOG_DEFAULT_FILL);
            setPolyFillOpacity(POLY_DIALOG_DEFAULT_FILL_OPACITY);
            setPolyPending(p);
          },
        });
        polygonDrawRef.current = poly;
        poly.initCommittedZones();
        poly.setCommittedZones(useZoneStore.getState().zones);

        /* 航迹：source + 高亮环；专题层插在 `HIGHLIGHT_LAYER` 之下；符号层在雷达/光电之后安装 */
        const tracksMod = new TracksMaplibre(map);
        tracksMod.setTrackDispositionAccent(assetIconAccent);
        tracksMod.installSourceAndHighlight(useTrackStore.getState().tracks);
        tracksRef.current = tracksMod;

        /* 雷达：距离环、十字线、距离/角度/中心名标签、雷达站图标 */
        const radarCov = new RadarCoverageModule(map, { insertBeforeLayerId: HIGHLIGHT_LAYER });
        radarCov.install();
        radarCov.setAssetDispositionAccent(assetIconAccent);
        radarCov.setFromAssets(_assets, mergedAssetData);
        radarCovRef.current = radarCov;

        /* 光电 FOV 与相机中心图标；仅处理 camera，不含 tower（电侦） */
        const optoFov = new OptoelectronicFovModule(map, { insertBeforeLayerId: HIGHLIGHT_LAYER });
        optoFov.install();
        optoFov.setAssetDispositionAccent(assetIconAccent);
        optoFov.applyCamerasBundle(appCfg.cameras);
        optoFov.setFromAssets(_assets);
        optoFovRef.current = optoFov;

        /* 电侦（tower）：独立渲染模块，不与光电共用任何图层 */
        const towerMod = new TowerMaplibre(map, { insertBeforeLayerId: HIGHLIGHT_LAYER });
        towerMod.install();
        towerMod.setAssetDispositionAccent(assetIconAccent);
        towerMod.applyFovStyleFromBundle(appCfg.tower);
        towerMod.setFromAssets(_assets);
        towerModRef.current = towerMod;

        const airportStatic = new AirportStaticMaplibre(map, { insertBeforeLayerId: HIGHLIGHT_LAYER });
        airportStatic.install();
        airportStatic.setAssetDispositionAccent(assetIconAccent);
        airportStatic.applyAirportsBundle(appCfg.airports);
        airportStatic.setFromAssets(_assets);
        airportStaticRef.current = airportStatic;

        tracksMod.installSymbolLayers();
        tracksMod.applyTrackRenderingLayout();

        const dronesMod = new DronesMaplibre(map, { insertBeforeLayerId: LOCK_ON });
        await dronesMod.install(assetIconAccent);
        dronesMod.setStaticDroneSitesFromAssets(_assets, assetIconAccent);
        dronesMod.applyDronesSectorLabelStyle(appCfg.drones);
        dronesRef.current = dronesMod;

        /* 测距折线 / 折点 / 总长标签 */
        const dist = new DistanceMeasureMaplibre(map);
        dist.init();
        /* 测角：原点、正北参考、测量线、弧、角度与距离文字 */
        const angle = new AngleMeasureMaplibre(map);
        angle.init();
        /* 多边形标绘草稿（polydraw2-source，与限制区源分离） */
        poly.initDraft();
        /*
         * 激光 / TDOA 不并入上方 `OptoelectronicFovModule` / `buildFovGeoJSON` 的原因（几何虽同属扇形，产品能力不同）：
         * - 光电 FOV：静态多边形 + fill/line/label，数据为 `setFromAssets(_assets)` 的相机/塔类 `Asset`。
         * - 激光 / TDOA：`LaserMaplibre` / `TdoaMaplibre` 另有扫描亮带层（`geoSectorRingCoords`）、`setInterval` 按 tick 刷新、可选脉动；设备参数来自 `laserWeapons` / `tdoa` bundle，`upsert(LaserDevice)`，与 `cameras` 配置分离。
         * - 若强行塞进光电 FOV 同一条 GeoJSON，会与相机显隐、样式、定时器耦合，故独立 source / 模块。
         */
        const laser = new LaserMaplibre(map);
        laser.init();
        laser.setAssetDispositionAccent(assetIconAccent);
        laser.setSectorBorder(laserSectorBorderFromBundle(appCfg.laserWeapons));
        laser.setLabelStyle(laserLabelStyleFromBundle(appCfg.laserWeapons));
        laser.setLayerVisibility(sectorBundleToLaserLayerVis(appCfg.laserWeapons));
        { const ld = resolveLaserDefaults(appCfg.laserWeapons); laser.setDefaults(ld.sectorFillDefaultColor, ld.sectorFillDefaultOpacity); }
        for (const d of laserDevicesFromSectorBundle(appCfg.laserWeapons)) {
          laser.upsert(d);
        }
        /* TDOA：扇区与扫描等与激光同结构，独立 source */
        const tdoa = new TdoaMaplibre(map);
        tdoa.init();
        tdoa.setAssetDispositionAccent(assetIconAccent);
        tdoa.setSectorBorder(tdoaSectorBorderFromBundle(appCfg.tdoa));
        tdoa.setLabelStyle(tdoaLabelStyleFromBundle(appCfg.tdoa));
        tdoa.setLayerVisibility(sectorBundleToTdoaLayerVis(appCfg.tdoa));
        { const td = resolveTdoaDefaults(appCfg.tdoa); tdoa.setDefaults(td.sectorFillDefaultColor, td.sectorFillDefaultOpacity); }
        for (const d of tdoaDevicesFromSectorBundle(appCfg.tdoa)) {
          tdoa.upsert(d);
        }
        measureToolRefs.current = { dist, angle, poly, laser, tdoa };

        /* 从 factory.iconSize 配置覆盖所有资产中心图标的 zoom→size 插值 */
        if (appCfg.iconSizeStops) {
          const iconSizeExpr = buildIconSizeExpr(appCfg.iconSizeStops);
          const allIconLayers = [
            RADAR_ASSET_ICON_LAYER,
            OPTO_ASSET_ICON_LAYER,
            TOWER_ICON_LAYER,
            AIRPORT_ICON_LAYER,
            DRONES_STATIC_SYMBOL_LAYER,
            DRONES_SYMBOL_LAYER,
            LASER_CENTER,
            TDOA_CENTER,
          ];
          for (const lid of allIconLayers) {
            if (map.getLayer(lid)) {
              map.setLayoutProperty(lid, "icon-size", iconSizeExpr);
            }
          }
        }

        /* 测量面板与工具栏：切换测距 / 测角 / 多边形时互斥激活 */
        const measureHandlers: Map2DMeasureHandlers = {
          setDrawTool(tool) {
            dist.deactivate();
            angle.deactivate();
            poly.deactivate();
            if (tool === "distance") dist.activate();
            else if (tool === "angle") angle.activate();
            else if (tool === "polygon") poly.activate();
            useMapMeasureUi.getState().setActiveDrawTool(tool);
          },
        };
        registerMapMeasureHandlers(measureHandlers);

        /* 标牌：地图坐标 → 屏幕像素，供 TargetPlacard 定位 */
        const projectPlacard = (lng: number, lat: number) => {
          const p = map.project({ lng, lat });
          return { x: p.x, y: p.y };
        };
        const updatePlacardScreen = () => {
          const cur = placardRef.current;
          if (!cur) return;
          const { x, y } = projectPlacard(cur.lng, cur.lat);
          setPlacard((p) => (p ? { ...p, x, y } : p));
        };

        /* 点中航迹符号：仅在有有效要素时互斥清空资产并选中航迹（无效点击不执行分支，避免「return 后仍赋值」的阅读歧义） */
        map.on("click", TRACK_SYMBOL, (e) => {
          const f = e.features?.[0];
          const id = f?.properties?.id as string | undefined;
          if (id && f) {
            selectAssetRef.current(null);
            selectTrackRef.current(id);
            const c = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
            const { x, y } = projectPlacard(c[0], c[1]);
            setPlacard({ kind: "track", id, lng: c[0], lat: c[1], x, y });
          }
        });

        /* 悬停于航迹符号或资产点/符号层之一则 pointer 光标 */
        map.on("mousemove", (e) => {
          const onTrack = map.queryRenderedFeatures(e.point, { layers: [TRACK_SYMBOL] }).length > 0;
          if (onTrack) {
            map.getCanvas().style.cursor = "pointer";
            return;
          }
          const onAsset = map.queryRenderedFeatures(e.point, { layers: ASSET_POINT_PICK_LAYERS }).length > 0;
          map.getCanvas().style.cursor = onAsset ? "pointer" : "";
        });

        /*
         * 全局点击：未命中航迹符号时，再在点状资产层上拾取；
         * 若仍未命中有效资产 id，则关闭标牌、清空航迹/资产选中及多选高亮（属性框与列表选中联动 store）。
         */
        map.on("click", (e) => {
          if (map.queryRenderedFeatures(e.point, { layers: [TRACK_SYMBOL] }).length) return;
          const hits = map.queryRenderedFeatures(e.point, { layers: ASSET_POINT_PICK_LAYERS });
          const raw = hits[0];
          if (raw) {
            const id = assetIdFromPickFeature(raw);
            if (id) {
              selectTrackRef.current(null);
              selectAssetRef.current(id);
              const [lng, lat] = pickCoordsFromFeature(raw, e);
              const { x, y } = projectPlacard(lng, lat);
              setPlacard({ kind: "asset", id, lng, lat, x, y });
              return;
            }
          }
          setPlacard(null);
          selectTrackRef.current(null);
          selectAssetRef.current(null);
          useAppStore.getState().setHighlightedTrackIds([]);
        });

        /* 地图相机变化时重算标牌锚点的屏幕坐标 */
        const onMove = () => updatePlacardScreen();
        map.on("move", onMove);
        map.on("zoom", onMove);
        map.on("rotate", onMove);
        map.on("pitch", onMove);

        /* 同步当前缩放级别到 app-store */
        setZoomLevel(Math.round(map.getZoom()));

        /* init 内图层已加齐，再按 `layerVisibility` / `basemapVectorVisibility` 统一设 visibility */
        applyLayerPanelVisibilityFromStore(map, useAppStore.getState());
      };

      void init()
        .catch((err: unknown) => console.error("Map init failed:", err))
        .finally(() => {
          /* init 抛错时仍可能已改 style；补一次 apply */
          applyPanelVisIfStyleLoaded();
          map.once("idle", applyPanelVisIfStyleLoaded);
        });
    });

    mapRef.current = map;
    return () => {
      const tools = measureToolRefs.current;
      if (tools) {
        tools.dist.destroy();
        tools.angle.destroy();
        tools.poly.destroy();
        tools.laser.destroy();
        tools.tdoa.destroy();
        measureToolRefs.current = null;
      }
      registerMapMeasureHandlers(null);
      radarCovRef.current?.dispose();
      radarCovRef.current = null;
      airportStaticRef.current?.dispose();
      airportStaticRef.current = null;
      optoFovRef.current?.dispose();
      optoFovRef.current = null;
      towerModRef.current?.dispose();
      towerModRef.current = null;
      dronesRef.current?.dispose();
      dronesRef.current = null;
      tracksRef.current?.dispose();
      tracksRef.current = null;
      map.off("styledata", applyPanelVisIfStyleLoaded);
      map.remove();
      mapRef.current = null;
    };
  }, [setZoomLevel]);

  /* flyTo 订阅 */
  useEffect(() => {
    const unsub = useAppStore.subscribe((s) => {
      const req = s.flyToRequest;
      if (!req || req.seq === lastFlySeqRef.current) return;
      lastFlySeqRef.current = req.seq;
      mapRef.current?.flyTo({ center: [req.lng, req.lat], zoom: req.zoom ?? mapRef.current.getZoom(), duration: 1800, essential: true });
    });
    return unsub;
  }, []);

  /* 高亮 filter：highlightedTrackIds */
  useEffect(() => {
    const unsub = useAppStore.subscribe((s) => {
      tracksRef.current?.setHighlightFilter(s.highlightedTrackIds);
    });
    return unsub;
  }, []);

  /* 锁定圈：selectedTrackId */
  useEffect(() => {
    const unsub = useAppStore.subscribe((s) => {
      tracksRef.current?.setLockOnFilter(s.selectedTrackId);
    });
    return unsub;
  }, []);

  /**
   * 图层面板：监听 store 变化 → 同步 MapLibre 图层 visibility。
   * - style 已就绪时立即 apply 并更新签名；
   * - style 未就绪时标记 pending，在 `idle` 事件中补 apply，避免变更丢失。
   */
  useEffect(() => {
    let lastAppliedSig = "";
    let pending = false;
    let onIdle: (() => void) | null = null;

    const flush = () => {
      const map = mapRef.current;
      if (!map) return;
      const s = useAppStore.getState();
      const sig = layerPanelVisibilitySignature(s);
      if (sig === lastAppliedSig) { pending = false; return; }
      applyLayerPanelVisibilityFromStore(map, s);
      lastAppliedSig = sig;
      pending = false;
    };

    const sync = () => {
      const map = mapRef.current;
      if (!map) return;
      if (!map.isStyleLoaded()) {
        /* style 未就绪：标记 pending，等 idle 时补 apply */
        if (!pending) {
          pending = true;
          onIdle = () => { onIdle = null; flush(); };
          map.once("idle", onIdle);
        }
        return;
      }
      if (onIdle) { map.off("idle", onIdle); onIdle = null; }
      flush();
    };

    flush();
    return useAppStore.subscribe(sync);
  }, []);

  /* 同步 routeLines */
  useEffect(() => {
    const unsub = useAppStore.subscribe((s) => {
      const m = mapRef.current;
      if (!m?.isStyleLoaded()) return;
      const current = s.routeLines;
      const currentIds = new Set(current.map((r) => r.id));

      for (const oldId of routeIdsRef.current) {
        if (!currentIds.has(oldId)) {
          if (m.getLayer("route-layer-" + oldId)) m.removeLayer("route-layer-" + oldId);
          if (m.getSource("route-source-" + oldId)) m.removeSource("route-source-" + oldId);
        }
      }
      for (const route of current) {
        const sid = "route-source-" + route.id;
        if (m.getSource(sid)) continue;
        m.addSource(sid, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route.points.map((p) => [p.lng, p.lat]) } } });
        m.addLayer({ id: "route-layer-" + route.id, type: "line", source: sid, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": route.color, "line-width": 3, "line-opacity": 0.85, "line-dasharray": [2, 3] } }, HIGHLIGHT_LAYER);
      }
      routeIdsRef.current = [...currentIds];
    });
    return unsub;
  }, []);

  /*
   * `drawnAreas` → MapLibre：每个区域独立 GeoJSON source + fill/line/(可选)label。
   * 颜色：`DrawnArea` 字段在 `addLayer` 的 `paint` 中直接使用；不在此做主题或合法性校验。
   */
  useEffect(() => {
    const unsub = useAppStore.subscribe((s) => {
      const m = mapRef.current;
      if (!m?.isStyleLoaded()) return;
      const current = s.drawnAreas;
      const currentIds = new Set(current.map((a) => a.id));

      for (const oldId of areaIdsRef.current) {
        if (!currentIds.has(oldId)) {
          if (m.getLayer("area-fill-" + oldId)) m.removeLayer("area-fill-" + oldId);
          if (m.getLayer("area-line-" + oldId)) m.removeLayer("area-line-" + oldId);
          if (m.getLayer("area-label-" + oldId)) m.removeLayer("area-label-" + oldId);
          if (m.getSource("area-source-" + oldId)) m.removeSource("area-source-" + oldId);
        }
      }
      let didAddAreaLayers = false;
      for (const area of current) {
        const sid = "area-source-" + area.id;
        if (m.getSource(sid)) continue;
        didAddAreaLayers = true;
        const ring = [...area.points.map((p) => [p.lng, p.lat]), [area.points[0].lng, area.points[0].lat]];
        const pts = area.points.map((p) => [p.lng, p.lat] as [number, number]);
        const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        const features: GeoJSON.Feature[] = [
          {
            type: "Feature",
            properties: { _kind: "poly" },
            geometry: { type: "Polygon", coordinates: [ring] },
          },
        ];
        if (area.label) {
          features.push({
            type: "Feature",
            properties: { _kind: "lbl", labelText: area.label },
            geometry: { type: "Point", coordinates: [cx, cy] },
          });
        }
        m.addSource(sid, { type: "geojson", data: { type: "FeatureCollection", features } });
        m.addLayer(
          {
            id: "area-fill-" + area.id,
            type: "fill",
            source: sid,
            filter: ["==", ["get", "_kind"], "poly"],
            paint: { "fill-color": area.fillColor, "fill-opacity": area.fillOpacity },
          },
          HIGHLIGHT_LAYER
        );
        m.addLayer(
          {
            id: "area-line-" + area.id,
            type: "line",
            source: sid,
            filter: ["==", ["get", "_kind"], "poly"],
            paint: { "line-color": area.color, "line-width": 2, "line-opacity": 0.7, "line-dasharray": [4, 3] },
          },
          HIGHLIGHT_LAYER
        );
        if (area.label) {
          m.addLayer(
            {
              id: "area-label-" + area.id,
              type: "symbol",
              source: sid,
              filter: ["==", ["get", "_kind"], "lbl"],
              layout: {
                "text-field": ["get", "labelText"],
                "text-font": ["Open Sans Regular"],
                "text-size": 11,
                "text-allow-overlap": true,
                "text-ignore-placement": true,
                "text-optional": false,
              },
              paint: { "text-color": area.color, "text-halo-color": "#09090b", "text-halo-width": 1.5, "text-opacity": 0.9 },
            },
            HIGHLIGHT_LAYER
          );
        }
      }
      areaIdsRef.current = [...currentIds];
      if (didAddAreaLayers) applyLayerPanelVisibilityFromStore(m, useAppStore.getState());
    });
    return unsub;
  }, []);

  /**
   * 航迹：store 全量 → `TracksMaplibre.setTracks`（内建指纹可跳过相同数据的 `setData`；本处 rAF 合并同帧多次更新）
   */
  useEffect(() => {
    const flush = () => {
      tracksFlushRafRef.current = null;
      if (!tracksRef.current) return;
      tracksRef.current.setTracks(tracksPendingRef.current);
    };
    const unsub = useTrackStore.subscribe((s) => {
      tracksPendingRef.current = s.tracks;
      if (tracksFlushRafRef.current != null) return;
      tracksFlushRafRef.current = requestAnimationFrame(flush);
      // 标牌跟随选中航迹位置更新
      const cur = placardRef.current;
      if (cur?.kind === "track") {
        const t = s.tracks.find((tr) => tr.id === cur.id);
        if (t && (t.lng !== cur.lng || t.lat !== cur.lat)) {
          const map = mapRef.current;
          if (map) {
            const p = map.project({ lng: t.lng, lat: t.lat });
            setPlacard({ kind: "track", id: cur.id, lng: t.lng, lat: t.lat, x: p.x, y: p.y });
          }
        }
      }
    });
    return () => {
      unsub();
      if (tracksFlushRafRef.current != null) {
        cancelAnimationFrame(tracksFlushRafRef.current);
        tracksFlushRafRef.current = null;
      }
    };
  }, []);

  /* zone-store / asset-store → 地图：光电 FOV 扇区朝向/开角来自 `adaptAssets` 的 `heading`/`fovAngle`（`mergeDynamicAndStaticAssets` + WS 已合并进 store） */
  useEffect(() => {
    const unsubZ = useZoneStore.subscribe((s) => {
      polygonDrawRef.current?.setCommittedZones(s.zones);
    });
    const unsubA = useAssetStore.subscribe((s) => {
      const m = mapRef.current;
      if (!m?.isStyleLoaded()) return;
      const adapted = adaptAssets(s.assets);
      /* 雷达/光电/电侦/机场/无人机：由各专题模块 setFromAssets 驱动 */
      radarCovRef.current?.setFromAssets(adapted, s.assets);
      optoFovRef.current?.setFromAssets(adapted);
      towerModRef.current?.setFromAssets(adapted);
      airportStaticRef.current?.setFromAssets(adapted);
      dronesRef.current?.setStaticDroneSitesFromAssets(adapted, assetDispositionAccentRef.current);

      /* 激光/TDOA：从 asset-store 动态实体 upsert 进专题模块（静态 bundle 设备已在初始化时 upsert） */
      const tools = measureToolRefs.current;
      if (tools) {
        for (const a of adapted) {
          if (a.type === "laser") tools.laser.upsert(adaptAssetToLaserDevice(a));
          else if (a.type === "tdoa") tools.tdoa.upsert(adaptAssetToTdoaDevice(a));
        }
      }
    });
    return () => { unsubZ(); unsubA(); };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={mapContainer} className="h-full w-full" />
      {polyPending && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="poly-name-title">
          <div className="w-full max-w-sm rounded-lg border border-white/10 bg-[#141418] p-4 shadow-xl">
            <h2 id="poly-name-title" className="text-sm font-semibold text-nexus-text-primary">命名区域</h2>
            <p className="mt-1 text-xs text-nexus-text-muted">
              输入名称（可留空为默认）。下方可配置描边色、填充色与填充透明度（写入 `DrawnArea`：`color` / `fillColor` / `fillOpacity`）。
            </p>
            <input
              type="text"
              value={polyAreaName}
              onChange={(e) => setPolyAreaName(e.target.value)}
              className="mt-3 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-nexus-text-primary outline-none focus:border-nexus-border-accent"
              placeholder="区域名称"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitPolyArea();
                }
              }}
            />
            <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
              <p className="text-xs font-medium text-nexus-text-primary">区域颜色</p>
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs text-nexus-text-muted">
                <span>描边</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="描边颜色"
                    value={/^#[0-9a-fA-F]{6}$/.test(polyStrokeColor) ? polyStrokeColor : POLY_DIALOG_DEFAULT_STROKE}
                    onChange={(e) => setPolyStrokeColor(e.target.value.toLowerCase())}
                    className="h-9 w-12 cursor-pointer rounded border border-white/10 bg-[#0c0c0e] p-0.5"
                  />
                  <code className="truncate text-[11px] text-nexus-text-muted">{polyStrokeColor}</code>
                </div>
                <span>填充</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="填充颜色"
                    value={/^#[0-9a-fA-F]{6}$/.test(polyFillColor) ? polyFillColor : POLY_DIALOG_DEFAULT_FILL}
                    onChange={(e) => setPolyFillColor(e.target.value.toLowerCase())}
                    className="h-9 w-12 cursor-pointer rounded border border-white/10 bg-[#0c0c0e] p-0.5"
                  />
                  <code className="truncate text-[11px] text-nexus-text-muted">{polyFillColor}</code>
                </div>
                <span className="self-center">填充透明度</span>
                <div className="flex min-w-0 items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={0.95}
                    step={0.05}
                    value={polyFillOpacity}
                    onChange={(e) => setPolyFillOpacity(Number(e.target.value))}
                    className="min-w-0 flex-1 accent-nexus-accent-glow"
                    aria-label="填充透明度"
                  />
                  <span className="w-10 shrink-0 tabular-nums text-nexus-text-primary">{polyFillOpacity.toFixed(2)}</span>
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-xs text-nexus-text-muted hover:bg-white/5"
                onClick={() => setPolyPending(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-md bg-nexus-accent-glow/30 px-3 py-1.5 text-xs font-medium text-nexus-text-primary hover:bg-nexus-accent-glow/50"
                onClick={() => commitPolyArea()}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
      {placard && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+14px)]"
          style={{ left: placard.x, top: placard.y }}
        >
          <TargetPlacard
            kind={placard.kind}
            id={placard.id}
            onClose={() => setPlacard(null)}
            className="pointer-events-auto"
          />
          <div
            className="pointer-events-none absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-[10px] border-t-[12px] border-x-transparent border-t-[#0c0c0e]/95"
            aria-hidden="true"
          />
        </div>
      )}
      <style jsx global>{`
        .nexus-popup .maplibregl-popup-content {
          background: rgba(17, 17, 19, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 6px;
          padding: 8px 12px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
        }
        .nexus-popup .maplibregl-popup-tip {
          border-top-color: rgba(17, 17, 19, 0.95);
        }
        .maplibregl-ctrl-group {
          background: rgba(17, 17, 19, 0.9) !important;
          border: 1px solid rgba(255, 255, 255, 0.06) !important;
          border-radius: 6px !important;
          backdrop-filter: blur(8px);
        }
        .maplibregl-ctrl-group button {
          border-color: rgba(255, 255, 255, 0.06) !important;
        }
        .maplibregl-ctrl-group button + button {
          border-top: 1px solid rgba(255, 255, 255, 0.06) !important;
        }
        .maplibregl-ctrl-group button .maplibregl-ctrl-icon {
          filter: invert(0.5);
        }
        .maplibregl-ctrl-group button:hover .maplibregl-ctrl-icon {
          filter: invert(0.8);
        }
      `}</style>
    </div>
  );
}
