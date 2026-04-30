"use client";

/**
 * 目标列表面板 消费 track-store 的实时数据 *
 * 【数据流】WS(useUnifiedWsFeed) setTracks `useTrackStore(s => s.tracks)` 列表渲染 */

import { useState, useMemo } from "react";
import { Search, Star, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTrackIdModeConfig } from "@/lib/map-app-config";
import { useAppStore } from "@/stores/app-store";
import { useTrackStore, getEffectiveTrackDisposition, isTrackAlarmLinked } from "@/stores/track-store";
import { getFusionTrackMarkerFill } from "@/lib/map-icons";
import { ForceTag } from "@/components/military/ForceTag";
import { MilSymbol } from "@/components/military/MilSymbol";
import type { Track } from "@/lib/map-entity-model";

/** 根据航迹 ID 模式返回列表显示的标识：18.141 显示 trackId，28.9 对空显示 showID，对海显示 trackId */
function trackDisplayId(track: { showID: string; trackId?: string; type: string }): string {
  const mode = getTrackIdModeConfig();
  if (!mode.distinguishSeaAir) return track.trackId ?? track.showID;
  return track.type === "air" ? track.showID : (track.trackId ?? track.showID);
}

/**
 * 航向格式化（保留 2 位小数）
 * Heading formatter (keep 2 decimals)
 *
 * @param heading 航向角度（度） heading in degrees
 * @returns 格式化后的字符串；无效值返回 "--" / formatted string; "--" if invalid
 */
function formatHeading2(heading: unknown): string {
  const n = typeof heading === "number" ? heading : Number(heading);
  return Number.isFinite(n) ? n.toFixed(2) : "--";
}

function TrackListRow({
  track,
  selectedTrackId,
  onSelect,
}: {
  track: Track;
  selectedTrackId: string | null;
  onSelect: () => void;
}) {
  const disp = getEffectiveTrackDisposition(track);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 border-b border-nexus-border px-3 py-2.5 text-left transition-colors",
        selectedTrackId === track.id
          ? "bg-nexus-accent-glow/10 border-l-2 border-l-nexus-accent"
          : "hover:bg-nexus-bg-elevated"
      )}
    >
      <MilSymbol
        type={track.type}
        disposition={disp}
        virtual={track.isVirtual === true}
        neutralFusionFill={disp === "neutral" ? getFusionTrackMarkerFill(track) : undefined}
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
          <span>{trackDisplayId(track)}</span>
          <span>·</span>
          <span>
            {track.lat.toFixed(2)}°N, {Math.abs(track.lng).toFixed(2)}°
            {track.lng >= 0 ? "E" : "W"}
          </span>
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-nexus-text-muted">
          {typeof track.speed === "number" ? track.speed.toFixed(1) : track.speed} kn · 航向 {formatHeading2(track.heading)}°
          {track.type === "air" && track.altitude ? ` · 高度 ${track.altitude.toFixed(1)}ft` : ""}
          {track.type === "underwater" ? ` · 深度 ${track.altitude || 0}m` : ""}
        </div>
      </div>
    </button>
  );
}

export function TrackListPanel() {
  const { selectTrack, selectedTrackId, requestFlyTo } = useAppStore();
  const liveTracks = useTrackStore((s) => s.tracks);
  const [search, setSearch] = useState("");
  const [filterStarred, setFilterStarred] = useState(false);

  const allTracks = liveTracks;

  const filtered = useMemo(() => {
    let tracks = allTracks;
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
  }, [search, filterStarred, allTracks]);

  /** 左侧分栏：告警关联（渲染层）与其余目标 */
  const { alarmLinkedTracks, otherTracks } = useMemo(() => {
    const alarmLinkedTracks = filtered.filter((t) => isTrackAlarmLinked(t));
    const otherTracks = filtered.filter((t) => !isTrackAlarmLinked(t));
    return { alarmLinkedTracks, otherTracks };
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
          {filtered.length} 个目标        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {alarmLinkedTracks.length > 0 && (
          <div>
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-nexus-border bg-nexus-bg-elevated px-3 py-1.5 backdrop-blur-sm">
              <span className="text-[10px] font-semibold tracking-wide text-nexus-text-secondary">
                告警关联目标
              </span>
              <ForceTag disposition="hostile" />
              <span className="text-[10px] text-nexus-text-muted">{alarmLinkedTracks.length}</span>
            </div>
            {alarmLinkedTracks.map((track) => (
              <TrackListRow
                key={track.id}
                track={track}
                selectedTrackId={selectedTrackId}
                onSelect={() => {
                  selectTrack(track.id);
                  requestFlyTo(track.lat, track.lng, 11);
                }}
              />
            ))}
          </div>
        )}
        {otherTracks.length > 0 && (
          <div>
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-nexus-border bg-nexus-bg-elevated px-3 py-1.5 backdrop-blur-sm">
              <span className="text-[10px] font-semibold tracking-wide text-nexus-text-secondary">
                其他目标
              </span>
              <ForceTag disposition="neutral" />
              <span className="text-[10px] text-nexus-text-muted">{otherTracks.length}</span>
            </div>
            {otherTracks.map((track) => (
              <TrackListRow
                key={track.id}
                track={track}
                selectedTrackId={selectedTrackId}
                onSelect={() => {
                  selectTrack(track.id);
                  requestFlyTo(track.lat, track.lng, 11);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
