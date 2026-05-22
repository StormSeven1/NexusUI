"use client";

/**
 * 图层面板：读 app-store，驱动 MapLibre。
 * - 底图矢量：JSON + parseVectorLayersForPanel，Map2D load 后写入 store
 * - 数据图层：`buildDataLayerPanelRows(useAssetStore.assets)` 按资产类型动态行（**不含**量算与标绘）
 * - 开关：toggleBasemapGroupVisible / toggleBasemapVectorLayer / toggleLayerVisibility
 *   写入 store，Map2D 内 subscribe 后改 visibility
 * - 右上角「X 项已开」：数据图层开项 +（底图组开时）底图总开关算 1 + 已开矢量子层（与态势栏「图层显示」一致）
 */

import { cn } from "@/lib/utils";
import { buildDataLayerPanelRows, LYR_DB_AREAS } from "@/lib/map-entity-model";
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
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Map as MapIcon,
  Database,
  Layers as LayersIcon,
  FolderTree,
} from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

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

  /** 各类型区块默认收起；矢量下按 group 再分一层 */
  const [openBasemap, setOpenBasemap] = useState(false);
  const [openDataLayers, setOpenDataLayers] = useState(false);
  const [openVectorSection, setOpenVectorSection] = useState(false);
  const [openVectorGroup, setOpenVectorGroup] = useState<Record<string, boolean>>({});
  const [openDbAreaSection, setOpenDbAreaSection] = useState(false);
  const [openDbGroup, setOpenDbGroup] = useState<Record<number, boolean>>({});

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
    return n;
  }, [
    layersData,
    basemapGroupVisible,
    basemapVectorLayers,
    basemapVectorVisibility,
    dbAreaRows,
    dbAreaVisibility,
    dbAreaMasterOn,
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

  const rowBtn = (visible: boolean, onToggle: () => void, label: string, key: string, disabled?: boolean) => (
    <button
      key={key}
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-3 border-b border-nexus-border px-3 py-2.5 text-left",
        disabled ? "cursor-not-allowed opacity-50" : "hover:bg-nexus-bg-elevated",
      )}
    >
      <div
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded border transition-colors",
          visible
            ? "border-nexus-border-accent bg-nexus-accent-glow/20 text-nexus-text-primary"
            : "border-nexus-border bg-nexus-bg-sidebar text-nexus-text-muted",
        )}
      >
        {visible ? <Eye size={10} /> : <EyeOff size={10} />}
      </div>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-xs",
          visible ? "text-nexus-text-primary" : "text-nexus-text-muted",
        )}
      >
        {label}
      </span>
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/[0.06] p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">
            图层
          </span>
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
          {openBasemap
            ? rowBtn(
                basemapGroupVisible,
                toggleBasemapGroupVisible,
                basemapStyleName ?? "未命名",
                "basemap-master",
              )
            : null}
        </div>

        <div>
          {sectionHeader(
            openDataLayers,
            () => setOpenDataLayers((v) => !v),
            <Database size={12} className="shrink-0 text-nexus-text-muted" />,
            "数据图层",
          )}
          {openDataLayers
            ? layersData.map((layer) =>
                rowBtn(layer.visible, () => toggleLayerVisibility(layer.id), layer.name, layer.id, false),
              )
            : null}
        </div>

        <div>
          {sectionHeader(
            openVectorSection,
            () => setOpenVectorSection((v) => !v),
            <LayersIcon size={12} className="shrink-0 text-nexus-text-muted" />,
            "矢量图层",
          )}
          {openVectorSection ? (
            basemapVectorLayers.length === 0 ? (
              <div className="border-b border-nexus-border px-3 py-3 text-[10px] leading-relaxed text-nexus-text-muted">
                暂无矢量图层，请检查 public/map-styles/
              </div>
            ) : (
              groupKeys.map((gk) => {
                const items = vectorByGroup.get(gk) ?? [];
                if (items.length === 0) return null;
                const subOpen = openVectorGroup[gk] ?? false;
                return (
                  <div key={gk}>
                    <button
                      type="button"
                      onClick={() => toggleVectorGroup(gk)}
                      className="flex w-full items-center gap-2 border-b border-nexus-border/60 bg-nexus-bg-base/80 px-2 py-1.5 text-left hover:bg-nexus-bg-elevated/40"
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-nexus-text-muted">
                        {subOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </span>
                      <span className="text-[9px] font-medium uppercase tracking-wide text-nexus-text-muted">
                        {VECTOR_LAYER_GROUP_LABELS[gk] ?? gk}
                      </span>
                    </button>
                    {subOpen
                      ? items.map((layer: VectorLayerPanelItem) => {
                          const v = basemapGroupVisible && basemapVectorVisibility[layer.id] !== false;
                          return rowBtn(
                            v,
                            () => toggleBasemapVectorLayer(layer.id),
                            layer.label,
                            `vec-${layer.id}`,
                          );
                        })
                      : null}
                  </div>
                );
              })
            )
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
            <div>
              {rowBtn(
                dbAreaMasterOn,
                () => toggleLayerVisibility(LYR_DB_AREAS),
                "全部区域（总开关）",
                "lyr-db-areas-root",
              )}
              {dbAreaMasterOn
                ? dbAreaGroups.map(([groupId, list]) => {
                    const gOpen = openDbGroup[groupId] ?? false;
                    const gOn = groupAllOn(groupId);
                    return (
                      <div key={groupId} className="border-b border-nexus-border/50">
                        <div className="flex w-full items-stretch bg-nexus-bg-base/80">
                          <button
                            type="button"
                            onClick={() => toggleDbGroupOpen(groupId)}
                            className="flex w-8 shrink-0 items-center justify-center text-nexus-text-muted hover:bg-nexus-bg-elevated/50"
                            aria-label={gOpen ? "收起组" : "展开组"}
                          >
                            {gOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </button>
                          <div className="min-w-0 flex-1">
                            {rowBtn(
                              gOn,
                              () => toggleGroupAllAreasVisible(groupId),
                              groupDisplayName(groupId),
                              `db-area-group-${groupId}`,
                            )}
                          </div>
                        </div>
                        {gOpen
                          ? list.map((r) => {
                              const key = dbAreaVisibilityKey(r.group_id, r.area_id);
                              const v = dbAreaVisibility[key] !== false;
                              const label =
                                (r.area_name != null && String(r.area_name).trim()) ||
                                mapAreaFallbackLabel(r.group_id, r.area_id, r.area_type);
                              return rowBtn(v, () => setAreaVisible(r.group_id, r.area_id, !v), label, key);
                            })
                          : null}
                      </div>
                    );
                  })
                : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
