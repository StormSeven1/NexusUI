"use client";

import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { useAssetStore, type AssetData } from "@/stores/asset-store";
import { Search, Crosshair } from "lucide-react";
import { useState } from "react";
import { PUBLIC_MAP_SVG_FILES, publicIconFileUrl } from "@/lib/map-icons";
import { normalizeAssetType } from "@/lib/map-entity-model";
import { formatCameraTowerMapLabel, formatTowerMapLabel } from "@/lib/map-app-config";

const STATUS_STYLES = {
  online: { dot: "bg-emerald-400", text: "text-emerald-400", label: "在线" },
  offline: { dot: "bg-red-400", text: "text-red-400", label: "离线" },
  degraded: { dot: "bg-amber-400", text: "text-amber-400", label: "降级" },
};

const MISSION_STYLES: Record<string, { label: string; color: string }> = {
  idle: { label: "", color: "" },
  assigned: { label: "已分配", color: "text-sky-400" },
  en_route: { label: "航行中", color: "text-amber-400" },
  monitoring: { label: "监控中", color: "text-emerald-400" },
  returning: { label: "返航", color: "text-zinc-400" },
};

/** 机场/无人机的 name 在入资产时已解析好，直接用；光电/电侦走 id 提取数字 */
function mapAssetDisplayName(a: AssetData): string {
  if (!a.asset_type) console.warn("[AssetPanel] asset_type 为空:", a.id, a);
  const t = normalizeAssetType(a.asset_type);
  if (t === "camera") return formatCameraTowerMapLabel(a.id);
  if (t === "tower") return formatTowerMapLabel(a.id);
  return a.name;
}

export function AssetPanel() {
  const [search, setSearch] = useState("");
  const selectedAssetId = useAppStore((s) => s.selectedAssetId);
  const selectAsset = useAppStore((s) => s.selectAsset);
  const requestFlyTo = useAppStore((s) => s.requestFlyTo);
  const assets = useAssetStore((s) => s.assets);

  const filtered = assets.filter((a: AssetData) =>
    search
      ? a.name.toLowerCase().includes(search.toLowerCase())
      : true
  );

  const online = filtered.filter((a) => a.status === "online").length;
  const offline = filtered.length - online;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-white/[0.06] p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">
            资产列表
          </span>
          <span className="text-[10px] text-nexus-text-muted">
            {online} 在线 · {offline} 离线
          </span>
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

      <div className="flex-1 overflow-y-auto">
        {filtered.map((asset) => {
          if (!asset.asset_type) console.warn("[AssetPanel/render] asset_type 为空:", asset.id, asset);
          const iconSrc = publicIconFileUrl(PUBLIC_MAP_SVG_FILES[normalizeAssetType(asset.asset_type)]);
          const status = STATUS_STYLES[asset.status as keyof typeof STATUS_STYLES];
          const isSelected = selectedAssetId === asset.id;

          return (
            <button
              key={asset.id}
              onClick={() => {
                selectAsset(isSelected ? null : asset.id);
                if (!isSelected) {
                  requestFlyTo(asset.lat, asset.lng, 14);
                }
              }}
              className={cn(
                "flex w-full items-center gap-3 border-b border-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]",
                isSelected && "bg-emerald-500/[0.08] border-emerald-500/20"
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors",
                  isSelected
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "border-white/[0.08] bg-white/[0.03] text-nexus-text-secondary"
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- 本地 SVG 文件名含中文，用原生 img 避免 loader 配置 */}
                <img src={iconSrc} alt="" className="h-4 w-4 object-contain opacity-90" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="truncate text-xs font-medium text-nexus-text-primary">
                    {mapAssetDisplayName(asset)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
                    <span className={cn("text-[10px] font-medium", status.text)}>
                      {status.label}
                    </span>
                  </div>
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-nexus-text-muted">
                  {asset.id} · {asset.lat.toFixed(2)}°{asset.lat >= 0 ? "N" : "S"}, {Math.abs(asset.lng).toFixed(2)}°{asset.lng >= 0 ? "E" : "W"}
                  {asset.range_km ? ` · 覆盖 ${asset.range_km}km` : ""}
                </div>
                {asset.mission_status && asset.mission_status !== "idle" && (
                  <div className="mt-0.5 flex items-center gap-1">
                    <span className={cn(
                      "text-[10px] font-semibold",
                      MISSION_STYLES[asset.mission_status]?.color ?? "text-sky-400"
                    )}>
                      {MISSION_STYLES[asset.mission_status]?.label ?? asset.mission_status}
                    </span>
                    {asset.assigned_target_id && (
                      <span className="text-[10px] text-nexus-text-muted">
                        目标 {asset.assigned_target_id}
                      </span>
                    )}
                  </div>
                )}
              </div>
              {isSelected && (
                <Crosshair size={14} className="shrink-0 text-emerald-400" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
