"use client";

/**
 * 图层面板：读 app-store，驱动 MapLibre。
 * 树形显隐行与 `TrackListPanel` 航迹类型、`PanelVisibilityTree` 统一缩进与样式。
 */

import {
  buildDataLayerPanelRows,
  LYR_DB_AREAS,
  LYR_DRONES,
  LYR_OPTO_FOV,
  LYR_RADAR_COVERAGE,
} from "@/lib/map-entity-model";
import { useMapGisCameraMenuStore } from "@/stores/map-gis-camera-menu-store";
import {
  countVisibleOptoDeviceLeaves,
  isOptoDeviceFovVisible,
  isOptoDeviceIconVisible,
} from "@/lib/opto-device-layer-visibility";
import {
  countVisibleDroneDeviceLeaves,
  isDroneDevicePositionVisible,
  isDroneDeviceRouteVisible,
} from "@/lib/drone-device-layer-visibility";
import {
  countVisibleRadarDeviceLeaves,
  isRadarDeviceCoverageVisible,
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
import { useAppStore } from "@/stores/app-store";
import { useDbAreaStore } from "@/stores/db-area-store";
import { dbAreaVisibilityKey } from "@/lib/area-table-geometry";
import { mapAreaFallbackLabel } from "@/lib/area-table-serialize";
import { countVisibleDbAreaLeaves, isDbAreaDrawable } from "@/lib/db-area-panel-helpers";
import { collectMapGisDroneRowsSync, mapGisDroneSyncSignature } from "@/lib/map-gis-drone-rows";
import { useDroneStore } from "@/stores/drone-store";
import {
  PanelTreeBranchRow,
  PanelTreeGroup,
  PanelTreeToggleRow,
} from "@/components/panels/PanelVisibilityTree";
import {
  ChevronDown,
  ChevronRight,
  Map as MapIcon,
  Database,
  Layers as LayersIcon,
  FolderTree,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

export function LayerPanel() {
  const assets = useAssetStore((s) => s.assets);
  const layerVisibility = useAppStore((s) => s.layerVisibility);
  const toggleLayerVisibility = useAppStore((s) => s.toggleLayerVisibility);

  const basemapStyleName = useAppStore((s) => s.basemapStyleName);
  const basemapVectorLayers = useAppStore((s) => s.basemapVectorLayers);
  const basemapGroupVisible = useAppStore((s) => s.basemapGroupVisible);
  const basemapVectorVisibility = useAppStore((s) => s.basemapVectorVisibility);
  const toggleBasemapGroupVisible = useAppStore((s) => s.toggleBasemapGroupVisible);
  const toggleBasemapVectorLayer = useAppStore((s) => s.toggleBasemapVectorLayer);

  const dataPanelRows = useMemo(() => buildDataLayerPanelRows(assets), [assets]);

  const dbAreaRows = useDbAreaStore((s) => s.rows);
  const dbAreaVisibility = useDbAreaStore((s) => s.areaVisibility);
  const toggleGroupAllAreasVisible = useDbAreaStore((s) => s.toggleGroupAllAreasVisible);
  const setAreaVisible = useDbAreaStore((s) => s.setAreaVisible);

  const optoDeviceVisibility = useOptoDeviceLayerStore((s) => s.deviceVisibility);
  const toggleOptoDeviceFov = useOptoDeviceLayerStore((s) => s.toggleDeviceFov);
  const toggleOptoDeviceIcon = useOptoDeviceLayerStore((s) => s.toggleDeviceIcon);
  const droneDeviceVisibility = useDroneDeviceLayerStore((s) => s.deviceVisibility);
  const toggleDroneDevicePosition = useDroneDeviceLayerStore((s) => s.toggleDevicePosition);
  const toggleDroneDeviceRoute = useDroneDeviceLayerStore((s) => s.toggleDeviceRoute);
  const syncDroneDeviceSns = useDroneDeviceLayerStore((s) => s.syncDroneSns);
  const radarDeviceVisibility = useRadarDeviceLayerStore((s) => s.deviceVisibility);
  const toggleRadarDeviceCoverage = useRadarDeviceLayerStore((s) => s.toggleDeviceCoverage);
  const toggleRadarDeviceIcon = useRadarDeviceLayerStore((s) => s.toggleDeviceIcon);
  const syncRadarDeviceIds = useRadarDeviceLayerStore((s) => s.syncRadarIds);
  const cameraMenuRows = useMapGisCameraMenuStore((s) => s.rows);
  const cameraMenuLoading = useMapGisCameraMenuStore((s) => s.loading);
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
    () => collectMapGisDroneRowsSync().map((r) => ({ id: r.sn, label: r.label })),
    [droneStoreDrones, droneToAirport, droneRelationships, assetDroneSig],
  );

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

  const [openBasemap, setOpenBasemap] = useState(false);
  const [openDataLayers, setOpenDataLayers] = useState(false);
  const [openVectorSection, setOpenVectorSection] = useState(false);
  const [openVectorGroup, setOpenVectorGroup] = useState<Record<string, boolean>>({});
  const [openDbAreaSection, setOpenDbAreaSection] = useState(false);
  const [openDbAreaTree, setOpenDbAreaTree] = useState(true);
  const [openDbGroup, setOpenDbGroup] = useState<Record<number, boolean>>({});
  const [openOptoTree, setOpenOptoTree] = useState(true);
  const [openOptoDevice, setOpenOptoDevice] = useState<Record<string, boolean>>({});
  const [openDroneTree, setOpenDroneTree] = useState(true);
  const [openDroneDevice, setOpenDroneDevice] = useState<Record<string, boolean>>({});
  const [openRadarTree, setOpenRadarTree] = useState(true);
  const [openRadarDevice, setOpenRadarDevice] = useState<Record<string, boolean>>({});

  const optoMasterOn = layerVisibility[LYR_OPTO_FOV] !== false;
  const droneMasterOn = layerVisibility[LYR_DRONES] !== false;
  const radarMasterOn = layerVisibility[LYR_RADAR_COVERAGE] !== false;

  useEffect(() => {
    if (!hasOptoLayerRow) return;
    void ensureCameraMenuRows();
  }, [hasOptoLayerRow, ensureCameraMenuRows]);

  useEffect(() => {
    if (!hasDroneLayerRow) return;
    syncDroneDeviceSns(dronePanelDevices.map((d) => d.id));
  }, [hasDroneLayerRow, dronePanelDevices, syncDroneDeviceSns]);

  useEffect(() => {
    if (!hasRadarLayerRow) return;
    syncRadarDeviceIds(radarPanelDevices.map((d) => d.id));
  }, [hasRadarLayerRow, radarPanelDevices, syncRadarDeviceIds]);

  const toggleVectorGroup = useCallback((gk: string) => {
    setOpenVectorGroup((prev) => ({ ...prev, [gk]: !prev[gk] }));
  }, []);

  const toggleDbGroupOpen = useCallback((gid: number) => {
    setOpenDbGroup((prev) => ({ ...prev, [gid]: !prev[gid] }));
  }, []);

  const dbAreaMasterOn = layerVisibility[LYR_DB_AREAS] !== false;

  const dbAreaGroups = useMemo(() => {
    const m = new globalThis.Map<number, typeof dbAreaRows>();
    for (const r of dbAreaRows) {
      if (!isDbAreaDrawable(r)) continue;
      const arr = m.get(r.group_id) ?? [];
      arr.push(r);
      m.set(r.group_id, arr);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [dbAreaRows]);

  const groupAllOn = useCallback(
    (groupId: number) => {
      const list = dbAreaRows.filter((r) => r.group_id === groupId && isDbAreaDrawable(r));
      if (list.length === 0) return true;
      return list.every((r) => dbAreaVisibility[dbAreaVisibilityKey(r.group_id, r.area_id)] !== false);
    },
    [dbAreaRows, dbAreaVisibility],
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
    n += countVisibleDbAreaLeaves(dbAreaRows, dbAreaVisibility, dbAreaMasterOn);
    n += countVisibleOptoDeviceLeaves(
      optoCameraDevices.map((c) => c.id),
      optoDeviceVisibility,
      optoMasterOn,
    );
    n += countVisibleDroneDeviceLeaves(
      dronePanelDevices.map((d) => d.id),
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
    dbAreaRows,
    dbAreaVisibility,
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
            () => setOpenBasemap((v) => !v),
            <MapIcon size={12} className="shrink-0 text-nexus-text-muted" />,
            "底图",
          )}
          {openBasemap ? (
            <div className="border-b border-nexus-border/50 px-2 pb-2">
              <PanelTreeGroup>
                <PanelTreeToggleRow
                  depth={0}
                  visible={basemapGroupVisible}
                  onToggle={toggleBasemapGroupVisible}
                  label={basemapStyleName ?? "未命名"}
                />
              </PanelTreeGroup>
            </div>
          ) : null}
        </div>

        <div>
          {sectionHeader(
            openDataLayers,
            () => setOpenDataLayers((v) => !v),
            <Database size={12} className="shrink-0 text-nexus-text-muted" />,
            "数据图层",
          )}
          {openDataLayers ? (
            <div className="border-b border-nexus-border/50 px-2 pb-2">
              <PanelTreeGroup>
                {layersData.map((layer) => {
                  if (layer.id === LYR_RADAR_COVERAGE) {
                    return (
                      <div key={layer.id}>
                        <PanelTreeBranchRow
                          depth={0}
                          open={openRadarTree}
                          onToggleOpen={() => setOpenRadarTree((v) => !v)}
                          label={layer.name}
                          visible={layer.visible}
                          onToggleVisible={() => toggleLayerVisibility(layer.id)}
                        />
                        {openRadarTree && layer.visible ? (
                          radarPanelDevices.length === 0 ? (
                            <div
                              className="border-b border-nexus-border/30 py-2 pr-2 text-[10px] leading-relaxed text-nexus-text-muted last:border-b-0"
                              style={{ paddingLeft: 24 }}
                            >
                              暂无可选雷达（资产列表中无 radar 类型装备）
                            </div>
                          ) : (
                            radarPanelDevices.map((dev) => {
                              const dOpen = openRadarDevice[dev.id] ?? false;
                              return (
                                <div key={dev.id}>
                                  <PanelTreeBranchRow
                                    depth={1}
                                    open={dOpen}
                                    onToggleOpen={() =>
                                      setOpenRadarDevice((prev) => ({
                                        ...prev,
                                        [dev.id]: !prev[dev.id],
                                      }))
                                    }
                                    label={dev.label}
                                    disabled={!radarMasterOn}
                                  />
                                  {dOpen ? (
                                    <>
                                      <PanelTreeToggleRow
                                        depth={2}
                                        visible={isRadarDeviceCoverageVisible(dev.id, radarDeviceVisibility)}
                                        onToggle={() => toggleRadarDeviceCoverage(dev.id)}
                                        label="距离环"
                                        disabled={!radarMasterOn}
                                      />
                                      <PanelTreeToggleRow
                                        depth={2}
                                        visible={isRadarDeviceIconVisible(dev.id, radarDeviceVisibility)}
                                        onToggle={() => toggleRadarDeviceIcon(dev.id)}
                                        label="GIS 图标"
                                        disabled={!radarMasterOn}
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
                          onToggleOpen={() => setOpenDroneTree((v) => !v)}
                          label={layer.name}
                          visible={layer.visible}
                          onToggleVisible={() => toggleLayerVisibility(layer.id)}
                        />
                        {openDroneTree && layer.visible ? (
                          dronePanelDevices.length === 0 ? (
                            <div
                              className="border-b border-nexus-border/30 py-2 pr-2 text-[10px] leading-relaxed text-nexus-text-muted last:border-b-0"
                              style={{ paddingLeft: 24 }}
                            >
                              暂无可选无人机（需 WS 推送机巢关系或资产列表含无人机）
                            </div>
                          ) : (
                            dronePanelDevices.map((dev) => {
                              const dOpen = openDroneDevice[dev.id] ?? false;
                              return (
                                <div key={dev.id}>
                                  <PanelTreeBranchRow
                                    depth={1}
                                    open={dOpen}
                                    onToggleOpen={() =>
                                      setOpenDroneDevice((prev) => ({
                                        ...prev,
                                        [dev.id]: !prev[dev.id],
                                      }))
                                    }
                                    label={dev.label}
                                    disabled={!droneMasterOn}
                                  />
                                  {dOpen ? (
                                    <>
                                      <PanelTreeToggleRow
                                        depth={2}
                                        visible={isDroneDevicePositionVisible(dev.id, droneDeviceVisibility)}
                                        onToggle={() => toggleDroneDevicePosition(dev.id)}
                                        label="自报位"
                                        disabled={!droneMasterOn}
                                      />
                                      <PanelTreeToggleRow
                                        depth={2}
                                        visible={isDroneDeviceRouteVisible(dev.id, droneDeviceVisibility)}
                                        onToggle={() => toggleDroneDeviceRoute(dev.id)}
                                        label="航线"
                                        disabled={!droneMasterOn}
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
                  if (layer.id !== LYR_OPTO_FOV && layer.id !== LYR_RADAR_COVERAGE && layer.id !== LYR_DRONES) {
                    return (
                      <PanelTreeToggleRow
                        key={layer.id}
                        depth={0}
                        visible={layer.visible}
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
                        onToggleOpen={() => setOpenOptoTree((v) => !v)}
                        label={layer.name}
                        visible={layer.visible}
                        onToggleVisible={() => toggleLayerVisibility(layer.id)}
                      />
                      {openOptoTree && layer.visible ? (
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
                            const dOpen = openOptoDevice[dev.id] ?? false;
                            return (
                              <div key={dev.id}>
                                <PanelTreeBranchRow
                                  depth={1}
                                  open={dOpen}
                                  onToggleOpen={() =>
                                    setOpenOptoDevice((prev) => ({
                                      ...prev,
                                      [dev.id]: !prev[dev.id],
                                    }))
                                  }
                                  label={dev.label}
                                  disabled={!optoMasterOn}
                                />
                                {dOpen ? (
                                  <>
                                    <PanelTreeToggleRow
                                      depth={2}
                                      visible={isOptoDeviceFovVisible(dev.id, optoDeviceVisibility)}
                                      onToggle={() => toggleOptoDeviceFov(dev.id)}
                                      label="视场"
                                      disabled={!optoMasterOn}
                                    />
                                    <PanelTreeToggleRow
                                      depth={2}
                                      visible={isOptoDeviceIconVisible(dev.id, optoDeviceVisibility)}
                                      onToggle={() => toggleOptoDeviceIcon(dev.id)}
                                      label="GIS 图标"
                                      disabled={!optoMasterOn}
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
            openVectorSection,
            () => setOpenVectorSection((v) => !v),
            <LayersIcon size={12} className="shrink-0 text-nexus-text-muted" />,
            "矢量图层",
          )}
          {openVectorSection ? (
            <div className="border-b border-nexus-border/50 px-2 pb-2">
              {basemapVectorLayers.length === 0 ? (
                <div className="px-2 py-3 text-[10px] leading-relaxed text-nexus-text-muted">
                  暂无矢量图层，请检查 public/map-styles/
                </div>
              ) : (
                <PanelTreeGroup>
                  {groupKeys.map((gk) => {
                    const items = vectorByGroup.get(gk) ?? [];
                    if (items.length === 0) return null;
                    const subOpen = openVectorGroup[gk] ?? false;
                    return (
                      <div key={gk}>
                        <PanelTreeBranchRow
                          depth={0}
                          open={subOpen}
                          onToggleOpen={() => toggleVectorGroup(gk)}
                          label={VECTOR_LAYER_GROUP_LABELS[gk] ?? gk}
                          disabled={!basemapGroupVisible}
                        />
                        {subOpen
                          ? items.map((layer) => (
                              <PanelTreeToggleRow
                                key={layer.id}
                                depth={1}
                                visible={
                                  basemapGroupVisible && basemapVectorVisibility[layer.id] !== false
                                }
                                onToggle={() => toggleBasemapVectorLayer(layer.id)}
                                label={layer.label}
                                disabled={!basemapGroupVisible}
                              />
                            ))
                          : null}
                      </div>
                    );
                  })}
                </PanelTreeGroup>
              )}
            </div>
          ) : null}
        </div>

        <div>
          {sectionHeader(
            openDbAreaSection,
            () => setOpenDbAreaSection((v) => !v),
            <FolderTree size={12} className="shrink-0 text-nexus-text-muted" />,
            "区域图层",
          )}
          {openDbAreaSection ? (
            <div className="border-b border-nexus-border/50 px-2 pb-2">
              <PanelTreeGroup>
                <PanelTreeBranchRow
                  depth={0}
                  open={openDbAreaTree}
                  onToggleOpen={() => setOpenDbAreaTree((v) => !v)}
                  label="全部区域"
                  visible={dbAreaMasterOn}
                  onToggleVisible={() => toggleLayerVisibility(LYR_DB_AREAS)}
                />
                {openDbAreaTree && dbAreaMasterOn
                  ? dbAreaGroups.map(([groupId, list]) => {
                      const gOpen = openDbGroup[groupId] ?? false;
                      const gOn = groupAllOn(groupId);
                      return (
                        <div key={groupId}>
                          <PanelTreeBranchRow
                            depth={1}
                            open={gOpen}
                            onToggleOpen={() => toggleDbGroupOpen(groupId)}
                            label={groupDisplayName(groupId)}
                            visible={gOn}
                            onToggleVisible={() => toggleGroupAllAreasVisible(groupId)}
                          />
                          {gOpen
                            ? list.map((r) => {
                                const key = dbAreaVisibilityKey(r.group_id, r.area_id);
                                const v = dbAreaVisibility[key] !== false;
                                const label =
                                  (r.area_name != null && String(r.area_name).trim()) ||
                                  mapAreaFallbackLabel(r.group_id, r.area_id, r.area_type);
                                return (
                                  <PanelTreeToggleRow
                                    key={key}
                                    depth={2}
                                    visible={v}
                                    onToggle={() => setAreaVisible(r.group_id, r.area_id, !v)}
                                    label={label}
                                  />
                                );
                              })
                            : null}
                        </div>
                      );
                    })
                  : null}
              </PanelTreeGroup>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
