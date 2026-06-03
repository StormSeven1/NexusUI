"use client";

/**
 * 图层面板（三大分类）：
 * 1. 地图图层 — 矢量图层（可展开子分组）、瓦片图层；两者可切换上下渲染顺序
 * 2. 数据图层 — 对海目标、对空目标
 * 3. 资产图层 — 各类资产（雷达、光电、电侦、机场、无人机、激光、TDOA、限制区域）
 */

import { cn } from "@/lib/utils";
import { useAssetStore } from "@/stores/asset-store";
import {
  VECTOR_LAYER_GROUP_LABELS,
  type VectorLayerPanelItem,
} from "@/lib/map-2d-basemap-layer-panel";
import {
  LYR_TRACKS_AIR,
  LYR_TRACKS_SEA,
  LYR_DB_AREAS,
  LYR_DRONES,
  LYR_RADAR_COVERAGE,
  LYR_OPTO_FOV,
  LYR_TOWER,
  LYR_AIRPORT,
  LYR_USV,
  LYR_MISSILE,
  LYR_LASER,
  LYR_TDOA,
  normalizeAssetType,
  type PublicMapAssetType,
} from "@/lib/map-entity-model";
import { getTileLayerConfigs } from "@/lib/map-app-config";
import { useAppStore } from "@/stores/app-store";
import {
  Eye,
  EyeOff,
  Map as MapIcon,
  Database,
  Radio,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

/** 眼睛开关行 — 整行可点击切换显隐 */
function VisRow({
  visible,
  label,
  onToggle,
  disabled,
  extra,
}: {
  visible: boolean;
  label: string;
  onToggle: () => void;
  disabled?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-2 border-b border-white/[0.03] px-3 py-2 text-left",
        disabled ? "cursor-not-allowed opacity-50" : "hover:bg-white/[0.04]",
      )}
    >
      <div
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
          visible
            ? "border-nexus-border-accent bg-nexus-accent-glow/20 text-nexus-text-primary"
            : "border-nexus-border bg-nexus-bg-sidebar text-nexus-text-muted",
        )}
      >
        {visible ? <Eye size={9} /> : <EyeOff size={9} />}
      </div>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[11px]",
          visible ? "text-nexus-text-primary" : "text-nexus-text-muted",
        )}
      >
        {label}
      </span>
      {extra && (
        <span onClick={(e) => e.stopPropagation()} className="shrink-0">
          {extra}
        </span>
      )}
    </button>
  );
}

/** 可折叠的一级分类头（无上下箭头） */
function CategoryHeader({
  icon,
  label,
  collapsed,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-1.5 border-b border-white/[0.06] bg-nexus-bg-surface/95 px-2 py-1.5 text-left"
    >
      {collapsed ? (
        <ChevronRight size={11} className="text-nexus-text-muted" />
      ) : (
        <ChevronDown size={11} className="text-nexus-text-muted" />
      )}
      <span className="flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] font-semibold tracking-wider text-nexus-text-muted">
          {label}
        </span>
      </span>
    </button>
  );
}

