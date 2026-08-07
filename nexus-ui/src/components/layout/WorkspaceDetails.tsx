"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "@/stores/app-store";
import { useAssetStore } from "@/stores/asset-store";
import { useTrackStore } from "@/stores/track-store";
import { useAlertStore } from "@/stores/alert-store";
import { isHighThreatAlert } from "@/lib/alarm-threat-level";
import { cn } from "@/lib/utils";
import {
  buildDataLayerPanelRows,
  LYR_DB_AREAS,
  LYR_DRONES,
  LYR_OPTO_FOV,
  LYR_RADAR_COVERAGE,
} from "@/lib/map-entity-model";
import { useDbAreaStore } from "@/stores/db-area-store";
import { useMapGisCameraMenuStore } from "@/stores/map-gis-camera-menu-store";
import { useOptoDeviceLayerStore } from "@/stores/opto-device-layer-store";
import { useDroneDeviceLayerStore } from "@/stores/drone-device-layer-store";
import { useDroneStore } from "@/stores/drone-store";
import { useEoDroneDdsStatusStore } from "@/stores/eo-drone-dds-status-store";
import { formatEoDdsDroneTaskLine, shouldForceIdleAfterDockReturn } from "@/lib/eo-video/formatEoDdsTaskOverlay";
import { resolveWsDroneInDock } from "@/lib/eo-video/resolveWsDroneInDock";
import { openElectroOpticalDockPopup } from "@/components/eo-video/EoVideoTopLauncher";
import { countDbAreaPanelUiRows, countVisibleDbAreaLeaves, countVisibleDbAreaTargetLeaves } from "@/lib/db-area-panel-helpers";
import { isDbAreaTargetListable } from "@/lib/db-area-target-geometry";
import { useDbAreaTargetStore } from "@/stores/db-area-target-store";
import { countOptoDevicePanelUiRows, countVisibleOptoDeviceLeaves } from "@/lib/opto-device-layer-visibility";
import {
  countDroneDevicePanelUiRows,
  countVisibleDroneDeviceLeaves,
} from "@/lib/drone-device-layer-visibility";
import {
  countRadarDevicePanelUiRows,
  countVisibleRadarDeviceLeaves,
} from "@/lib/radar-device-layer-visibility";
import {
  countTargetLayerPanelUiRows,
  countVisibleTargetLayerLeaves,
  type AirFusionSubtypeVisibility,
  type TrackSubtypeVisibility,
} from "@/lib/track-layer-visibility";
import { useTrackDisplayStore } from "@/stores/track-display-store";
import { useRadarDeviceLayerStore } from "@/stores/radar-device-layer-store";
import { collectMapGisDroneRowsSync, mapGisDroneSyncSignature } from "@/lib/map-gis-drone-rows";
import type { AreaTableRow } from "@/lib/area-table-geometry";
import { getMapMeasureHandlers, useMapMeasureUi } from "@/stores/map-measure-bridge";
import { AreaDrawSetupDialog } from "@/components/map/AreaDrawDialogs";
import { useAreaDrawStore } from "@/stores/area-draw-store";
import {
  MapPin,
  BarChart3,
  Layers,
  Filter,
  Download,
  Share,
  Package,
  ClipboardList,
  Route,
  Search,
  Pentagon,
  Ruler,
  DraftingCompass,
  Plane,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { QuickWorkflowModal } from "@/components/layout/QuickWorkflowModal";
import {
  applyGisCapabilityPreset,
  applyGisTrackQuickPresets,
  clearGisCapabilitySweeps,
  type GisTrackQuickFlags,
} from "@/lib/gis-situation-presets";

type StatRow = {
  label: string;
  value: string;
  icon: LucideIcon;
  color: string;
  /** 态势「活跃无人机」：可点击弹出列表 */
  interactive?: "active-drones";
};

type GisQuickMode = {
  capability: boolean;
  seaRadar: boolean;
  seaFusion: boolean;
  airFusion: boolean;
};

const GIS_QUICK_INITIAL: GisQuickMode = {
  capability: false,
  seaRadar: false,
  seaFusion: false,
  airFusion: false,
};

type ActiveDroneListItem = {
  entityId: string;
  name: string;
  taskLine: string;
};

function resolveDroneDisplayName(entityId: string): string {
  const ds = useDroneStore.getState();
  const sn = ds.entityIdToDeviceSn[entityId]?.trim();
  if (sn) {
    const name = ds.drones[sn]?.displayName?.trim();
    if (name) return name;
  }
  const direct = ds.drones[entityId]?.displayName?.trim();
  if (direct) return direct;
  return entityId;
}

function collectActiveDroneListItems(
  byEntityId: Record<string, { droneTaskAction?: unknown; droneState?: unknown }>,
  hadLeftDockByEntityId: Record<string, boolean>,
): ActiveDroneListItem[] {
  const items: ActiveDroneListItem[] = [];
  for (const [entityId, row] of Object.entries(byEntityId)) {
    const droneInDock = resolveWsDroneInDock(entityId);
    const hadLeftDock = Boolean(hadLeftDockByEntityId[entityId]);
    if (shouldForceIdleAfterDockReturn(droneInDock, hadLeftDock)) continue;
    const taskLine = formatEoDdsDroneTaskLine(row, { droneInDock, hadLeftDock });
    if (taskLine === "空闲中") continue;
    items.push({
      entityId,
      name: resolveDroneDisplayName(entityId),
      taskLine,
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  return items;
}

/**
 * 图层面板「已开启」项数量（与 `LayerPanel` 的 enabledCount 一致）：
 * 地图（含矢量子层）+ 目标图层 + 实体图层 + 区域图层。
 */
function countLayerPanelEnabled(
  assets: ReadonlyArray<{ asset_type: string }>,
  cameraMenuIds: ReadonlyArray<string>,
  layerVisibility: Record<string, boolean>,
  basemapGroupVisible: boolean,
  basemapVectorLayers: ReadonlyArray<{ id: string }>,
  basemapVectorVisibility: Record<string, boolean>,
  basemapRasterLayers: ReadonlyArray<{ id: string }>,
  basemapRasterVisibility: Record<string, boolean>,
  trackSubtypeVisible: TrackSubtypeVisibility,
  airFusionSubtypeVisible: AirFusionSubtypeVisibility,
  dbAreaRows: ReadonlyArray<AreaTableRow>,
  dbAreaVisibility: Readonly<Record<string, boolean>>,
  dbAreaTargetRows: ReadonlyArray<{
    id: string;
    area_type: number;
    target_id: number;
    area_name: string;
    start_point?: string | null;
    end_point?: string | null;
    area_rect?: string | null;
    area_points?: string | null;
  }>,
  dbAreaTargetVisibility: Readonly<Record<string, boolean>>,
  optoDeviceVisibility: Readonly<Record<string, { fov?: boolean; icon?: boolean }>>,
  droneDeviceVisibility: Readonly<Record<string, { position?: boolean; route?: boolean }>>,
  dronePanelRows: ReadonlyArray<{ sn: string; airportSN: string }>,
  radarDeviceVisibility: Readonly<Record<string, { icon?: boolean; capability?: boolean }>>,
  radarPanelIds: ReadonlyArray<string>,
): number {
  const rows = buildDataLayerPanelRows(assets);
  let n = rows.filter((r) => layerVisibility[r.id] !== false).length;
  if (basemapGroupVisible) {
    n += 1;
    n += basemapVectorLayers.filter((l) => basemapVectorVisibility[l.id] !== false).length;
  }
  n += basemapRasterLayers.filter((l) => basemapRasterVisibility[l.id] !== false).length;
  n += countVisibleTargetLayerLeaves(
    layerVisibility["lyr-tracks"] !== false,
    trackSubtypeVisible,
    airFusionSubtypeVisible,
  );
  n += countVisibleDbAreaLeaves(dbAreaRows, dbAreaVisibility, layerVisibility[LYR_DB_AREAS] !== false);
  n += countVisibleDbAreaTargetLeaves(
    dbAreaTargetRows,
    dbAreaTargetVisibility,
    layerVisibility[LYR_DB_AREAS] !== false,
  );
  n += countVisibleOptoDeviceLeaves(
    cameraMenuIds,
    optoDeviceVisibility,
    layerVisibility[LYR_OPTO_FOV] !== false,
  );
  n += countVisibleDroneDeviceLeaves(
    dronePanelRows,
    droneDeviceVisibility,
    layerVisibility[LYR_DRONES] !== false,
  );
  n += countVisibleRadarDeviceLeaves(
    radarPanelIds,
    radarDeviceVisibility,
    layerVisibility[LYR_RADAR_COVERAGE] !== false,
  );
  return n;
}

/** 图层面板可管理项总数（与左侧 `LayerPanel` 列表行数一致） */
function countLayerPanelLoaded(
  assets: ReadonlyArray<{ asset_type: string }>,
  basemapVectorLayers: ReadonlyArray<{ id: string }>,
  dbAreaRows: ReadonlyArray<AreaTableRow>,
  dbAreaTargetRows: ReadonlyArray<{
    id: string;
    area_type: number;
    target_id?: number;
    area_name?: string;
    start_point?: string | null;
    end_point?: string | null;
    area_rect?: string | null;
    area_points?: string | null;
  }>,
  cameraMenuIds: ReadonlyArray<string>,
  dronePanelRows: ReadonlyArray<{ sn: string; airportSN: string }>,
  radarPanelIds: ReadonlyArray<string>,
): number {
  const rows = buildDataLayerPanelRows(assets);
  const dbUi = countDbAreaPanelUiRows(dbAreaRows);
  const fixedListable = dbAreaTargetRows.filter(isDbAreaTargetListable).length;
  const fixedUi = fixedListable > 0 ? 1 + fixedListable : 0;
  const optoUi = rows.some((r) => r.id === LYR_OPTO_FOV)
    ? countOptoDevicePanelUiRows(cameraMenuIds.length)
    : 0;
  const droneUi = rows.some((r) => r.id === LYR_DRONES)
    ? countDroneDevicePanelUiRows(dronePanelRows)
    : 0;
  const radarUi = rows.some((r) => r.id === LYR_RADAR_COVERAGE)
    ? countRadarDevicePanelUiRows(radarPanelIds.length)
    : 0;
  return (
    1 +
    basemapVectorLayers.length +
    countTargetLayerPanelUiRows() +
    rows.length +
    dbUi +
    fixedUi +
    optoUi +
    droneUi +
    radarUi
  );
}

// 工作区详情配置
const WORKSPACE_CONFIGS = {
  situation: {
    title: "态势工作区",
    description: "战场态势监控与分析",
    statistics: [
      { label: "跟踪航迹", value: "0", icon: Route, color: "text-green-400" },
      { label: "告警事件", value: "0", icon: BarChart3, color: "text-orange-400" },
    ] as StatRow[],
    tools: [],
  },
  assets: {
    title: "资产工作区",
    description: "物资装备管理与追踪",
    statistics: [
      { label: "装备总数", value: "0", icon: Package, color: "text-blue-400" },
      { label: "待分配", value: "0", icon: MapPin, color: "text-yellow-400" },
      { label: "已部署", value: "0", icon: BarChart3, color: "text-green-400" },
      { label: "待维护", value: "0", icon: Layers, color: "text-red-400" },
    ] as StatRow[],
    tools: [
      { id: "inventory", label: "库存", icon: Layers },
      { id: "track", label: "追踪", icon: Route },
      { id: "schedule", label: "调度", icon: Search },
      { id: "report", label: "报表", icon: BarChart3 },
      { id: "allocate", label: "分配", icon: Share }
    ]
  },
  tasks: {
    title: "任务工作区",
    description: "任务规划与执行监控",
    statistics: [
      { label: "任务总数", value: "7", icon: ClipboardList, color: "text-blue-400" },
      { label: "进行中", value: "3", icon: MapPin, color: "text-orange-400" },
      { label: "已完成", value: "4", icon: BarChart3, color: "text-green-400" },
      { label: "延期", value: "1", icon: Layers, color: "text-red-400" }
    ],
    tools: [
      { id: "plan", label: "规划", icon: Layers },
      { id: "schedule", label: "排期", icon: Route },
      { id: "monitor", label: "监控", icon: Search },
      { id: "report", label: "报告", icon: BarChart3 },
      { id: "archive", label: "归档", icon: Download }
    ]
  },
  layers: {
    title: "图层工作区",
    description: "地理图层管理与显示",
    statistics: [
      { label: "加载图层", value: "0", icon: Layers, color: "text-blue-400" },
      { label: "可见图层", value: "0", icon: MapPin, color: "text-green-400" },
      { label: "标记点", value: "0", icon: BarChart3, color: "text-purple-400" },
      { label: "绘制对象", value: "0", icon: Route, color: "text-orange-400" },
    ] as StatRow[],
    tools: [
      { id: "add", label: "添加", icon: Layers },
      { id: "hide", label: "隐藏", icon: Search },
      { id: "opacity", label: "透明度", icon: Filter },
      { id: "styles", label: "样式", icon: BarChart3 },
      { id: "export", label: "导出", icon: Download }
    ]
  },
  analytics: {
    title: "分析工作区",
    description: "数据分析与可视化",
    statistics: [
      { label: "数据集", value: "24", icon: BarChart3, color: "text-blue-400" },
      { label: "分析任务", value: "5", icon: MapPin, color: "text-orange-400" },
      { label: "模型", value: "3", icon: Layers, color: "text-green-400" },
      { label: "报表", value: "12", icon: Route, color: "text-purple-400" }
    ],
    tools: [
      { id: "visualize", label: "可视化", icon: BarChart3 },
      { id: "model", label: "模型", icon: Layers },
      { id: "export", label: "导出", icon: Download },
      { id: "settings", label: "设置", icon: Filter }
    ]
  },
  search: {
    title: "搜索工作区",
    description: "全局搜索功能",
    statistics: [
      { label: "搜索历史", value: "48", icon: Search, color: "text-blue-400" },
      { label: "收藏", value: "12", icon: MapPin, color: "text-yellow-400" },
      { label: "结果", value: "156", icon: BarChart3, color: "text-green-400" },
      { label: "分类", value: "7", icon: Layers, color: "text-purple-400" }
    ],
    tools: [
      { id: "advanced", label: "高级", icon: Layers },
      { id: "filter", label: "筛选", icon: Filter },
      { id: "save", label: "保存", icon: Download },
      { id: "share", label: "共享", icon: Share },
      { id: "clear", label: "清除", icon: Search }
    ]
  },
  settings: {
    title: "设置工作区",
    description: "系统设置与配置",
    statistics: [
      { label: "用户", value: "24", icon: MapPin, color: "text-blue-400" },
      { label: "角色", value: "5", icon: BarChart3, color: "text-green-400" },
      { label: "权限", value: "18", icon: Layers, color: "text-orange-400" },
      { label: "配置", value: "8", icon: Route, color: "text-purple-400" }
    ],
    tools: [
      { id: "users", label: "用户", icon: MapPin },
      { id: "roles", label: "角色", icon: BarChart3 },
      { id: "permissions", label: "权限", icon: Layers },
      { id: "preferences", label: "偏好", icon: Route },
      { id: "backup", label: "备份", icon: Download }
    ]
  }
};

const situationToolBtn =
  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors border border-transparent";

export function WorkspaceDetails() {
  const topTab = useAppStore((s) => s.topTab);
  const assets = useAssetStore((s) => s.assets);
  const tracks = useTrackStore((s) => s.tracks);
  const alerts = useAlertStore((s) => s.alerts);
  const layerVisibility = useAppStore((s) => s.layerVisibility);
  const basemapGroupVisible = useAppStore((s) => s.basemapGroupVisible);
  const basemapVectorLayers = useAppStore((s) => s.basemapVectorLayers);
  const basemapVectorVisibility = useAppStore((s) => s.basemapVectorVisibility);
  const basemapRasterLayers = useAppStore((s) => s.basemapRasterLayers);
  const basemapRasterVisibility = useAppStore((s) => s.basemapRasterVisibility);
  const routeLines = useAppStore((s) => s.routeLines);
  const dbAreaRows = useDbAreaStore((s) => s.rows);
  const dbAreaVisibility = useDbAreaStore((s) => s.areaVisibility);
  const dbAreaTargetRows = useDbAreaTargetStore((s) => s.rows);
  const dbAreaTargetVisibility = useDbAreaTargetStore((s) => s.targetVisibility);
  const optoDeviceVisibility = useOptoDeviceLayerStore((s) => s.deviceVisibility);
  const droneDeviceVisibility = useDroneDeviceLayerStore((s) => s.deviceVisibility);
  const cameraMenuRows = useMapGisCameraMenuStore((s) => s.rows);
  const ensureCameraMenuRows = useMapGisCameraMenuStore((s) => s.ensureLoaded);
  const cameraMenuIds = useMemo(() => cameraMenuRows.map((r) => r.entityId), [cameraMenuRows]);
  const droneStoreDrones = useDroneStore((s) => s.drones);
  const droneToAirport = useDroneStore((s) => s.droneToAirport);
  const droneRelationships = useDroneStore((s) => s.relationships);
  const assetDroneSig = useMemo(() => mapGisDroneSyncSignature(assets), [assets]);
  const dronePanelRows = useMemo(
    () => collectMapGisDroneRowsSync(),
    [droneStoreDrones, droneToAirport, droneRelationships, assetDroneSig],
  );
  const radarDeviceVisibility = useRadarDeviceLayerStore((s) => s.deviceVisibility);
  const trackSubtypeVisible = useTrackDisplayStore((s) => s.trackSubtypeVisible);
  const airFusionSubtypeVisible = useTrackDisplayStore((s) => s.airFusionSubtypeVisible);
  const radarPanelIds = useMemo(
    () =>
      assets
        .filter((a) => a.asset_type === "radar")
        .map((a) => a.id)
        .sort(),
    [assets],
  );

  useEffect(() => {
    if (!buildDataLayerPanelRows(assets).some((r) => r.id === LYR_OPTO_FOV)) return;
    void ensureCameraMenuRows();
  }, [assets, ensureCameraMenuRows]);

  /** 快捷工作流弹窗状态 */
  const [quickWorkflowOpen, setQuickWorkflowOpen] = useState(false);
  const [activeDronesOpen, setActiveDronesOpen] = useState(false);
  const [gisQuick, setGisQuick] = useState<GisQuickMode>(GIS_QUICK_INITIAL);
  const activeDronesBtnRef = useRef<HTMLButtonElement>(null);
  const activeDronesMenuRef = useRef<HTMLDivElement>(null);
  const [activeDronesAnchor, setActiveDronesAnchor] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

  const droneTaskByEntityId = useEoDroneDdsStatusStore((s) => s.byEntityId);
  const hadLeftDockByEntityId = useEoDroneDdsStatusStore((s) => s.hadLeftDockByEntityId);
  const droneDocks = useDroneStore((s) => s.docks);
  const activeDroneItems = useMemo(
    () => collectActiveDroneListItems(droneTaskByEntityId, hadLeftDockByEntityId),
    [droneTaskByEntityId, hadLeftDockByEntityId, droneStoreDrones, droneToAirport, droneDocks],
  );

  useEffect(() => {
    if (!activeDronesOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (activeDronesBtnRef.current?.contains(t)) return;
      if (activeDronesMenuRef.current?.contains(t)) return;
      setActiveDronesOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveDronesOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [activeDronesOpen]);

  useEffect(() => {
    if (!activeDronesOpen) return;
    const el = activeDronesBtnRef.current;
    if (!el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      setActiveDronesAnchor({
        left: Math.max(8, r.left),
        top: r.bottom + 4,
        width: Math.max(240, r.width),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [activeDronesOpen]);

  const situationLiveStats = useMemo((): StatRow[] => {
    return [
      { label: "跟踪航迹", value: String(tracks.length), icon: Route, color: "text-green-400" },
      { label: "告警事件", value: String(alerts.filter(isHighThreatAlert).length), icon: BarChart3, color: "text-orange-400" },
      {
        label: "活跃无人机",
        value: String(activeDroneItems.length),
        icon: Plane,
        color: "text-cyan-400",
        interactive: "active-drones",
      },
    ];
  }, [tracks, alerts, activeDroneItems]);

  const applyTrackQuick = useCallback(
    (flags: GisTrackQuickFlags) => {
      applyGisTrackQuickPresets(flags, {
        cameraIds: cameraMenuIds,
        radarIds: radarPanelIds,
      });
    },
    [cameraMenuIds, radarPanelIds],
  );

  const applyCapabilityQuick = useCallback(() => {
    applyGisCapabilityPreset({
      assets,
      cameraIds: cameraMenuIds,
      droneSns: dronePanelRows.map((r) => r.sn),
    });
  }, [assets, cameraMenuIds, dronePanelRows]);

  const clearCapabilityQuick = useCallback(() => {
    clearGisCapabilitySweeps(cameraMenuIds, radarPanelIds);
  }, [cameraMenuIds, radarPanelIds]);

  /** 能力模式下雷达在线态变化时同步显隐（避免离线站仍留图标/扫描） */
  const radarOnlineSig = useMemo(
    () =>
      assets
        .filter((a) => a.asset_type === "radar")
        .map((a) => `${a.id}:${String(a.status ?? "").toLowerCase()}`)
        .sort()
        .join("|"),
    [assets],
  );

  useEffect(() => {
    if (!gisQuick.capability) return;
    applyCapabilityQuick();
  }, [gisQuick.capability, radarOnlineSig, applyCapabilityQuick]);

  const onGisQuickCapability = () => {
    if (gisQuick.capability) {
      clearCapabilityQuick();
      setGisQuick((prev) => ({ ...prev, capability: false }));
      return;
    }
    applyCapabilityQuick();
    setGisQuick({ capability: true, seaRadar: false, seaFusion: false, airFusion: false });
  };

  const onGisQuickTrack = (key: keyof GisTrackQuickFlags) => {
    const nextFlags: GisTrackQuickFlags = {
      seaRadar: key === "seaRadar" ? !gisQuick.seaRadar : gisQuick.seaRadar,
      seaFusion: key === "seaFusion" ? !gisQuick.seaFusion : gisQuick.seaFusion,
      airFusion: key === "airFusion" ? !gisQuick.airFusion : gisQuick.airFusion,
    };
    applyTrackQuick(nextFlags);
    setGisQuick({ capability: false, ...nextFlags });
  };

  const assetsLiveStats = useMemo((): StatRow[] => {
    const total = assets.length;
    const pending = assets.filter(
      (a) => a.mission_status === "idle" || a.mission_status === "assigned",
    ).length;
    const deployed = assets.filter(
      (a) =>
        a.status === "online" &&
        (a.mission_status === "monitoring" ||
          a.mission_status === "en_route" ||
          a.mission_status === "returning"),
    ).length;
    const maint = assets.filter((a) => a.status === "degraded" || a.status === "offline").length;
    return [
      { label: "装备总数", value: String(total), icon: Package, color: "text-blue-400" },
      { label: "待分配", value: String(pending), icon: MapPin, color: "text-yellow-400" },
      { label: "已部署", value: String(deployed), icon: BarChart3, color: "text-green-400" },
      { label: "待维护", value: String(maint), icon: Layers, color: "text-red-400" },
    ];
  }, [assets]);

  const layersLiveStats = useMemo((): StatRow[] => {
    const loaded = countLayerPanelLoaded(
      assets,
      basemapVectorLayers,
      dbAreaRows,
      dbAreaTargetRows,
      cameraMenuIds,
      dronePanelRows,
      radarPanelIds,
    );
    const visible = countLayerPanelEnabled(
      assets,
      cameraMenuIds,
      layerVisibility,
      basemapGroupVisible,
      basemapVectorLayers,
      basemapVectorVisibility,
      basemapRasterLayers,
      basemapRasterVisibility,
      trackSubtypeVisible,
      airFusionSubtypeVisible,
      dbAreaRows,
      dbAreaVisibility,
      dbAreaTargetRows,
      dbAreaTargetVisibility,
      optoDeviceVisibility,
      droneDeviceVisibility,
      dronePanelRows,
      radarDeviceVisibility,
      radarPanelIds,
    );
    const markers = tracks.length + assets.length;
    const drawings = routeLines.length;
    return [
      { label: "加载图层", value: String(loaded), icon: Layers, color: "text-blue-400" },
      { label: "可见图层", value: String(visible), icon: MapPin, color: "text-green-400" },
      { label: "标记点", value: String(markers), icon: BarChart3, color: "text-purple-400" },
      { label: "绘制对象", value: String(drawings), icon: Route, color: "text-orange-400" },
    ];
  }, [
    assets,
    tracks,
    basemapVectorLayers,
    layerVisibility,
    basemapGroupVisible,
    basemapVectorVisibility,
    basemapRasterLayers,
    basemapRasterVisibility,
    trackSubtypeVisible,
    airFusionSubtypeVisible,
    routeLines,
    dbAreaRows,
    dbAreaVisibility,
    dbAreaTargetRows,
    dbAreaTargetVisibility,
    optoDeviceVisibility,
    droneDeviceVisibility,
    cameraMenuIds,
    dronePanelRows,
    radarDeviceVisibility,
    radarPanelIds,
  ]);

  const config = WORKSPACE_CONFIGS[topTab];
  const measureUi = useMapMeasureUi();
  const areaDrawing = useAreaDrawStore((s) => s.drawing);
  const [areaSetupOpen, setAreaSetupOpen] = useState(false);

  if (!config) return null;

  const statistics: StatRow[] =
    topTab === "situation"
      ? situationLiveStats
      : topTab === "assets"
        ? assetsLiveStats
        : topTab === "layers"
          ? layersLiveStats
          : config.statistics;

  const h = () => getMapMeasureHandlers();

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-t border-nexus-border" style={{ backgroundColor: '#212126' }}>
      {/* 左侧：标题和统计信息 */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-nexus-accent/20">
            <h3 className="text-sm font-bold text-nexus-accent">{topTab[0].toUpperCase()}</h3>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-nexus-text-primary">{config.title}</h3>
            <p className="text-xs text-nexus-text-muted">{config.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {statistics.map((stat, index) => {
            const Icon = stat.icon;
            if (stat.interactive === "active-drones") {
              return (
                <button
                  key={index}
                  ref={activeDronesBtnRef}
                  type="button"
                  title="查看当前活跃无人机并打开光电窗口"
                  className={cn(
                    "flex items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors",
                    "hover:bg-nexus-bg-elevated",
                    activeDronesOpen && "bg-nexus-accent-glow/15",
                  )}
                  onClick={() => setActiveDronesOpen((v) => !v)}
                >
                  <Icon size={16} className={stat.color} />
                  <div className="flex flex-col text-left">
                    <span className="text-xs font-medium text-nexus-text-primary">{stat.label}</span>
                    <span className="text-xs font-bold">{stat.value}</span>
                  </div>
                </button>
              );
            }
            return (
              <div key={index} className="flex items-center gap-2">
                <Icon size={16} className={stat.color} />
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-nexus-text-primary">{stat.label}</span>
                  <span className="text-xs font-bold">{stat.value}</span>
                </div>
              </div>
            );
          })}

          {topTab === "situation" ? (
            <div className="flex items-center gap-1.5 border-l border-nexus-border/80 pl-4">
              {(
                [
                  {
                    id: "capability" as const,
                    label: "能力",
                    title: "隐藏航迹；仅显示在线雷达图标与能力扫描，以及 camera_001 / camera_004 能力（可再次点击取消）",
                    checked: gisQuick.capability,
                    onClick: onGisQuickCapability,
                  },
                  {
                    id: "seaRadar" as const,
                    label: "对海雷达",
                    title: "显示远遥码头与靖子头雷达航迹",
                    checked: gisQuick.seaRadar,
                    onClick: () => onGisQuickTrack("seaRadar"),
                  },
                  {
                    id: "seaFusion" as const,
                    label: "对海融合",
                    title: "显示对海融合航迹",
                    checked: gisQuick.seaFusion,
                    onClick: () => onGisQuickTrack("seaFusion"),
                  },
                  {
                    id: "airFusion" as const,
                    label: "对空融合",
                    title: "显示对空融合航迹",
                    checked: gisQuick.airFusion,
                    onClick: () => onGisQuickTrack("airFusion"),
                  },
                ] as const
              ).map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  title={btn.title}
                  aria-pressed={btn.checked}
                  onClick={btn.onClick}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    btn.checked
                      ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-200"
                      : "border-nexus-border bg-nexus-bg-surface/60 text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-secondary",
                  )}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {topTab === "situation" && (
          <>
            <button
              type="button"
              title="区域标绘：区域/航线写入 area_table，固定目标写入 area_table_target；右键取消"
              className={cn(
                situationToolBtn,
                measureUi.activeDrawTool === "area" || areaDrawing
                  ? "border-nexus-border-accent bg-nexus-accent-glow/25 text-nexus-text-primary"
                  : "text-nexus-text-secondary hover:bg-nexus-bg-elevated hover:text-nexus-text-primary",
              )}
              onClick={() => {
                if (measureUi.activeDrawTool === "area" || areaDrawing) {
                  getMapMeasureHandlers()?.cancelAreaDraw?.();
                  useAreaDrawStore.getState().reset();
                  useMapMeasureUi.getState().setActiveDrawTool(null);
                  setAreaSetupOpen(false);
                  return;
                }
                setAreaSetupOpen(true);
              }}
            >
              <Pentagon size={14} />
              区域
            </button>
            <AreaDrawSetupDialog open={areaSetupOpen} onClose={() => setAreaSetupOpen(false)} />
            <button
              type="button"
              title="距离量算：左键加点，右键清空，双击结束"
              className={cn(
                situationToolBtn,
                measureUi.activeDrawTool === "distance"
                  ? "border-nexus-border-accent bg-nexus-accent-glow/25 text-nexus-text-primary"
                  : "text-nexus-text-secondary hover:bg-nexus-bg-elevated hover:text-nexus-text-primary",
              )}
              onClick={() => {
                const on = measureUi.activeDrawTool === "distance";
                h()?.setDrawTool(on ? null : "distance");
              }}
            >
              <Ruler size={14} />
              量算
            </button>
            <button
              type="button"
              title="角度量算：左键设原点，移动鼠标实时显示方位（正北 0°）与距离，再点左键结束；右键清空"
              className={cn(
                situationToolBtn,
                measureUi.activeDrawTool === "angle"
                  ? "border-nexus-border-accent bg-nexus-accent-glow/25 text-nexus-text-primary"
                  : "text-nexus-text-secondary hover:bg-nexus-bg-elevated hover:text-nexus-text-primary",
              )}
              onClick={() => {
                const on = measureUi.activeDrawTool === "angle";
                h()?.setDrawTool(on ? null : "angle");
              }}
            >
              <DraftingCompass size={14} />
              角度
            </button>
            {config.tools.length > 0 ? (
              <span className="hidden h-4 w-px bg-white/10 sm:inline-block" aria-hidden />
            ) : null}
          </>
        )}
        {config.tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-nexus-text-secondary transition-colors hover:bg-nexus-bg-elevated hover:text-nexus-text-primary"
            onClick={() => {
              // 任务→规划：点击打开快捷工作流弹窗
              if (topTab === "tasks" && tool.id === "plan") {
                setQuickWorkflowOpen(true);
              }
            }}
          >
            <tool.icon size={14} />
            {tool.label}
          </button>
        ))}
      </div>

      <QuickWorkflowModal open={quickWorkflowOpen} onClose={() => setQuickWorkflowOpen(false)} />

      {activeDronesOpen &&
        activeDronesAnchor &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={activeDronesMenuRef}
            role="listbox"
            aria-label="活跃无人机"
            className="fixed z-[10050] max-h-72 overflow-y-auto rounded-md border border-nexus-border bg-[#212126] shadow-xl"
            style={{
              left: activeDronesAnchor.left,
              top: activeDronesAnchor.top,
              minWidth: activeDronesAnchor.width,
              maxWidth: 360,
            }}
          >
            {activeDroneItems.length === 0 ? (
              <div className="px-3 py-3 text-xs text-nexus-text-muted">暂无活跃无人机</div>
            ) : (
              activeDroneItems.map((item) => (
                <button
                  key={item.entityId}
                  type="button"
                  role="option"
                  className="flex w-full flex-col gap-0.5 border-b border-nexus-border/60 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-nexus-accent-glow/10"
                  onClick={() => {
                    setActiveDronesOpen(false);
                    openElectroOpticalDockPopup({ mainStreamId: `uav:${item.entityId}` });
                  }}
                >
                  <span className="text-xs font-medium text-nexus-text-primary">{item.name}</span>
                  <span className="text-[11px] text-cyan-400/90">{item.taskLine}</span>
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
