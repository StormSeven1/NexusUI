"use client";

import { useState, useMemo } from "react";
import { Search, Star, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { MOCK_TRACKS } from "@/lib/mock-data";
import { ForceTag } from "@/components/military/ForceTag";
import { MilSymbol } from "@/components/military/MilSymbol";
import type { ForceDisposition } from "@/lib/colors";

const DISPOSITION_ORDER: ForceDisposition[] = [
  "hostile",
  "friendly",
  "neutral",
];

export function TrackListPanel() {
  const { selectTrack, selectedTrackId } = useAppStore();
  const [search, setSearch] = useState("");
  const [filterStarred, setFilterStarred] = useState(false);

  const filtered = useMemo(() => {
    let tracks = MOCK_TRACKS;
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
    return tracks;
  }, [search, filterStarred]);

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
            <button className="flex h-6 w-6 items-center justify-center rounded text-nexus-text-muted hover:bg-white/5 hover:text-nexus-text-secondary">
              <Filter size={12} />
            </button>
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
            placeholder="按关键词搜索"
            className="h-8 w-full rounded-md border border-nexus-border bg-nexus-bg-sidebar pl-8 pr-3 text-xs text-nexus-text-primary placeholder:text-nexus-text-muted focus:border-nexus-border-accent focus:outline-none focus:ring-1 focus:ring-nexus-accent"
          />
        </div>

        <div className="text-[10px] text-nexus-text-muted">
          共 {filtered.length} 个目标
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

            {tracks.map((track) => (
              <button
                key={track.id}
                onClick={() => selectTrack(track.id)}
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
                  size="sm"
                  className="mt-0.5 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-xs font-medium text-nexus-text-primary">
                      {track.name}
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
                    <span>{track.id}</span>
                    <span>·</span>
                    <span>
                      {track.lat.toFixed(2)}°N, {Math.abs(track.lng).toFixed(2)}°
                      {track.lng >= 0 ? "E" : "W"}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-nexus-text-muted">
                    {track.speed} kn · 航向 {track.heading}°
                    {track.type === "air" && track.altitude ? ` · 高度 ${track.altitude}ft` : ""}
                    {track.type === "underwater" ? ` · 深度 ${track.altitude || 0}m` : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