/** 二级子分组头，可选上下移动按钮 */
function SubGroupHeader({
  label,
  collapsed,
  onToggle,
  onMoveUp,
  onMoveDown,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  return (
    <div className="flex items-center bg-nexus-bg-base/60 px-4 py-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex flex-1 items-center gap-1 text-left"
      >
        {collapsed ? (
          <ChevronRight size={9} className="text-nexus-text-muted" />
        ) : (
          <ChevronDown size={9} className="text-nexus-text-muted" />
        )}
        <span className="text-[9px] font-medium tracking-wide text-nexus-text-muted">{label}</span>
      </button>
      {(onMoveUp || onMoveDown) && (
        <div className="flex items-center gap-0.5">
          {onMoveUp && (
            <button
              type="button"
              onClick={onMoveUp}
              className="rounded p-0.5 text-nexus-text-muted hover:bg-white/[0.08] hover:text-nexus-text-primary"
              title="上移（在地图上层显示）"
            >
              <ArrowUp size={10} />
            </button>
          )}
          {onMoveDown && (
            <button
              type="button"
              onClick={onMoveDown}
              className="rounded p-0.5 text-nexus-text-muted hover:bg-white/[0.08] hover:text-nexus-text-primary"
              title="下移（在地图下层显示）"
            >
              <ArrowDown size={10} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 三级子分组头（矢量图层内部的 背景/水系 等） */
function VectorSubGroupHeader({
  label,
  collapsed,
  onToggle,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-1 bg-nexus-bg-base/40 px-6 py-1 text-left"
    >
      {collapsed ? (
        <ChevronRight size={8} className="text-nexus-text-muted" />
      ) : (
        <ChevronDown size={8} className="text-nexus-text-muted" />
      )}
      <span className="text-[9px] font-medium tracking-wide text-nexus-text-muted">{label}</span>
    </button>
  );
}

type MapSubLayerId = "vector" | "tile";

export function LayerPanel() {
  const assets = useAssetStore((s) => s.assets);
  const layerVisibility = useAppStore((s) => s.layerVisibility);
  const toggleLayerVisibility = useAppStore((s) => s.toggleLayerVisibility);

  const basemapVectorLayers = useAppStore((s) => s.basemapVectorLayers);
  const basemapGroupVisible = useAppStore((s) => s.basemapGroupVisible);
  const basemapVectorVisibility = useAppStore((s) => s.basemapVectorVisibility);
  const toggleBasemapGroupVisible = useAppStore((s) => s.toggleBasemapGroupVisible);
  const toggleBasemapVectorLayer = useAppStore((s) => s.toggleBasemapVectorLayer);
  const tileLayerVisibility = useAppStore((s) => s.tileLayerVisibility);
  const toggleTileLayerVisible = useAppStore((s) => s.toggleTileLayerVisible);

  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  /** 矢量/瓦片在地图中的渲染顺序（数组靠后 = 地图上层），存 store 供 Map2D 订阅 */
  const mapSubOrder = useAppStore((s) => s.mapLayerOrder) as MapSubLayerId[];
  const setMapLayerOrder = useAppStore((s) => s.setMapLayerOrder);

  const toggleCat = (id: string) =>
    setCollapsedCats((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const toggleGroup = (id: string) =>
    setCollapsedGroups((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const swapMapSub = useCallback((id: MapSubLayerId, dir: -1 | 1) => {
    const arr = [...mapSubOrder];
    const idx = arr.indexOf(id);
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    setMapLayerOrder(arr);
  }, [mapSubOrder, setMapLayerOrder]);

  /** 矢量图层按 group 分组 */
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

  /** 瓦片图层配置 */
  const tileLayers = useMemo(() => getTileLayerConfigs(), []);

  /** 资产类型检测 */
  const assetTypes = useMemo(() => {
    const s = new Set<PublicMapAssetType>();
    for (const a of assets) {
      try { s.add(normalizeAssetType(a.asset_type)); } catch { /* skip */ }
    }
    return s;
  }, [assets]);

  /** 资产图层行 */
  const assetLayerRows = useMemo(() => {
    const rows: { id: string; name: string }[] = [];
    rows.push({ id: LYR_DRONES, name: "无人机" });
    if (assetTypes.has("radar")) rows.push({ id: LYR_RADAR_COVERAGE, name: "雷达装备" });
    if (assetTypes.has("camera")) rows.push({ id: LYR_OPTO_FOV, name: "光电装备" });
    if (assetTypes.has("tower")) rows.push({ id: LYR_TOWER, name: "电侦装备" });
    if (assetTypes.has("airport")) rows.push({ id: LYR_AIRPORT, name: "无人机场" });
    if (assetTypes.has("usv")) rows.push({ id: LYR_USV, name: "无人船" });
    if (assetTypes.has("missile")) rows.push({ id: LYR_MISSILE, name: "飞弹" });
    if (assetTypes.has("laser")) rows.push({ id: LYR_LASER, name: "激光武器" });
    if (assetTypes.has("tdoa")) rows.push({ id: LYR_TDOA, name: "TDOA" });
    rows.push({ id: LYR_DB_AREAS, name: "区域" });
    return rows;
  }, [assetTypes]);

  const renderVectorSub = (idx: number) => {
    const id: MapSubLayerId = "vector";
    const collapsed = collapsedGroups.has("vector-root");
    return (
      <div key={id} className="pl-2">
        <SubGroupHeader
          label="矢量图层"
          collapsed={collapsed}
          onToggle={() => toggleGroup("vector-root")}
          onMoveUp={idx > 0 ? () => swapMapSub(id, -1) : undefined}
          onMoveDown={idx < mapSubOrder.length - 1 ? () => swapMapSub(id, 1) : undefined}
        />
        {!collapsed && (
          <div className="pl-2">
            <VisRow
              visible={basemapGroupVisible}
              label="矢量底图总开关"
              onToggle={toggleBasemapGroupVisible}
            />
            {basemapVectorLayers.length > 0 &&
              groupKeys.map((gk) => {
                const items = vectorByGroup.get(gk) ?? [];
                if (items.length === 0) return null;
                const gCollapsed = collapsedGroups.has(`vg-${gk}`);
                return (
                  <div key={gk}>
                    <VectorSubGroupHeader
                      label={VECTOR_LAYER_GROUP_LABELS[gk] ?? gk}
                      collapsed={gCollapsed}
                      onToggle={() => toggleGroup(`vg-${gk}`)}
                    />
                    {!gCollapsed &&
                      items.map((layer: VectorLayerPanelItem) => {
                        const v = basemapGroupVisible && basemapVectorVisibility[layer.id] !== false;
                        return (
                          <div key={`vec-${layer.id}`} className="pl-6">
                            <VisRow
                              visible={v}
                              label={layer.label}
                              onToggle={() => toggleBasemapVectorLayer(layer.id)}
                            />
                          </div>
                        );
                      })}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    );
  };

  /* ── 瓦片图层子面板 ── */
  const renderTileSub = (idx: number) => {
    const id: MapSubLayerId = "tile";
    const collapsed = collapsedGroups.has("tile-root");
    return (
      <div key={id} className="pl-2">
        <SubGroupHeader
          label="瓦片图层"
          collapsed={collapsed}
          onToggle={() => toggleGroup("tile-root")}
          onMoveUp={idx > 0 ? () => swapMapSub(id, -1) : undefined}
          onMoveDown={idx < mapSubOrder.length - 1 ? () => swapMapSub(id, 1) : undefined}
        />
        {!collapsed && (
          <div className="pl-2">
            {tileLayers.length === 0 ? (
              <div className="px-4 py-2 text-[10px] text-nexus-text-muted">
                暂无瓦片图层配置
              </div>
            ) : (
              tileLayers.map((tc) => (
                <VisRow
                  key={tc.id}
                  visible={tileLayerVisibility[tc.id] ?? false}
                  label={tc.name}
                  onToggle={() => toggleTileLayerVisible(tc.id)}
                  disabled={!tc.url}
                />
              ))
            )}
          </div>
        )}
      </div>
    );
  };

  const mapSubRenderers: Record<MapSubLayerId, (idx: number) => React.ReactNode> = {
    vector: renderVectorSub,
    tile: renderTileSub,
  };

  /* ── 三大一级分类 ── */
  const renderMap = () => {
    const collapsed = collapsedCats.has("map");
    return (
      <div key="map">
        <CategoryHeader
          icon={<MapIcon size={11} className="text-nexus-text-muted" />}
          label="地图图层"
          collapsed={collapsed}
          onToggle={() => toggleCat("map")}
        />
        {!collapsed && mapSubOrder.map((subId, idx) => mapSubRenderers[subId](idx))}
      </div>
    );
  };

  const renderData = () => {
    const collapsed = collapsedCats.has("data");
    const airVis = layerVisibility[LYR_TRACKS_AIR] ?? true;
    const seaVis = layerVisibility[LYR_TRACKS_SEA] ?? true;
    return (
      <div key="data">
        <CategoryHeader
          icon={<Database size={11} className="text-nexus-text-muted" />}
          label="数据图层"
          collapsed={collapsed}
          onToggle={() => toggleCat("data")}
        />
        {!collapsed && (
          <>
            <VisRow
              visible={airVis}
              label="对空目标"
              onToggle={() => toggleLayerVisibility(LYR_TRACKS_AIR)}
            />
            <VisRow
              visible={seaVis}
              label="对海目标"
              onToggle={() => toggleLayerVisibility(LYR_TRACKS_SEA)}
            />
          </>
        )}
      </div>
    );
  };

  const renderAsset = () => {
    const collapsed = collapsedCats.has("asset");
    return (
      <div key="asset">
        <CategoryHeader
          icon={<Radio size={11} className="text-nexus-text-muted" />}
          label="资产图层"
          collapsed={collapsed}
          onToggle={() => toggleCat("asset")}
        />
        {!collapsed &&
          assetLayerRows.map((row) => (
            <VisRow
              key={row.id}
              visible={layerVisibility[row.id] ?? true}
              label={row.name}
              onToggle={() => toggleLayerVisibility(row.id)}
            />
          ))}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/[0.06] p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">
            图层
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {renderMap()}
        {renderData()}
        {renderAsset()}
      </div>
    </div>
  );
}
