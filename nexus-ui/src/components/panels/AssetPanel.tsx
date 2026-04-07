"use client";

import { MOCK_ASSETS } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import {
  Radio,
  Camera,
  Antenna,
  Plane,
  Satellite,
  Search,
} from "lucide-react";
import { useState } from "react";

const ASSET_ICONS = {
  radar: Radio,
  camera: Camera,
  tower: Antenna,
  drone: Plane,
  satellite: Satellite,
} as const;

const STATUS_STYLES = {
  online: { dot: "bg-emerald-400", text: "text-emerald-400", label: "在线" },
  offline: { dot: "bg-red-400", text: "text-red-400", label: "离线" },
  degraded: { dot: "bg-amber-400", text: "text-amber-400", label: "降级" },
};

export function AssetPanel() {
  const [search, setSearch] = useState("");

  const filtered = MOCK_ASSETS.filter((a) =>
    search
      ? a.name.toLowerCase().includes(search.toLowerCase())
      : true
  );

  const online = filtered.filter((a) => a.status === "online").length;
  const degraded = filtered.filter((a) => a.status === "degraded").length;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-white/[0.06] p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">
            资产列表
          </span>
          <span className="text-[10px] text-nexus-text-muted">
            {online} 在线 · {degraded} 降级
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
          const Icon = ASSET_ICONS[asset.type];
          const status = STATUS_STYLES[asset.status];

          return (
            <div
              key={asset.id}
              className="flex items-center gap-3 border-b border-white/[0.03] px-3 py-2.5 hover:bg-white/[0.02]"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03] text-nexus-text-secondary">
                <Icon size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="truncate text-xs font-medium text-nexus-text-primary">
                    {asset.name}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
                    <span className={cn("text-[10px] font-medium", status.text)}>
                      {status.label}
                    </span>
                  </div>
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-nexus-text-muted">
                  {asset.id} · {asset.lat.toFixed(2)}°N, {Math.abs(asset.lng).toFixed(2)}°W
                  {asset.range ? ` · 覆盖 ${asset.range}km` : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
