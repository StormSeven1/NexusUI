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
import { buildDataLayerPanelRows } from "@/lib/map-entity-model";
import { useAssetStore } from "@/stores/asset-store";
import {
  VECTOR_LAYER_GROUP_LABELS,
  type VectorLayerPanelItem,
} from "@/lib/map-2d-basemap-layer-panel";
import { useAppStore } from "@/stores/app-store";
import { Eye, EyeOff, Map as MapIcon, Database, Layers as LayersIcon } from "lucide-react";
import { useMemo } from "react";

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

  const enabledCount = useMemo(() => {
    let n = layersData.filter((l) => l.visible).length;
    if (basemapGroupVisible) {
      n += 1;
      n += basemapVectorLayers.filter((l) => basemapVectorVisibility[l.id] !== false).length;
    }
    return n;
  }, [layersData, basemapGroupVisible, basemapVectorLayers, basemapVectorVisibility]);

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
          <div className="flex items-center gap-2 border-b border-white/[0.04] bg-nexus-bg-surface/95 px-3 py-2">
            <MapIcon size={12} className="text-nexus-text-muted" />
            <span className="text-[10px] font-semibold tracking-widest text-nexus-text-muted">
              底图
            </span>
          </div>
          {rowBtn(
            basemapGroupVisible,
            toggleBasemapGroupVisible,
            basemapStyleName ?? "未命名",
            "basemap-master",
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 border-b border-white/[0.04] bg-nexus-bg-surface/95 px-3 py-2">
            <Database size={12} className="text-nexus-text-muted" />
            <span className="text-[10px] font-semibold tracking-widest text-nexus-text-muted">
              数据图层
            </span>
          </div>
          {layersData.map((layer) =>
            rowBtn(layer.visible, () => toggleLayerVisibility(layer.id), layer.name, layer.id, false),
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 border-b border-white/[0.04] bg-nexus-bg-surface/95 px-3 py-2">
            <LayersIcon size={12} className="text-nexus-text-muted" />
            <span className="text-[10px] font-semibold tracking-widest text-nexus-text-muted">
              矢量图层
            </span>
          </div>
          {basemapVectorLayers.length === 0 ? (
            <div className="border-b border-nexus-border px-3 py-3 text-[10px] leading-relaxed text-nexus-text-muted">
              暂无矢量图层，请检查 public/map-styles/
            </div>
          ) : (
            groupKeys.map((gk) => {
              const items = vectorByGroup.get(gk) ?? [];
              if (items.length === 0) return null;
              return (
                <div key={gk}>
                  <div className="bg-nexus-bg-base/80 px-3 py-1.5 text-[9px] font-medium uppercase tracking-wide text-nexus-text-muted">
                    {VECTOR_LAYER_GROUP_LABELS[gk] ?? gk}
                  </div>
                  {items.map((layer: VectorLayerPanelItem) => {
                    const v = basemapGroupVisible && basemapVectorVisibility[layer.id] !== false;
                    return rowBtn(
                      v,
                      () => toggleBasemapVectorLayer(layer.id),
                      layer.label,
                      `vec-${layer.id}`,
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
