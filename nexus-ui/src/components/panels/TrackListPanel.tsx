"use client";

/**
 * 目标列表面板 消费 track-store 的实时数据 *
 * 【数据流】WS(useUnifiedWsFeed) setTracks `useTrackStore(s => s.tracks)` 列表渲染 */

import { useState, useMemo } from "react";
import { Search, Star, Plane, Ship } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTrackRenderingConfig } from "@/lib/map-app-config";
import { useAppStore } from "@/stores/app-store";
import { useTrackStore } from "@/stores/track-store";
import { useTrackAliasStore, resolveAliasKey } from "@/stores/track-alias-store";
import { ForceTag } from "@/components/military/ForceTag";
import { MilSymbol } from "@/components/military/MilSymbol";
import type { ForceDisposition } from "@/lib/theme-colors";
import type { Track } from "@/lib/map-entity-model";

const DISPOSITION_ORDER: ForceDisposition[] = [
  "hostile",
  "friendly",
  "neutral",
];

type DomainTab = "all" | "air" | "sea";
const DOMAIN_TABS: { id: DomainTab; label: string; icon: React.ReactNode }[] = [
  { id: "all", label: "全部", icon: null },
  { id: "air", label: "对空", icon: <Plane size={11} /> },
  { id: "sea", label: "对海", icon: <Ship size={11} /> },
];

/**
 * 航向格式化（保留 2 位小数）
 */
function formatHeading2(heading: unknown): string {
  const n = typeof heading === "number" ? heading : Number(heading);
  return Number.isFinite(n) ? n.toFixed(2) : "--";
}

function isAirDomain(t: Track): boolean {
  return t.isAirTrack === true || t.type === "air";
}

function trackRealityLabel(isVirtual?: boolean): string {
  return isVirtual === true ? "虚兵" : "实兵";
}

export function TrackListPanel() {
  const { selectTrack, selectedTrackId, requestFlyTo } = useAppStore();
  const liveTracks = useTrackStore((s) => s.tracks);
  const aliases = useTrackAliasStore((s) => s.aliases);
  const [search, setSearch] = useState("");
  const [filterStarred, setFilterStarred] = useState(false);
  const [domainTab, setDomainTab] = useState<DomainTab>("all");

  const filtered = useMemo(() => {
    let tracks = liveTracks;
    if (search) {
      const q = search.toLowerCase();
      tracks = tracks.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q)
      );
    }
    if (filterStarred) {
      tracks = tracks.filter((t) => t.starred);
    }
    if (domainTab === "air") {
      tracks = tracks.filter(isAirDomain);
    } else if (domainTab === "sea") {
      tracks = tracks.filter((t) => !isAirDomain(t));
    }
    return tracks;
  }, [search, filterStarred, liveTracks, domainTab]);

  const airCount = useMemo(() => liveTracks.filter(isAirDomain).length, [liveTracks]);
  const seaCount = liveTracks.length - airCount;

  const trackRendering = useMemo(() => getTrackRenderingConfig(), []);

  const grouped = useMemo(() => {
    const groups: Record<string, typeof filtered> = {};
    for (const d of DISPOSITION_ORDER) {
      const items = filtered.filter((t) => t.disposition === d);
      if (items.length > 0) groups[d] = items;
    }
    return groups;
  }, [filtered]);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-nexus-border bg-nexus-bg-sidebar p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">
            目标列表
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilterStarred(!filterStarred)}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded transition-colors",
                filterStarred
                  ? "bg-amber-500/15 text-amber-400"
                  : "text-nexus-text-muted hover:bg-white/5 hover:text-nexus-text-secondary"
              )}
            >
              <Star size={12} fill={filterStarred ? "currentColor" : "none"} />
            </button>
          </div>
        </div>

        {/* 对空/对海/全部 tab */}
        <div className="flex items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.02] p-0.5">
          {DOMAIN_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setDomainTab(tab.id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors",
                domainTab === tab.id
                  ? "bg-white/[0.08] text-nexus-text-primary"
                  : "text-nexus-text-muted hover:text-nexus-text-secondary"
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
              <span className="text-[9px] opacity-60">
                {tab.id === "all" ? liveTracks.length : tab.id === "air" ? airCount : seaCount}
              </span>
            </button>
          ))}
        </div>

        <div className="relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nexus-text-muted"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="按关键词搜索"
            className="h-8 w-full rounded-md border border-nexus-border bg-nexus-bg-sidebar pl-8 pr-3 text-xs text-nexus-text-primary placeholder:text-nexus-text-muted focus:border-nexus-border-accent focus:outline-none focus:ring-1 focus:ring-nexus-accent"
          />
        </div>

        <div className="text-[10px] text-nexus-text-muted">
          {filtered.length} 个目标
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {Object.entries(grouped).map(([disposition, tracks]) => (
          <div key={disposition}>
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-nexus-border bg-nexus-bg-elevated px-3 py-1.5 backdrop-blur-sm">
              <ForceTag disposition={disposition as ForceDisposition} />
              <span className="text-[10px] text-nexus-text-muted">
                {tracks.length}
              </span>
            </div>

            {tracks.map((track) => {
              const ts = trackRendering.trackTypeStyles[track.type] ?? trackRendering.trackTypeStyles.sea;
              const friendlyFill =
                track.disposition === "friendly" ? ts.idColor : undefined;
              const isVirtual = track.isVirtual === true;
              return (
              <button
                key={track.id}
                onClick={() => {
                  selectTrack(track.id);
                  requestFlyTo(track.lat, track.lng, 14);
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 border-b border-nexus-border px-3 py-2.5 text-left transition-colors",
                  selectedTrackId === track.id
                    ? "bg-nexus-accent-glow/10 border-l-2 border-l-nexus-accent"
                    : "hover:bg-nexus-bg-elevated"
                )}
              >
                <MilSymbol
                  type={track.type}
                  disposition={track.disposition}
                  virtual={isVirtual}
                  friendlyFill={friendlyFill}
                  size="sm"
                  className="mt-0.5 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-xs font-bold text-nexus-text-primary">
                      {(() => { const k = resolveAliasKey(track); return (k && aliases[k]) ? aliases[k] : track.name; })()}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded px-1 py-0.5 text-[9px] font-medium leading-none",
                        isVirtual
                          ? "bg-amber-500/15 text-amber-300"
                          : "bg-white/[0.06] text-nexus-text-muted",
                      )}
                    >
                      {trackRealityLabel(isVirtual)}
                    </span>
                    {track.starred && (
                      <Star
                        size={10}
                        className="shrink-0 text-amber-400"
                        fill="currentColor"
                      />
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-nexus-text-muted">
                    <span>{track.targetID}</span>
                    <span>·</span>
                    <span>
                      {track.lat.toFixed(2)}°N, {Math.abs(track.lng).toFixed(2)}°
                      {track.lng >= 0 ? "E" : "W"}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-nexus-text-muted">
                    {typeof track.speed === "number" ? track.speed.toFixed(1) : track.speed} m/s·航向 {formatHeading2(track.course)}°
                    {track.type === "air" && track.altitude ? `·高度 ${track.altitude.toFixed(1)}m` : ""}
                    {track.type === "underwater" ? `·深度 ${track.altitude || 0}m` : ""}
                  </div>
                </div>
              </button>
            );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

