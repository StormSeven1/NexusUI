"use client";

import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import type { AssetData } from "@/stores/asset-store";
import { Search, Crosshair, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PUBLIC_MAP_SVG_FILES, publicIconFileUrl } from "@/lib/map-icons";
import { normalizeAssetType } from "@/lib/map-entity-model";
import {
  ASSET_PANEL_REFRESH_MS,
  groupAssetsForPanelTree,
  refreshAssetPanelSnapshot,
  type AssetPanelTreeRow,
} from "@/lib/asset-panel-catalog";
import { ASSET_PANEL_TOP_CATEGORIES, type AssetPanelCategoryId } from "@/lib/asset-panel-tree";
import type { MapGisEoMenuContext } from "@/lib/map-gis-eo-menu-context";
import {
  PanelTreeBranchRow,
  PanelTreeGroup,
  panelTreePaddingLeft,
} from "@/components/panels/PanelVisibilityTree";

const STATUS_STYLES = {
  online: { dot: "bg-emerald-400", text: "text-emerald-400", label: "在线" },
  offline: { dot: "bg-red-400", text: "text-red-400", label: "离线" },
  degraded: { dot: "bg-amber-400", text: "text-amber-400", label: "降级" },
};

function StatusChip({ label, online }: { label: string; online: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span className="text-[10px] text-nexus-text-muted">{label}</span>
      <span className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-emerald-400" : "bg-red-400")} />
      <span className={cn("text-[10px] font-medium", online ? "text-emerald-400" : "text-red-400")}>
        {online ? "在线" : "离线"}
      </span>
    </span>
  );
}

function AssetRow({
  row,
  depth,
  isSelected,
  onSelect,
}: {
  row: AssetPanelTreeRow;
  depth: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { asset, label, hasCoords, droneFleetStatus } = row;
  const iconSrc = publicIconFileUrl(PUBLIC_MAP_SVG_FILES[normalizeAssetType(asset.asset_type)]);
  const status = STATUS_STYLES[asset.status as keyof typeof STATUS_STYLES];
  const showSingleStatus = !droneFleetStatus;

  const coordText = hasCoords
    ? `${asset.lat.toFixed(2)}°${asset.lat >= 0 ? "N" : "S"}, ${Math.abs(asset.lng).toFixed(2)}°${asset.lng >= 0 ? "E" : "W"}`
    : "—";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 border-b border-white/[0.03] py-2.5 pr-3 text-left transition-colors hover:bg-white/[0.04]",
        isSelected && "border-emerald-500/20 bg-emerald-500/[0.08]",
      )}
      style={{ paddingLeft: panelTreePaddingLeft(depth) }}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors",
          isSelected
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
            : "border-white/[0.08] bg-white/[0.03] text-nexus-text-secondary",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={iconSrc} alt="" className="h-4 w-4 object-contain opacity-90" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-medium text-nexus-text-primary">{label}</span>
          {showSingleStatus ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
              <span className={cn("text-[10px] font-medium", status.text)}>{status.label}</span>
            </div>
          ) : (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
              <StatusChip label="机场" online={droneFleetStatus.airport === "online"} />
              <StatusChip label="无人机" online={droneFleetStatus.drone === "online"} />
            </div>
          )}
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-nexus-text-muted">
          {asset.id} · {coordText}
          {asset.range_km ? ` · 覆盖 ${asset.range_km}km` : ""}
        </div>
      </div>
      {isSelected ? <Crosshair size={14} className="shrink-0 text-emerald-400" /> : null}
    </button>
  );
}

