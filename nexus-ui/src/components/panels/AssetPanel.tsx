"use client";

import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { useAssetStore, type AssetData } from "@/stores/asset-store";
import { useDroneStore, type DroneTelemetry, type DockTelemetry, DOCK_MODE_LABELS } from "@/stores/drone-store";
import { Search, ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { PUBLIC_MAP_SVG_FILES, publicIconFileUrl } from "@/lib/map-icons";
import { normalizeAssetType, type PublicMapAssetType } from "@/lib/map-entity-model";
import {
  formatCameraTowerMapLabel,
  formatTowerMapLabel,
  getAssetDeviceStateTags,
} from "@/lib/map-app-config";

/** 资产类别展示顺序和中文名 */
const CATEGORY_ORDER: { type: PublicMapAssetType; label: string }[] = [
  { type: "airport", label: "机场" },
  { type: "usv", label: "无人船" },
  { type: "missile", label: "飞弹" },
  { type: "radar", label: "雷达" },
  { type: "camera", label: "光电" },
  { type: "tower", label: "电侦" },
  { type: "laser", label: "激光" },
  { type: "tdoa", label: "TDOA" },
];

/** 机场/无人机的 name 在入资产时已解析好，直接用；光电/电侦走 id 提取数字 */
function mapAssetDisplayName(a: AssetData): string {
  const t = normalizeAssetType(a.asset_type);
  if (t === "camera") return formatCameraTowerMapLabel(a.id);
  if (t === "tower") return formatTowerMapLabel(a.id);
  return a.name;
}

/** 状态标签 */
function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-medium leading-none", color)}>
      {label}
    </span>
  );
}

