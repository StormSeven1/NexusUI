"use client";

/**
 * 图层面板：地图（含矢量子层）、目标图层、实体图层、区域图层。
 * 树形显隐行与 `PanelVisibilityTree` 统一缩进与样式。
 */

import {
  buildDataLayerPanelRows,
  LYR_DB_AREAS,
  LYR_DRONES,
  LYR_OPTO_FOV,
  LYR_RADAR_COVERAGE,
  LYR_TRACKS,
} from "@/lib/map-entity-model";
import {
  countVisibleTargetLayerLeaves,
  getTrackLayerKeysOrdered,
  trackSubtypeLabel,
} from "@/lib/track-layer-visibility";
import {
  collectTargetLayerLeafFlags,
  fuseAirSubtypeVisibility,
  targetLayerMasterVisibility,
  trackSubtypeVisibilityState,
} from "@/lib/layer-panel-target-visibility";
import {
  aggregatePanelVisibility,
  parentToggleTurnOn,
  syncEntityLayerMasterFromDeviceLeaves,
  syncMasterOffWhenAllLeavesOff,
  visibilityFromBoolean,
  type PanelTreeVisibilityState,
} from "@/lib/panel-tree-visibility";
import { useTrackDisplayStore } from "@/stores/track-display-store";
import { useMapGisCameraMenuStore } from "@/stores/map-gis-camera-menu-store";
import {
  countVisibleOptoDeviceLeaves,
  isOptoDeviceCapabilityVisible,
  isOptoDeviceFovVisible,
  isOptoDeviceIconVisible,
} from "@/lib/opto-device-layer-visibility";
import {
  countVisibleDroneDeviceLeaves,
  isDroneDeviceAirportVisible,
  isDroneDevicePositionVisible,
  isDroneDeviceRouteVisible,
} from "@/lib/drone-device-layer-visibility";
import {
  countVisibleRadarDeviceLeaves,
  isRadarDeviceCapabilityVisible,
  isRadarDeviceIconVisible,
} from "@/lib/radar-device-layer-visibility";
import { useOptoDeviceLayerStore } from "@/stores/opto-device-layer-store";
import { useDroneDeviceLayerStore } from "@/stores/drone-device-layer-store";
import { useRadarDeviceLayerStore } from "@/stores/radar-device-layer-store";
import { useAssetStore } from "@/stores/asset-store";
import {
  VECTOR_LAYER_GROUP_LABELS,
  type VectorLayerPanelItem,
} from "@/lib/map-2d-basemap-layer-panel";
import { useAppStore, isLayerPanelDynamicExpanded } from "@/stores/app-store";
import { useDbAreaStore } from "@/stores/db-area-store";
import { useDbAreaTargetStore } from "@/stores/db-area-target-store";
import { dbAreaVisibilityKey } from "@/lib/area-table-geometry";
import { mapAreaFallbackLabel } from "@/lib/area-table-serialize";
import { countVisibleDbAreaLeaves, countVisibleDbAreaTargetLeaves, isDbAreaListable, isDbAreaLeafVisible, syncDbAreaLayerMasterFromLeaves } from "@/lib/db-area-panel-helpers";
import {
  dbAreaTargetVisibilityKey,
  isDbAreaTargetLeafVisible,
  isDbAreaTargetListable,
} from "@/lib/db-area-target-geometry";
import { refetchDbAreaTargets } from "@/lib/refetch-db-area-targets";
import { collectMapGisDroneRowsSync, isStandaloneMapGisDrone, mapGisDroneSyncSignature } from "@/lib/map-gis-drone-rows";
import { useDroneStore } from "@/stores/drone-store";
import {
  PanelTreeBranchRow,
  PanelTreeGroup,
  PanelTreeToggleRow,
  panelTreePaddingLeft,
} from "@/components/panels/PanelVisibilityTree";
import {
  ChevronDown,
  ChevronRight,
  Map as MapIcon,
  Database,
  FolderTree,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";

export function LayerPanel() {
  const assets = useAssetStore((s) => s.assets);
  const layerVisibility = useAppStore((s) => s.layerVisibility);
  const toggleLayerVisibility = useAppStore((s) => s.toggleLayerVisibility);
  const setLayerVisibility = useAppStore((s) => s.setLayerVisibility);

  const basemapStyleName = useAppStore((s) => s.basemapStyleName);
  const basemapVectorLayers = useAppStore((s) => s.basemapVectorLayers);
  const basemapGroupVisible = useAppStore((s) => s.basemapGroupVisible);
  const basemapVectorVisibility = useAppStore((s) => s.basemapVectorVisibility);
  const basemapRasterLayers = useAppStore((s) => s.basemapRasterLayers);
  const basemapRasterVisibility = useAppStore((s) => s.basemapRasterVisibility);
  const setBasemapGroupVisible = useAppStore((s) => s.setBasemapGroupVisible);
  const setBasemapVectorLayersVisible = useAppStore((s) => s.setBasemapVectorLayersVisible);
  const toggleBasemapVectorLayer = useAppStore((s) => s.toggleBasemapVectorLayer);
  const toggleBasemapRasterLayer = useAppStore((s) => s.toggleBasemapRasterLayer);

  const dataPanelRows = useMemo(() => buildDataLayerPanelRows(assets), [assets]);

  const dbAreaRows = useDbAreaStore((s) => s.rows);
  const dbAreaVisibility = useDbAreaStore((s) => s.areaVisibility);
  const setGroupAllAreasVisible = useDbAreaStore((s) => s.setGroupAllAreasVisible);
  const setAllDrawableAreasVisible = useDbAreaStore((s) => s.setAllDrawableAreasVisible);
  const setAreaVisible = useDbAreaStore((s) => s.setAreaVisible);
  const dbAreaTargetRows = useDbAreaTargetStore((s) => s.rows);
  const dbAreaTargetVisibility = useDbAreaTargetStore((s) => s.targetVisibility);
  const setTargetVisible = useDbAreaTargetStore((s) => s.setTargetVisible);
  const setAllTargetsVisible = useDbAreaTargetStore((s) => s.setAllTargetsVisible);

  const optoDeviceVisibility = useOptoDeviceLayerStore((s) => s.deviceVisibility);
  const toggleOptoDeviceFov = useOptoDeviceLayerStore((s) => s.toggleDeviceFov);
  const toggleOptoDeviceIcon = useOptoDeviceLayerStore((s) => s.toggleDeviceIcon);
  const toggleOptoDeviceCapability = useOptoDeviceLayerStore((s) => s.toggleDeviceCapability);
  const setOptoDeviceAllVisible = useOptoDeviceLayerStore((s) => s.setDeviceAllVisible);
  const droneDeviceVisibility = useDroneDeviceLayerStore((s) => s.deviceVisibility);
  const toggleDroneDevicePosition = useDroneDeviceLayerStore((s) => s.toggleDevicePosition);
  const toggleDroneDeviceRoute = useDroneDeviceLayerStore((s) => s.toggleDeviceRoute);
  const toggleDroneDeviceAirport = useDroneDeviceLayerStore((s) => s.toggleDeviceAirport);
  const setDroneDeviceAllVisible = useDroneDeviceLayerStore((s) => s.setDeviceAllVisible);
  const syncDroneDeviceSns = useDroneDeviceLayerStore((s) => s.syncDroneSns);
  const radarDeviceVisibility = useRadarDeviceLayerStore((s) => s.deviceVisibility);
  const toggleRadarDeviceIcon = useRadarDeviceLayerStore((s) => s.toggleDeviceIcon);
  const toggleRadarDeviceCapability = useRadarDeviceLayerStore((s) => s.toggleDeviceCapability);
  const setRadarDeviceAllVisible = useRadarDeviceLayerStore((s) => s.setDeviceAllVisible);
  const syncRadarDeviceIds = useRadarDeviceLayerStore((s) => s.syncRadarIds);
  const cameraMenuRows = useMapGisCameraMenuStore((s) => s.rows);
  const cameraMenuLoading = useMapGisCameraMenuStore((s) => s.loading);
  const cameraMenuLoaded = useMapGisCameraMenuStore((s) => s.loaded);
  const ensureCameraMenuRows = useMapGisCameraMenuStore((s) => s.ensureLoaded);

  const hasOptoLayerRow = useMemo(
    () => dataPanelRows.some((r) => r.id === LYR_OPTO_FOV),
    [dataPanelRows],
  );

  const hasDroneLayerRow = useMemo(
    () => dataPanelRows.some((r) => r.id === LYR_DRONES),
    [dataPanelRows],
  );

  const hasRadarLayerRow = useMemo(
    () => dataPanelRows.some((r) => r.id === LYR_RADAR_COVERAGE),
    [dataPanelRows],
  );

  const radarPanelDevices = useMemo(
    () =>
      assets
        .filter((a) => a.asset_type === "radar")
        .map((a) => ({ id: a.id, label: (a.name || "").trim() || a.id }))
        .sort((a, b) => a.label.localeCompare(b.label, "zh-CN")),
    [assets],
  );

  const droneStoreDrones = useDroneStore((s) => s.drones);
  const droneToAirport = useDroneStore((s) => s.droneToAirport);
  const droneRelationships = useDroneStore((s) => s.relationships);
  const assetDroneSig = useMemo(() => mapGisDroneSyncSignature(assets), [assets]);

  const dronePanelDevices = useMemo(
    () => collectMapGisDroneRowsSync(),
    [droneStoreDrones, droneToAirport, droneRelationships, assetDroneSig],
  );

  const airportNameById = useMemo(() => {
    const m = new globalThis.Map<string, string>();
    for (const a of assets) {
      if (a.asset_type !== "airport") continue;
      const id = String(a.id ?? "").trim();
      if (!id) continue;
      m.set(id, (a.name || "").trim() || id);
    }
    return m;
  }, [assets]);

  const optoCameraDevices = useMemo(
    () => cameraMenuRows.map((r) => ({ id: r.entityId, label: r.label })),
    [cameraMenuRows],
  );

  const layersData = dataPanelRows.map((l) => ({
    ...l,
    visible: layerVisibility[l.id] ?? true,
  }));

  const vectorByGroup = useMemo(() => {
    const m = new globalThis.Map<string, VectorLayerPanelItem[]>();
    for (const item of basemapVectorLayers) {
      const arr = m.get(item.group) ?? [];
      arr.push(item);
      m.set(item.group, arr);
    }
    return m;
  }, [basemapVectorLayers]);

  const groupKeys = useMemo(
    () => [...new Set(basemapVectorLayers.map((l) => l.group))],
    [basemapVectorLayers],
  );

  const trackSubtypeVisible = useTrackDisplayStore((s) => s.trackSubtypeVisible);
  const airFusionSubtypeVisible = useTrackDisplayStore((s) => s.airFusionSubtypeVisible);
  const toggleAirFusionSubtype = useTrackDisplayStore((s) => s.toggleAirFusionSubtype);
  const setAllTrackSubtypesVisible = useTrackDisplayStore((s) => s.setAllTrackSubtypesVisible);
  const setTrackSubtypeVisible = useTrackDisplayStore((s) => s.setTrackSubtypeVisible);
  const setAirFusionSubtypesVisible = useTrackDisplayStore((s) => s.setAirFusionSubtypesVisible);

  const layerPanelExpand = useAppStore((s) => s.layerPanelExpand);
  const toggleLayerPanelSection = useAppStore((s) => s.toggleLayerPanelSection);
  const toggleLayerPanelBranch = useAppStore((s) => s.toggleLayerPanelBranch);
  const toggleLayerPanelDynamic = useAppStore((s) => s.toggleLayerPanelDynamic);

  const openBasemap = layerPanelExpand.sections.basemap;
  const openBasemapStyle = layerPanelExpand.branches.basemapStyle;
  const openTargetSection = layerPanelExpand.sections.target;
  const openTargetTree = layerPanelExpand.branches.targetTree;
  const openEntityLayers = layerPanelExpand.sections.entity;
  const openDbAreaSection = layerPanelExpand.sections.dbArea;
  const openDbAreaTree = layerPanelExpand.branches.dbAreaTree;
  const openOptoTree = layerPanelExpand.branches.optoTree;
  const openDroneTree = layerPanelExpand.branches.droneTree;
  const openRadarTree = layerPanelExpand.branches.radarTree;

  const tracksMasterOn = layerVisibility[LYR_TRACKS] !== false;
  const optoMasterOn = layerVisibility[LYR_OPTO_FOV] !== false;
  const droneMasterOn = layerVisibility[LYR_DRONES] !== false;
  const radarMasterOn = layerVisibility[LYR_RADAR_COVERAGE] !== false;
  const dbAreaMasterOn = layerVisibility[LYR_DB_AREAS] !== false;

  useEffect(() => {
    if (!hasOptoLayerRow) return;
    void ensureCameraMenuRows();
  }, [hasOptoLayerRow, ensureCameraMenuRows]);

  useEffect(() => {
    if (!hasDroneLayerRow) return;
    syncDroneDeviceSns(dronePanelDevices.map((d) => d.sn));
  }, [hasDroneLayerRow, dronePanelDevices, syncDroneDeviceSns]);

  useEffect(() => {
    if (!hasRadarLayerRow) return;
    syncRadarDeviceIds(radarPanelDevices.map((d) => d.id));
  }, [hasRadarLayerRow, radarPanelDevices, syncRadarDeviceIds]);

  /** 子项全关时同步关闭母节点；不因子项缺省 true 自动打开母开关（刷新后保留用户记忆） */
  useEffect(() => {
    if (basemapVectorLayers.length === 0) return;
    const anyVector = basemapVectorLayers.some((l) => basemapVectorVisibility[l.id] !== false);
    syncMasterOffWhenAllLeavesOff(basemapGroupVisible, anyVector, setBasemapGroupVisible);
  }, [basemapVectorLayers, basemapVectorVisibility, basemapGroupVisible, setBasemapGroupVisible]);

  useEffect(() => {
    const flags = collectTargetLayerLeafFlags(true, trackSubtypeVisible, airFusionSubtypeVisible);
    const anyOn = flags.some(Boolean);
    // 与区域图层一致：有子项开 → 开母开关；全关 → 关母开关。
    // 否则「全部目标」关后点开单个子项时，母开关仍关，地图过滤为空，且 UI 因母关显示为关。
    if (anyOn && !tracksMasterOn) {
      setLayerVisibility(LYR_TRACKS, true);
    } else {
      syncMasterOffWhenAllLeavesOff(tracksMasterOn, anyOn, (on) =>
        setLayerVisibility(LYR_TRACKS, on),
      );
    }
  }, [
    trackSubtypeVisible,
    airFusionSubtypeVisible,
    tracksMasterOn,
    setLayerVisibility,
  ]);

  useEffect(() => {
    if (!hasRadarLayerRow) return;
    syncEntityLayerMasterFromDeviceLeaves(
      radarPanelDevices.length > 0,
      radarMasterOn,
      radarPanelDevices.map((d) => d.id),
      radarDeviceVisibility,
      (id) =>
        isRadarDeviceIconVisible(id, radarDeviceVisibility) ||
        isRadarDeviceCapabilityVisible(id, radarDeviceVisibility),
      (on) => setLayerVisibility(LYR_RADAR_COVERAGE, on),
    );
  }, [
    hasRadarLayerRow,
    radarPanelDevices,
    radarDeviceVisibility,
    radarMasterOn,
    setLayerVisibility,
  ]);

  useEffect(() => {
    if (!hasDroneLayerRow) return;
    syncEntityLayerMasterFromDeviceLeaves(
      dronePanelDevices.length > 0,
      droneMasterOn,
      dronePanelDevices.map((d) => d.sn),
      droneDeviceVisibility,
      (sn) => {
        const dev = dronePanelDevices.find((d) => d.sn === sn);
        if (!dev) return false;
        return (
          isDroneDevicePositionVisible(sn, droneDeviceVisibility) ||
          isDroneDeviceRouteVisible(sn, droneDeviceVisibility) ||
          (dev.airportSN.trim() !== "" && isDroneDeviceAirportVisible(sn, droneDeviceVisibility))
        );
      },
      (on) => setLayerVisibility(LYR_DRONES, on),
    );
  }, [
    hasDroneLayerRow,
    dronePanelDevices,
    droneDeviceVisibility,
    droneMasterOn,
    setLayerVisibility,
  ]);

  useEffect(() => {
    if (!hasOptoLayerRow) return;
    syncEntityLayerMasterFromDeviceLeaves(
      cameraMenuLoaded,
      optoMasterOn,
      optoCameraDevices.map((d) => d.id),
      optoDeviceVisibility,
      (id) =>
        isOptoDeviceFovVisible(id, optoDeviceVisibility) ||
        isOptoDeviceIconVisible(id, optoDeviceVisibility) ||
        isOptoDeviceCapabilityVisible(id, optoDeviceVisibility),
      (on) => setLayerVisibility(LYR_OPTO_FOV, on),
    );
  }, [
    hasOptoLayerRow,
    cameraMenuLoaded,
    optoCameraDevices,
    optoDeviceVisibility,
    optoMasterOn,
    setLayerVisibility,
  ]);

  useEffect(() => {
    if (!openDbAreaSection) return;
    void refetchDbAreaTargets();
  }, [openDbAreaSection]);

  useEffect(() => {
    syncDbAreaLayerMasterFromLeaves(
      dbAreaMasterOn,
      dbAreaRows,
      dbAreaVisibility,
      (on) => setLayerVisibility(LYR_DB_AREAS, on),
      dbAreaTargetRows,
      dbAreaTargetVisibility,
    );
  }, [
    dbAreaRows,
    dbAreaVisibility,
    dbAreaTargetRows,
    dbAreaTargetVisibility,
    dbAreaMasterOn,
    setLayerVisibility,
  ]);

  const toggleVectorGroup = useCallback(
    (gk: string) => toggleLayerPanelDynamic("vectorGroup", gk),
    [toggleLayerPanelDynamic],
  );

  const toggleDbGroupOpen = useCallback(
    (gid: number) => toggleLayerPanelDynamic("dbGroup", String(gid)),
    [toggleLayerPanelDynamic],
  );

  const dbAreaGroups = useMemo(() => {
    const m = new globalThis.Map<number, typeof dbAreaRows>();
    for (const r of dbAreaRows) {
      if (!isDbAreaListable(r)) continue;
      const arr = m.get(r.group_id) ?? [];
      arr.push(r);
      m.set(r.group_id, arr);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [dbAreaRows]);

  const groupAreaVisibility = useCallback(
    (groupId: number) => {
      const list = dbAreaRows.filter((r) => r.group_id === groupId && isDbAreaListable(r));
      if (list.length === 0) return "all" as const;
      const flags = list.map((r) =>
        isDbAreaLeafVisible(r.group_id, r.area_id, dbAreaVisibility),
      );
      return aggregatePanelVisibility(flags);
    },
    [dbAreaRows, dbAreaVisibility],
  );

  const dbAreaMasterVisibility = useMemo(() => {
    const areaFlags = dbAreaRows
      .filter(isDbAreaListable)
      .map((r) => isDbAreaLeafVisible(r.group_id, r.area_id, dbAreaVisibility));
    const targetFlags = dbAreaTargetRows
      .filter(isDbAreaTargetListable)
      .map((r) => isDbAreaTargetLeafVisible(r.id, dbAreaTargetVisibility));
    return aggregatePanelVisibility([...areaFlags, ...targetFlags]);
  }, [dbAreaRows, dbAreaVisibility, dbAreaTargetRows, dbAreaTargetVisibility]);

  const fixedTargetGroupVisibility = useMemo(() => {
    const list = dbAreaTargetRows.filter(isDbAreaTargetListable);
    if (list.length === 0) return "all" as const;
    return aggregatePanelVisibility(
      list.map((r) => isDbAreaTargetLeafVisible(r.id, dbAreaTargetVisibility)),
    );
  }, [dbAreaTargetRows, dbAreaTargetVisibility]);

  const basemapLocalVisibility = useMemo(() => {
    const vectorFlags = basemapVectorLayers.map(
      (l) => basemapVectorVisibility[l.id] !== false,
    );
    return aggregatePanelVisibility(
      basemapVectorLayers.length === 0 ? [basemapGroupVisible] : [basemapGroupVisible, ...vectorFlags],
    );
  }, [basemapGroupVisible, basemapVectorLayers, basemapVectorVisibility]);

  const targetMasterVisibility = useMemo(
    () => targetLayerMasterVisibility(tracksMasterOn, trackSubtypeVisible, airFusionSubtypeVisible),
    [tracksMasterOn, trackSubtypeVisible, airFusionSubtypeVisible],
  );

  const toggleBasemapLocalVisibility = useCallback(() => {
    const turnOn = parentToggleTurnOn(basemapLocalVisibility);
    setBasemapGroupVisible(turnOn);
    setBasemapVectorLayersVisible(turnOn);
  }, [basemapLocalVisibility, setBasemapGroupVisible, setBasemapVectorLayersVisible]);

  const vectorGroupVisibility = useCallback(
    (gk: string) => {
      const items = vectorByGroup.get(gk) ?? [];
      if (items.length === 0) return "all" as const;
      const flags = items.map((l) => basemapVectorVisibility[l.id] !== false);
      return aggregatePanelVisibility(flags);
    },
    [vectorByGroup, basemapVectorVisibility],
  );

  const toggleVectorGroupVisibility = useCallback(
    (gk: string) => {
      const items = vectorByGroup.get(gk) ?? [];
      const state = vectorGroupVisibility(gk);
      const turnOn = parentToggleTurnOn(state);
      setBasemapVectorLayersVisible(
        turnOn,
        items.map((l) => l.id),
      );
      if (turnOn) setBasemapGroupVisible(true);
    },
    [vectorByGroup, vectorGroupVisibility, setBasemapVectorLayersVisible, setBasemapGroupVisible],
  );

  const toggleTargetMasterVisibility = useCallback(() => {
    const turnOn = parentToggleTurnOn(targetMasterVisibility);
    if (turnOn) {
      // 先开母开关再开子项，避免「子项全 false」时被 sync 立刻关掉母开关
      setLayerVisibility(LYR_TRACKS, true);
      setAllTrackSubtypesVisible(true);
    } else {
      // 先关子项再关母开关，避免 sync「有子项开→强开母开关」把关闭冲掉
      setAllTrackSubtypesVisible(false);
      setLayerVisibility(LYR_TRACKS, false);
    }
  }, [targetMasterVisibility, setLayerVisibility, setAllTrackSubtypesVisible]);

  const radarLayerVisibility = useMemo(() => {
    const flags: boolean[] = [];
    for (const dev of radarPanelDevices) {
      flags.push(isRadarDeviceIconVisible(dev.id, radarDeviceVisibility));
      flags.push(isRadarDeviceCapabilityVisible(dev.id, radarDeviceVisibility));
    }
    return aggregatePanelVisibility(flags.length > 0 ? flags : [true]);
  }, [radarPanelDevices, radarDeviceVisibility]);

  const droneLayerVisibility = useMemo(() => {
    const flags: boolean[] = [];
    for (const dev of dronePanelDevices) {
      flags.push(isDroneDevicePositionVisible(dev.sn, droneDeviceVisibility));
      flags.push(isDroneDeviceRouteVisible(dev.sn, droneDeviceVisibility));
      if (dev.airportSN.trim()) {
        flags.push(isDroneDeviceAirportVisible(dev.sn, droneDeviceVisibility));
      }
    }
    return aggregatePanelVisibility(flags.length > 0 ? flags : [true]);
  }, [dronePanelDevices, droneDeviceVisibility]);

  const optoLayerVisibility = useMemo(() => {
    const flags: boolean[] = [];
    for (const dev of optoCameraDevices) {
      flags.push(isOptoDeviceFovVisible(dev.id, optoDeviceVisibility));
      flags.push(isOptoDeviceIconVisible(dev.id, optoDeviceVisibility));
      flags.push(isOptoDeviceCapabilityVisible(dev.id, optoDeviceVisibility));
    }
    return aggregatePanelVisibility(flags.length > 0 ? flags : [true]);
  }, [optoCameraDevices, optoDeviceVisibility]);

  const toggleEntityLayerVisibility = useCallback(
    (layerId: string, state: ReturnType<typeof aggregatePanelVisibility>) => {
      const turnOn = parentToggleTurnOn(state);
      setLayerVisibility(layerId, turnOn);
      if (layerId === LYR_RADAR_COVERAGE) {
        for (const dev of radarPanelDevices) setRadarDeviceAllVisible(dev.id, turnOn);
      } else if (layerId === LYR_DRONES) {
        for (const dev of dronePanelDevices) setDroneDeviceAllVisible(dev.sn, turnOn);
      } else if (layerId === LYR_OPTO_FOV) {
        for (const dev of optoCameraDevices) setOptoDeviceAllVisible(dev.id, turnOn);
      }
    },
    [
      setLayerVisibility,
      radarPanelDevices,
      setRadarDeviceAllVisible,
      dronePanelDevices,
      setDroneDeviceAllVisible,
      optoCameraDevices,
      setOptoDeviceAllVisible,
    ],
  );

  const radarDeviceVisibilityState = useCallback(
    (devId: string) =>
      aggregatePanelVisibility([
        isRadarDeviceIconVisible(devId, radarDeviceVisibility),
        isRadarDeviceCapabilityVisible(devId, radarDeviceVisibility),
      ]),
    [radarDeviceVisibility],
  );

  const droneDeviceVisibilityState = useCallback(
    (dev: (typeof dronePanelDevices)[number]) => {
      const flags = [
        isDroneDevicePositionVisible(dev.sn, droneDeviceVisibility),
        isDroneDeviceRouteVisible(dev.sn, droneDeviceVisibility),
      ];
      if (dev.airportSN.trim()) {
        flags.push(isDroneDeviceAirportVisible(dev.sn, droneDeviceVisibility));
      }
      return aggregatePanelVisibility(flags);
    },
    [droneDeviceVisibility],
  );

  const optoDeviceVisibilityState = useCallback(
    (devId: string) =>
      aggregatePanelVisibility([
        isOptoDeviceFovVisible(devId, optoDeviceVisibility),
        isOptoDeviceIconVisible(devId, optoDeviceVisibility),
        isOptoDeviceCapabilityVisible(devId, optoDeviceVisibility),
      ]),
    [optoDeviceVisibility],
  );

  const toggleDbAreaMasterVisibility = useCallback(() => {
    const turnOn = parentToggleTurnOn(dbAreaMasterVisibility);
    setLayerVisibility(LYR_DB_AREAS, turnOn);
    setAllDrawableAreasVisible(turnOn);
    setAllTargetsVisible(turnOn);
  }, [
    dbAreaMasterVisibility,
    setLayerVisibility,
    setAllDrawableAreasVisible,
    setAllTargetsVisible,
  ]);

  const toggleDbAreaGroupVisibility = useCallback(
    (groupId: number, gVis: PanelTreeVisibilityState) => {
      const turnOn = parentToggleTurnOn(gVis);
      setGroupAllAreasVisible(groupId, turnOn);
      if (turnOn && !dbAreaMasterOn) setLayerVisibility(LYR_DB_AREAS, true);
    },
    [setGroupAllAreasVisible, dbAreaMasterOn, setLayerVisibility],
  );

  const toggleDbAreaLeafVisibility = useCallback(
    (groupId: number, areaId: number, currentlyVisible: boolean) => {
      const next = !currentlyVisible;
      setAreaVisible(groupId, areaId, next);
      if (next && !dbAreaMasterOn) setLayerVisibility(LYR_DB_AREAS, true);
    },
    [setAreaVisible, dbAreaMasterOn, setLayerVisibility],
  );

  const toggleFixedTargetGroupVisibility = useCallback(() => {
    const turnOn = parentToggleTurnOn(fixedTargetGroupVisibility);
    setAllTargetsVisible(turnOn);
    if (turnOn && !dbAreaMasterOn) setLayerVisibility(LYR_DB_AREAS, true);
  }, [fixedTargetGroupVisibility, setAllTargetsVisible, dbAreaMasterOn, setLayerVisibility]);

  const toggleFixedTargetLeafVisibility = useCallback(
    (id: string, currentlyVisible: boolean) => {
      const next = !currentlyVisible;
      setTargetVisible(id, next);
      if (next && !dbAreaMasterOn) setLayerVisibility(LYR_DB_AREAS, true);
    },
    [setTargetVisible, dbAreaMasterOn, setLayerVisibility],
  );

  const groupDisplayName = useCallback(
    (groupId: number) => {
      const first = dbAreaRows.find((r) => r.group_id === groupId);
      const gn = first?.group_name != null ? String(first.group_name).trim() : "";
      return gn || `组别 ${groupId}`;
    },
    [dbAreaRows],
  );

  const enabledCount = useMemo(() => {
    let n = layersData.filter((l) => l.visible).length;
    if (basemapGroupVisible) {
      n += 1;
      n += basemapVectorLayers.filter((l) => basemapVectorVisibility[l.id] !== false).length;
    }
    n += basemapRasterLayers.filter((l) => basemapRasterVisibility[l.id] !== false).length;
    n += countVisibleTargetLayerLeaves(
      tracksMasterOn,
      trackSubtypeVisible,
      airFusionSubtypeVisible,
    );
    n += countVisibleDbAreaLeaves(dbAreaRows, dbAreaVisibility, dbAreaMasterOn);
    n += countVisibleDbAreaTargetLeaves(
      dbAreaTargetRows,
      dbAreaTargetVisibility,
      dbAreaMasterOn,
    );
    n += countVisibleOptoDeviceLeaves(
      optoCameraDevices.map((c) => c.id),
      optoDeviceVisibility,
      optoMasterOn,
    );
    n += countVisibleDroneDeviceLeaves(
      dronePanelDevices,
      droneDeviceVisibility,
      droneMasterOn,
    );
    n += countVisibleRadarDeviceLeaves(
      radarPanelDevices.map((d) => d.id),
      radarDeviceVisibility,
      radarMasterOn,
    );
    return n;
  }, [
    layersData,
    basemapGroupVisible,
    basemapVectorLayers,
    basemapVectorVisibility,
    basemapRasterLayers,
    basemapRasterVisibility,
    tracksMasterOn,
    trackSubtypeVisible,
    airFusionSubtypeVisible,
    dbAreaRows,
    dbAreaVisibility,
    dbAreaTargetRows,
    dbAreaTargetVisibility,
    dbAreaMasterOn,
    optoCameraDevices,
    optoDeviceVisibility,
    optoMasterOn,
    dronePanelDevices,
    droneDeviceVisibility,
    droneMasterOn,
    radarPanelDevices,
    radarDeviceVisibility,
    radarMasterOn,
  ]);

  const sectionHeader = (
    open: boolean,
    onToggle: () => void,
    icon: ReactNode,
    title: string,
  ) => (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2 border-b border-white/[0.04] bg-nexus-bg-surface/95 px-2 py-2 text-left hover:bg-nexus-bg-elevated/60"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-nexus-text-muted">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </span>
      {icon}
      <span className="text-[10px] font-semibold tracking-widest text-nexus-text-muted">{title}</span>
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/[0.06] p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">图层</span>
          <span className="text-[10px] text-nexus-text-muted">{enabledCount} 项已开</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div>
          {sectionHeader(
            openBasemap,
            () => toggleLayerPanelSection("basemap"),
            <MapIcon size={12} className="shrink-0 text-nexus-text-muted" />,
            "地图",
          )}
          {openBasemap ? (
            <div className="border-b border-nexus-border/50 px-2 pb-2">
              <PanelTreeGroup>
                {basemapRasterLayers.map((layer) => (
                  <PanelTreeBranchRow
                    key={layer.id}
                    depth={0}
                    open={false}
                    onToggleOpen={() => {}}
                    label={layer.name}
                    visibility={visibilityFromBoolean(basemapRasterVisibility[layer.id] !== false)}
                    onToggleVisible={() => toggleBasemapRasterLayer(layer.id)}
                  />
                ))}
                <PanelTreeBranchRow
                  depth={0}
                  open={openBasemapStyle}
                  onToggleOpen={() => toggleLayerPanelBranch("basemapStyle")}
                  label={basemapStyleName ?? "本地地图"}
                  visibility={basemapLocalVisibility}
                  onToggleVisible={toggleBasemapLocalVisibility}
                />
                {openBasemapStyle ? (
                  basemapVectorLayers.length === 0 ? (
                    <div
                      className="border-b border-nexus-border/30 py-2 pr-2 text-[10px] leading-relaxed text-nexus-text-muted last:border-b-0"
                      style={{ paddingLeft: panelTreePaddingLeft(1) }}
                    >
                      暂无矢量子层，请检查 public/map-styles/
                    </div>
                  ) : (
                    groupKeys.map((gk) => {
                      const items = vectorByGroup.get(gk) ?? [];
                      if (items.length === 0) return null;
                      const subOpen = isLayerPanelDynamicExpanded(layerPanelExpand, "vectorGroup", gk);
                      return (
                        <div key={gk}>
                          <PanelTreeBranchRow
                            depth={1}
                            open={subOpen}
                            onToggleOpen={() => toggleVectorGroup(gk)}
                            label={VECTOR_LAYER_GROUP_LABELS[gk] ?? gk}
                            visibility={vectorGroupVisibility(gk)}
                            onToggleVisible={() => toggleVectorGroupVisibility(gk)}
                            disabled={!basemapGroupVisible && basemapLocalVisibility === "none"}
                          />
                          {subOpen
                            ? items.map((layer) => (
                                <PanelTreeToggleRow
                                  key={layer.id}
                                  depth={2}
                                  visibility={visibilityFromBoolean(
                                    basemapVectorVisibility[layer.id] !== false,
                                  )}
                                  onToggle={() => toggleBasemapVectorLayer(layer.id)}
                                  label={layer.label}
                                  disabled={!basemapGroupVisible}
                                />
                              ))
                            : null}
                        </div>
                      );
                    })
                  )
                ) : null}
              </PanelTreeGroup>
            </div>
          ) : null}
        </div>

        <div>
          {sectionHeader(
            openTargetSection,
            () => toggleLayerPanelSection("target"),
            <Target size={12} className="shrink-0 text-nexus-text-muted" />,
            "目标图层",
          )}
          {openTargetSection ? (
            <div className="border-b border-nexus-border/50 px-2 pb-2">
              <PanelTreeGroup>
                <PanelTreeBranchRow
                  depth={0}
                  open={openTargetTree}
                  onToggleOpen={() => toggleLayerPanelBranch("targetTree")}
                  label="全部目标"
                  visibility={targetMasterVisibility}
                  onToggleVisible={toggleTargetMasterVisibility}
                />
                {openTargetTree
                  ? getTrackLayerKeysOrdered().map((key) => {
                      const on = trackSubtypeVisible[key] !== false;
                      const showAirChildren = key === "fuse_air";
                      if (showAirChildren) {
                        const subOpen = isLayerPanelDynamicExpanded(
                          layerPanelExpand,
                          "targetSubtype",
                          key,
                        );
                        const fuseAirVis = fuseAirSubtypeVisibility(
                          tracksMasterOn,
                          trackSubtypeVisible,
                          airFusionSubtypeVisible,
                        );
                        return (
                          <div key={key}>
                            <PanelTreeBranchRow
                              depth={1}
                              open={subOpen}
                              onToggleOpen={() => toggleLayerPanelDynamic("targetSubtype", key)}
                              label={trackSubtypeLabel(key)}
                              visibility={fuseAirVis}
                              onToggleVisible={() => {
                                const turnOn = parentToggleTurnOn(fuseAirVis);
                                setTrackSubtypeVisible(key, turnOn);
                                setAirFusionSubtypesVisible(turnOn);
                                if (turnOn) setLayerVisibility(LYR_TRACKS, true);
                              }}
                            />
                            {subOpen ? (
                              <div className={cn(!on && "opacity-75")}>
                                <PanelTreeToggleRow
                                  depth={2}
                                  visibility={visibilityFromBoolean(
                                    airFusionSubtypeVisible.uav !== false,
                                  )}
                                  onToggle={() => {
                                    const turnOn = airFusionSubtypeVisible.uav === false;
                                    toggleAirFusionSubtype("uav");
                                    if (turnOn) {
                                      setLayerVisibility(LYR_TRACKS, true);
                                      if (trackSubtypeVisible.fuse_air === false) {
                                        setTrackSubtypeVisible("fuse_air", true);
                                      }
                                    }
                                  }}
                                  label="无人机"
                                  disabled={!on}
                                />
                                <PanelTreeToggleRow
                                  depth={2}
                                  visibility={visibilityFromBoolean(
                                    airFusionSubtypeVisible.bird !== false,
                                  )}
                                  onToggle={() => {
                                    const turnOn = airFusionSubtypeVisible.bird === false;
                                    toggleAirFusionSubtype("bird");
                                    if (turnOn) {
                                      setLayerVisibility(LYR_TRACKS, true);
                                      if (trackSubtypeVisible.fuse_air === false) {
                                        setTrackSubtypeVisible("fuse_air", true);
                                      }
                                    }
                                  }}
                                  label="鸟"
                                  disabled={!on}
                                />
                              </div>
                            ) : null}
                          </div>
                        );
                      }
                      return (
                        <PanelTreeToggleRow
                          key={key}
                          depth={1}
                          visibility={trackSubtypeVisibilityState(
                            tracksMasterOn,
                            key,
                            trackSubtypeVisible,
                          )}
                          onToggle={() => {
                            const turnOn = !on;
                            setTrackSubtypeVisible(key, turnOn);
                            if (turnOn) setLayerVisibility(LYR_TRACKS, true);
                          }}
                          label={trackSubtypeLabel(key)}
                        />
                      );
                    })
                  : null}
              </PanelTreeGroup>
            </div>
          ) : null}
        </div>

        <div>
          {sectionHeader(
            openEntityLayers,
            () => toggleLayerPanelSection("entity"),
            <Database size={12} className="shrink-0 text-nexus-text-muted" />,
            "实体图层",
          )}
          {openEntityLayers ? (
            <div className="border-b border-nexus-border/50 px-2 pb-2">
              <PanelTreeGroup>
                {layersData.map((layer) => {
                  if (layer.id === LYR_RADAR_COVERAGE) {
                    return (
                      <div key={layer.id}>
                        <PanelTreeBranchRow
                          depth={0}
                          open={openRadarTree}
                          onToggleOpen={() => toggleLayerPanelBranch("radarTree")}
                          label={layer.name}
                          visibility={radarLayerVisibility}
                          onToggleVisible={() =>
                            toggleEntityLayerVisibility(layer.id, radarLayerVisibility)
                          }
                        />
                        {openRadarTree ? (
                          radarPanelDevices.length === 0 ? (
                            <div
                              className="border-b border-nexus-border/30 py-2 pr-2 text-[10px] leading-relaxed text-nexus-text-muted last:border-b-0"
                              style={{ paddingLeft: 24 }}
                            >
                              暂无可选雷达（资产列表中无 radar 类型装备）
                            </div>
                          ) : (
                            radarPanelDevices.map((dev) => {
                              const dOpen = isLayerPanelDynamicExpanded(
                                layerPanelExpand,
                                "radarDevice",
                                dev.id,
                              );
                              return (
                                <div key={dev.id}>
                                  <PanelTreeBranchRow
                                    depth={1}
                                    open={dOpen}
                                    onToggleOpen={() =>
                                      toggleLayerPanelDynamic("radarDevice", dev.id)
                                    }
                                    label={dev.label}
                                    visibility={radarDeviceVisibilityState(dev.id)}
                                    onToggleVisible={() => {
                                      const st = radarDeviceVisibilityState(dev.id);
                                      setRadarDeviceAllVisible(dev.id, parentToggleTurnOn(st));
                                    }}
                                  />
                                  {dOpen ? (
                                    <>
                                      <PanelTreeToggleRow
                                        depth={2}
                                        visibility={visibilityFromBoolean(
                                          isRadarDeviceIconVisible(dev.id, radarDeviceVisibility),
                                        )}
                                        onToggle={() => toggleRadarDeviceIcon(dev.id)}
                                        label="GIS 图标"
                                      />
                                      <PanelTreeToggleRow
                                        depth={2}
                                        visibility={visibilityFromBoolean(
                                          isRadarDeviceCapabilityVisible(dev.id, radarDeviceVisibility),
                                        )}
                                        onToggle={() => toggleRadarDeviceCapability(dev.id)}
                                        label="能力"
                                      />
                                    </>
                                  ) : null}
                                </div>
                              );
                            })
                          )
                        ) : null}
                      </div>
                    );
                  }
                  if (layer.id === LYR_DRONES) {
                    return (
                      <div key={layer.id}>
                        <PanelTreeBranchRow
                          depth={0}
                          open={openDroneTree}
                          onToggleOpen={() => toggleLayerPanelBranch("droneTree")}
                          label={layer.name}
                          visibility={droneLayerVisibility}
                          onToggleVisible={() =>
                            toggleEntityLayerVisibility(layer.id, droneLayerVisibility)
                          }
                        />
                        {openDroneTree ? (
                          dronePanelDevices.length === 0 ? (
                            <div
                              className="border-b border-nexus-border/30 py-2 pr-2 text-[10px] leading-relaxed text-nexus-text-muted last:border-b-0"
                              style={{ paddingLeft: 24 }}
                            >
                              暂无可选无人机（需 WS 机巢关系、资产列表或 gRPC 蓝方遥测）
                            </div>
                          ) : (
                            dronePanelDevices.map((dev) => {
                              const dOpen = isLayerPanelDynamicExpanded(
                                layerPanelExpand,
                                "droneDevice",
                                dev.sn,
                              );
                              const airportSn = dev.airportSN.trim();
                              const airportLabel = airportSn
                                ? airportNameById.get(airportSn) ?? airportSn
                                : "";
                              const panelLabel =
                                !airportSn && isStandaloneMapGisDrone(dev, droneStoreDrones[dev.sn])
                                  ? `${dev.label}（蓝方）`
                                  : dev.label;
                              return (
                                <div key={dev.sn}>
                                  <PanelTreeBranchRow
                                    depth={1}
                                    open={dOpen}
                                    onToggleOpen={() =>
                                      toggleLayerPanelDynamic("droneDevice", dev.sn)
                                    }
                                    label={panelLabel}
                                    visibility={droneDeviceVisibilityState(dev)}
                                    onToggleVisible={() => {
                                      const st = droneDeviceVisibilityState(dev);
                                      setDroneDeviceAllVisible(dev.sn, parentToggleTurnOn(st));
                                    }}
                                  />
                                  {dOpen ? (
                                    <>
                                      <PanelTreeToggleRow
                                        depth={2}
                                        visibility={visibilityFromBoolean(
                                          isDroneDevicePositionVisible(dev.sn, droneDeviceVisibility),
                                        )}
                                        onToggle={() => toggleDroneDevicePosition(dev.sn)}
                                        label="自报位"
                                      />
                                      <PanelTreeToggleRow
                                        depth={2}
                                        visibility={visibilityFromBoolean(
                                          isDroneDeviceRouteVisible(dev.sn, droneDeviceVisibility),
                                        )}
                                        onToggle={() => toggleDroneDeviceRoute(dev.sn)}
                                        label="航线"
                                      />
                                      {airportSn ? (
                                        <PanelTreeToggleRow
                                          depth={2}
                                          visibility={visibilityFromBoolean(
                                            isDroneDeviceAirportVisible(dev.sn, droneDeviceVisibility),
                                          )}
                                          onToggle={() => toggleDroneDeviceAirport(dev.sn)}
                                          label={`机场 · ${airportLabel}`}
                                        />
                                      ) : null}
                                    </>
                                  ) : null}
                                </div>
                              );
                            })
                          )
                        ) : null}
                      </div>
                    );
                  }
                  if (layer.id !== LYR_OPTO_FOV && layer.id !== LYR_RADAR_COVERAGE && layer.id !== LYR_DRONES) {
                    return (
                      <PanelTreeToggleRow
                        key={layer.id}
                        depth={0}
                        visibility={visibilityFromBoolean(layer.visible)}
                        onToggle={() => toggleLayerVisibility(layer.id)}
                        label={layer.name}
                      />
                    );
                  }
                  if (layer.id !== LYR_OPTO_FOV) {
                    return null;
                  }
                  return (
                    <div key={layer.id}>
                      <PanelTreeBranchRow
                        depth={0}
                        open={openOptoTree}
                        onToggleOpen={() => toggleLayerPanelBranch("optoTree")}
                        label={layer.name}
                        visibility={optoLayerVisibility}
                        onToggleVisible={() =>
                          toggleEntityLayerVisibility(layer.id, optoLayerVisibility)
                        }
                      />
                      {openOptoTree ? (
                        cameraMenuLoading && optoCameraDevices.length === 0 ? (
                          <div
                            className="border-b border-nexus-border/30 py-2 pr-2 text-[10px] text-nexus-text-muted last:border-b-0"
                            style={{ paddingLeft: 24 }}
                          >
                            加载相机列表…
                          </div>
                        ) : optoCameraDevices.length === 0 ? (
                          <div
                            className="border-b border-nexus-border/30 py-2 pr-2 text-[10px] leading-relaxed text-nexus-text-muted last:border-b-0"
                            style={{ paddingLeft: 24 }}
                          >
                            暂无可选光电（8090 中无 PTZ 主相机或第三方相机）
                          </div>
                        ) : (
                          optoCameraDevices.map((dev) => {
                            const dOpen = isLayerPanelDynamicExpanded(
                              layerPanelExpand,
                              "optoDevice",
                              dev.id,
                            );
                            return (
                              <div key={dev.id}>
                                <PanelTreeBranchRow
                                  depth={1}
                                  open={dOpen}
                                  onToggleOpen={() =>
                                    toggleLayerPanelDynamic("optoDevice", dev.id)
                                  }
                                  label={dev.label}
                                  visibility={optoDeviceVisibilityState(dev.id)}
                                  onToggleVisible={() => {
                                    const st = optoDeviceVisibilityState(dev.id);
                                    setOptoDeviceAllVisible(dev.id, parentToggleTurnOn(st));
                                  }}
                                />
                                {dOpen ? (
                                  <>
                                    <PanelTreeToggleRow
                                      depth={2}
                                      visibility={visibilityFromBoolean(
                                        isOptoDeviceFovVisible(dev.id, optoDeviceVisibility),
                                      )}
                                      onToggle={() => toggleOptoDeviceFov(dev.id)}
                                      label="视场"
                                    />
                                    <PanelTreeToggleRow
                                      depth={2}
                                      visibility={visibilityFromBoolean(
                                        isOptoDeviceIconVisible(dev.id, optoDeviceVisibility),
                                      )}
                                      onToggle={() => toggleOptoDeviceIcon(dev.id)}
                                      label="GIS 图标"
                                    />
                                    <PanelTreeToggleRow
                                      depth={2}
                                      visibility={visibilityFromBoolean(
                                        isOptoDeviceCapabilityVisible(dev.id, optoDeviceVisibility),
                                      )}
                                      onToggle={() => toggleOptoDeviceCapability(dev.id)}
                                      label="能力"
                                    />
                                  </>
                                ) : null}
                              </div>
                            );
                          })
                        )
                      ) : null}
                    </div>
                  );
                })}
              </PanelTreeGroup>
            </div>
          ) : null}
        </div>

        <div>
          {sectionHeader(
            openDbAreaSection,
            () => toggleLayerPanelSection("dbArea"),
            <FolderTree size={12} className="shrink-0 text-nexus-text-muted" />,
            "区域图层",
          )}
          {openDbAreaSection ? (
            <div className="border-b border-nexus-border/50 px-2 pb-2">
              <PanelTreeGroup>
                <PanelTreeBranchRow
                  depth={0}
                  open={openDbAreaTree}
                  onToggleOpen={() => toggleLayerPanelBranch("dbAreaTree")}
                  label="全部区域"
                  visibility={dbAreaMasterVisibility}
                  onToggleVisible={toggleDbAreaMasterVisibility}
                />
                {openDbAreaTree
                  ? dbAreaGroups.map(([groupId, list]) => {
                      const gOpen = isLayerPanelDynamicExpanded(
                        layerPanelExpand,
                        "dbGroup",
                        String(groupId),
                      );
                      const gVis = groupAreaVisibility(groupId);
                      return (
                        <div key={groupId}>
                          <PanelTreeBranchRow
                            depth={1}
                            open={gOpen}
                            onToggleOpen={() => toggleDbGroupOpen(groupId)}
                            label={groupDisplayName(groupId)}
                            visibility={gVis}
                            onToggleVisible={() => toggleDbAreaGroupVisibility(groupId, gVis)}
                          />
                          {gOpen
                            ? list.map((r) => {
                                const key = dbAreaVisibilityKey(r.group_id, r.area_id);
                                const v = isDbAreaLeafVisible(r.group_id, r.area_id, dbAreaVisibility);
                                const label =
                                  (r.area_name != null && String(r.area_name).trim()) ||
                                  mapAreaFallbackLabel(r.group_id, r.area_id, r.area_type);
                                return (
                                  <PanelTreeToggleRow
                                    key={key}
                                    depth={2}
                                    visibility={visibilityFromBoolean(v)}
                                    onToggle={() =>
                                      toggleDbAreaLeafVisibility(r.group_id, r.area_id, v)
                                    }
                                    label={label}
                                  />
                                );
                              })
                            : null}
                        </div>
                      );
                    })
                  : null}
                {/* 固定目标：与「全部区域」同级展示，不依赖展开树，避免看不到 */}
                <div>
                  <PanelTreeBranchRow
                    depth={0}
                    open={isLayerPanelDynamicExpanded(
                      layerPanelExpand,
                      "dbGroup",
                      "fixed-targets",
                    )}
                    onToggleOpen={() => toggleLayerPanelDynamic("dbGroup", "fixed-targets")}
                    label="固定目标"
                    visibility={fixedTargetGroupVisibility}
                    onToggleVisible={toggleFixedTargetGroupVisibility}
                  />
                  {isLayerPanelDynamicExpanded(layerPanelExpand, "dbGroup", "fixed-targets") ? (
                    dbAreaTargetRows.filter(isDbAreaTargetListable).length === 0 ? (
                      <div
                        className="border-b border-nexus-border/30 py-2 pr-2 text-[10px] leading-relaxed text-nexus-text-muted last:border-b-0"
                        style={{ paddingLeft: panelTreePaddingLeft(1) }}
                      >
                        暂无固定目标（area_table_target）
                      </div>
                    ) : (
                      dbAreaTargetRows.filter(isDbAreaTargetListable).map((r) => {
                        const v = isDbAreaTargetLeafVisible(r.id, dbAreaTargetVisibility);
                        const label =
                          (r.area_name && String(r.area_name).trim()) ||
                          `固定目标-${r.target_id}`;
                        return (
                          <PanelTreeToggleRow
                            key={dbAreaTargetVisibilityKey(r.id)}
                            depth={1}
                            visibility={visibilityFromBoolean(v)}
                            onToggle={() => toggleFixedTargetLeafVisibility(r.id, v)}
                            label={label}
                          />
                        );
                      })
                    )
                  ) : null}
                </div>
              </PanelTreeGroup>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