export function AssetPanel() {
  const [search, setSearch] = useState("");
  const [eoCtx, setEoCtx] = useState<MapGisEoMenuContext | null>(null);
  const [mergedAssets, setMergedAssets] = useState<AssetData[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [openCats, setOpenCats] = useState<Record<AssetPanelCategoryId, boolean>>({
    home: true,
    radar: true,
    camera: true,
    drone: true,
    other: true,
  });
  const selectedAssetId = useAppStore((s) => s.selectedAssetId);
  const selectAsset = useAppStore((s) => s.selectAsset);
  const requestFlyTo = useAppStore((s) => s.requestFlyTo);

  const applySnapshot = useCallback((snap: Awaited<ReturnType<typeof refreshAssetPanelSnapshot>>) => {
    setEoCtx(snap.eoCtx);
    setMergedAssets(snap.merged);
  }, []);

  const runRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const snap = await refreshAssetPanelSnapshot();
      applySnapshot(snap);
    } catch {
      /* 静默失败，可再次手动刷新 */
    } finally {
      setRefreshing(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    void runRefresh();
    const timer = window.setInterval(() => void runRefresh(), ASSET_PANEL_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [runRefresh]);

  const grouped = useMemo(
    () => groupAssetsForPanelTree(mergedAssets, eoCtx, search, onlineOnly),
    [mergedAssets, eoCtx, search, onlineOnly],
  );

  const listedAssets = useMemo(() => {
    const out: AssetData[] = [];
    for (const { id } of ASSET_PANEL_TOP_CATEGORIES) {
      for (const { asset } of grouped.get(id) ?? []) out.push(asset);
    }
    return out;
  }, [grouped]);

  const online = useMemo(() => {
    let n = 0;
    for (const { id } of ASSET_PANEL_TOP_CATEGORIES) {
      for (const row of grouped.get(id) ?? []) {
        const fs = row.droneFleetStatus;
        const isOn = fs
          ? fs.airport === "online" || fs.drone === "online"
          : row.asset.status === "online";
        if (isOn) n += 1;
      }
    }
    return n;
  }, [grouped]);
  const offline = listedAssets.length - online;

  const toggleCat = (id: AssetPanelCategoryId) => {
    setOpenCats((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-white/[0.06] p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">
              资产列表
            </span>
            <button
              type="button"
              title="刷新资产列表"
              aria-label="刷新资产列表"
              disabled={refreshing}
              onClick={() => void runRefresh()}
              className="flex h-6 w-6 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03] text-nexus-text-muted transition-colors hover:bg-white/[0.06] hover:text-nexus-text-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={12} className={cn(refreshing && "animate-spin")} />
            </button>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[10px] text-nexus-text-muted">
              <input
                type="checkbox"
                checked={onlineOnly}
                onChange={(e) => setOnlineOnly(e.target.checked)}
                className="h-3 w-3 rounded border-white/20 accent-emerald-500"
              />
              <span className="whitespace-nowrap">仅显示在线设备</span>
            </label>
            <span className="whitespace-nowrap text-[10px] text-nexus-text-muted">
              {online} 在线 · {offline} 离线
            </span>
          </div>
        </div>
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nexus-text-muted"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索资产"
            className="h-8 w-full rounded-md border border-white/[0.06] bg-white/[0.03] pl-8 pr-3 text-xs text-nexus-text-primary placeholder:text-nexus-text-muted focus:border-white/[0.12] focus:outline-none focus:ring-1 focus:ring-white/[0.08]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <PanelTreeGroup>
          {ASSET_PANEL_TOP_CATEGORIES.map(({ id, label }) => {
            const items = grouped.get(id) ?? [];
            const open = openCats[id] ?? true;
            return (
              <div key={id}>
                <PanelTreeBranchRow
                  depth={0}
                  open={open}
                  onToggleOpen={() => toggleCat(id)}
                  label={`${label} (${items.length})`}
                  labelClassName={id === "home" ? "font-semibold uppercase tracking-wide" : undefined}
                />
                {open ? (
                  <div>
                    {items.length === 0 ? (
                      <p
                        className="border-b border-nexus-border/20 py-2 pr-2 text-[10px] text-nexus-text-muted last:border-b-0"
                        style={{ paddingLeft: panelTreePaddingLeft(1) }}
                      >
                        暂无设备
                      </p>
                    ) : (
                      items.map((row) => {
                        const isSelected = selectedAssetId === row.asset.id;
                        return (
                          <AssetRow
                            key={row.asset.id}
                            row={row}
                            depth={1}
                            isSelected={isSelected}
                            onSelect={() => {
                              selectAsset(isSelected ? null : row.asset.id);
                              if (!isSelected && row.hasCoords) {
                                requestFlyTo(row.asset.lat, row.asset.lng, 14);
                              }
                            }}
                          />
                        );
                      })
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </PanelTreeGroup>
      </div>
    </div>
  );
}