/** 电量进度条 */
function BatteryBar({ percent }: { percent: number }) {
  const clamp = Math.max(0, Math.min(100, percent));
  const color = clamp > 50 ? "bg-emerald-500" : clamp > 20 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="flex items-center gap-1">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${clamp}%` }} />
      </div>
      <span className="text-[10px] font-medium text-nexus-text-muted">{clamp}%</span>
    </div>
  );
}

/** 单条资产行 */
function AssetRow({
  asset,
  isSelected,
  indent,
  onSelect,
  tags,
  batteryPercent,
}: {
  asset: AssetData;
  isSelected: boolean;
  indent?: boolean;
  onSelect: () => void;
  tags?: { label: string; color: string }[];
  batteryPercent?: number | null;
}) {
  const iconSrc = publicIconFileUrl(PUBLIC_MAP_SVG_FILES[normalizeAssetType(asset.asset_type)]);
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 border-b border-white/[0.03] px-3 py-2 text-left transition-colors hover:bg-white/[0.04]",
        indent && "pl-9",
        isSelected && "bg-emerald-500/[0.08]",
      )}
    >
      <div
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
          isSelected
            ? "border-emerald-500/40 bg-emerald-500/10"
            : "border-white/[0.08] bg-white/[0.03]",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={iconSrc} alt="" className="h-3 w-3 object-contain opacity-90" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-[12px] font-medium text-nexus-text-primary">
            {mapAssetDisplayName(asset)}
          </span>
          {tags && tags.length > 0 && (
            <div className="flex shrink-0 items-center gap-1">
              {tags.map((t, i) => <Tag key={i} label={t.label} color={t.color} />)}
            </div>
          )}
        </div>
        {typeof batteryPercent === "number" && (
          <div className="mt-1">
            <BatteryBar percent={batteryPercent} />
          </div>
        )}
      </div>
    </button>
  );
}

/** 机场卡片：左侧状态+电量，右侧无人机列表 */
function AirportCard({
  asset,
  dock,
  isSelected,
  onSelect,
  childDrones,
  selectedAssetId,
  onSelectDrone,
}: {
  asset: AssetData;
  dock: DockTelemetry | undefined;
  isSelected: boolean;
  onSelect: () => void;
  childDrones: { asset: AssetData; telemetry: DroneTelemetry | undefined }[];
  selectedAssetId: string | null;
  onSelectDrone: (d: AssetData) => void;
}) {
  const hasDockTelemetry = dock != null && Object.keys(dock.payload).length > 0;
  const modeLabel = dock?.modeCode != null
    ? (DOCK_MODE_LABELS[dock.modeCode] ?? `状态${dock.modeCode}`)
    : hasDockTelemetry
      ? "已连接"
      : (asset.status === "online" ? "等待状态" : "未连接");
  const modeColor = dock?.modeCode === 4
    ? "text-amber-400"
    : hasDockTelemetry || asset.status === "online"
      ? (dock?.modeCode != null ? "text-emerald-400" : "text-nexus-text-muted")
      : "text-red-400";

  return (
    <div className={cn(
      "mx-2 my-1 rounded border transition-colors",
      isSelected ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "border-white/[0.08] bg-white/[0.02]",
    )}>
      {/* 标题行 */}
      <button
        onClick={onSelect}
        className="flex w-full items-center px-2.5 py-0.5 text-left hover:bg-white/[0.03]"
      >
        <span className="text-[12px] font-semibold text-nexus-text-primary">
          {mapAssetDisplayName(asset)}
        </span>
      </button>

      {/* 内容区：左侧状态+电量，右侧无人机 */}
      <div className="flex border-t border-white/[0.06]">
        <div className="flex flex-[2] flex-col gap-0 px-2.5 py-0.5">
          <span className={cn("text-[11px] font-medium leading-tight", modeColor)}>{modeLabel}</span>
          <div className="mt-px">
            {dock?.batteryPercent != null
              ? <BatteryBar percent={dock.batteryPercent} />
              : <span className="text-[9px] text-nexus-text-muted">--</span>}
          </div>
        </div>
        <div className="flex flex-1 flex-col justify-center gap-0 border-l border-white/[0.06] px-1.5 py-0.5">
          {childDrones.length === 0 && (
            <span className="text-[10px] text-nexus-text-muted">无无人机</span>
          )}
          {childDrones.map(({ asset: d }) => {
            const connected = d.status === "online";
            return (
              <button
                key={d.id}
                onClick={(e) => { e.stopPropagation(); onSelectDrone(d); }}
                className={cn(
                  "flex items-center gap-1 rounded px-1 py-px text-left transition-colors hover:bg-white/[0.05]",
                  selectedAssetId === d.id && "bg-emerald-500/[0.1]",
                )}
              >
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", connected ? "bg-emerald-400" : "bg-red-400")} />
                <span className="truncate text-[11px] text-nexus-text-primary">{d.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function AssetPanel() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());

  const selectedAssetId = useAppStore((s) => s.selectedAssetId);
  const selectAsset = useAppStore((s) => s.selectAsset);
  const requestFlyTo = useAppStore((s) => s.requestFlyTo);
  const assets = useAssetStore((s) => s.assets);
  const airportToDrones = useDroneStore((s) => s.airportToDrones);
  const droneTelemetry = useDroneStore((s) => s.drones);
  const dockTelemetry = useDroneStore((s) => s.docks);

  /** 按类别分组（drone 由 airport 管理，不单独列出） */
  const grouped = useMemo(() => {
    const map = new Map<PublicMapAssetType, AssetData[]>();
    const q = search.toLowerCase();
    for (const a of assets) {
      let t: PublicMapAssetType;
      try { t = normalizeAssetType(a.asset_type); } catch { continue; }
      if (t === "drone") continue; // drones rendered under airport
      if (typeFilter !== "all" && t !== typeFilter) continue;
      if (q && !a.name.toLowerCase().includes(q) && !a.id.toLowerCase().includes(q)) continue;
      const arr = map.get(t) ?? [];
      arr.push(a);
      map.set(t, arr);
    }
    return map;
  }, [assets, search, typeFilter]);

  /** 无人机资产快速查找 */
  const droneById = useMemo(() => {
    const m = new Map<string, AssetData>();
    for (const a of assets) {
      try { if (normalizeAssetType(a.asset_type) === "drone") m.set(a.id, a); } catch { /* skip */ }
    }
    return m;
  }, [assets]);

  const toggleCat = (cat: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const handleSelect = (a: AssetData) => {
    const isSel = selectedAssetId === a.id;
    selectAsset(isSel ? null : a.id);
    if (!isSel) requestFlyTo(a.lat, a.lng, 14);
  };

  const online = assets.filter((a) => a.status === "online").length;
  const offline = assets.length - online;

  /** 搜索包含 drone 时，让含有匹配 drone 的 airport 类别也显示 */
  const droneMatchesAirport = useMemo(() => {
    if (!search) return new Set<string>();
    const q = search.toLowerCase();
    const set = new Set<string>();
    for (const [airportSn, droneSns] of Object.entries(airportToDrones)) {
      for (const dsn of droneSns) {
        const d = droneById.get(dsn);
        if (d && (d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q))) {
          set.add(airportSn);
        }
      }
    }
    return set;
  }, [search, airportToDrones, droneById]);

  return (
    <div className="flex h-full flex-col">
      {/* 头部：标题 + 统计 */}
      <div className="space-y-2 border-b border-white/[0.06] p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">
            资产列表
          </span>
          <span className="text-[10px] text-nexus-text-muted">
            {online} 在线 · {offline} 离线
          </span>
        </div>
        {/* 搜索 + 类型下拉 */}
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nexus-text-muted"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索资产"
              className="h-7 w-full rounded-md border border-white/[0.06] bg-white/[0.03] pl-8 pr-2 text-[11px] text-nexus-text-primary placeholder:text-nexus-text-muted focus:border-white/[0.12] focus:outline-none focus:ring-1 focus:ring-white/[0.08]"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-7 rounded-md border border-white/[0.06] bg-[#1e1e24] px-1.5 text-[10px] text-nexus-text-primary focus:outline-none"
          >
            <option value="all" className="bg-[#1e1e24]">全部</option>
            {CATEGORY_ORDER.map((c) => (
              <option key={c.type} value={c.type} className="bg-[#1e1e24]">{c.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 分类列表 */}
      <div className="flex-1 overflow-y-auto">
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped.get(cat.type);
          // 如果搜索命中了某个 airport 下的 drone，也要显示该 airport 类别
          const hasMatchedDrones = cat.type === "airport" && droneMatchesAirport.size > 0;
          if (!items?.length && !hasMatchedDrones) return null;
          // 把 drone 搜索命中的 airport 也加入 items（如果不在里面）
          const finalItems = items ? [...items] : [];
          if (hasMatchedDrones) {
            for (const apSn of droneMatchesAirport) {
              if (!finalItems.some((i) => i.id === apSn)) {
                const ap = assets.find((a) => a.id === apSn);
                if (ap) finalItems.push(ap);
              }
            }
          }
          if (!finalItems.length) return null;

          const collapsed = collapsedCats.has(cat.type);
          const count = cat.type === "airport"
            ? finalItems.length + finalItems.reduce((n, ap) => n + (airportToDrones[ap.id]?.length ?? 0), 0)
            : finalItems.length;

          return (
            <div key={cat.type}>
              {/* 类别头 */}
              <button
                onClick={() => toggleCat(cat.type)}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-white/[0.04] border-b border-white/[0.04]"
              >
                <div className="flex items-center gap-1.5">
                  {collapsed
                    ? <ChevronRight size={12} className="text-nexus-text-muted" />
                    : <ChevronDown size={12} className="text-nexus-text-muted" />}
                  <span className="text-[11px] font-semibold text-nexus-text-secondary">{cat.label}</span>
                </div>
                <span className="text-[10px] text-nexus-text-muted">{count}</span>
              </button>

              {/* 类别内容 */}
              {!collapsed && finalItems.map((asset) => {
                const isAirport = cat.type === "airport";
                const childDroneSns = isAirport ? (airportToDrones[asset.id] ?? []) : [];
                const q = search.toLowerCase();

                return (
                  <div key={asset.id}>
                    {isAirport ? (
                      <AirportCard
                        asset={asset}
                        dock={dockTelemetry[asset.id]}
                        isSelected={selectedAssetId === asset.id}
                        onSelect={() => handleSelect(asset)}
                        childDrones={childDroneSns
                          .map((dsn) => ({ asset: droneById.get(dsn)!, telemetry: droneTelemetry[dsn] }))
                          .filter((d) => {
                            if (!d.asset) return false;
                            if (!q) return true;
                            return d.asset.name.toLowerCase().includes(q) || d.asset.id.toLowerCase().includes(q) || asset.name.toLowerCase().includes(q);
                          })}
                        selectedAssetId={selectedAssetId}
                        onSelectDrone={(d) => handleSelect(d)}
                      />
                    ) : (
                      <AssetRow
                        asset={asset}
                        isSelected={selectedAssetId === asset.id}
                        onSelect={() => handleSelect(asset)}
                        tags={getAssetDeviceStateTags(asset)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
