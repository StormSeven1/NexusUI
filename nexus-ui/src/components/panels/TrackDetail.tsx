"use client";

import { MOCK_TRACKS } from "@/lib/mock-data";
import { ForceTag } from "@/components/military/ForceTag";
import { MilSymbol } from "@/components/military/MilSymbol";
import { Timeline } from "@/components/military/Timeline";
import {
  Star,
  MapPin,
  Crosshair,
  Navigation,
  Gauge,
  Radio,
  Eye,
  Clock,
  Ruler,
  Thermometer,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TrackDetailProps {
  trackId: string;
}

export function TrackDetail({ trackId }: TrackDetailProps) {
  const track = MOCK_TRACKS.find((t) => t.id === trackId);
  if (!track) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-nexus-text-muted">
        未找到航迹
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* 航迹头部 */}
      <div className="border-b border-white/[0.06] p-4">
        <div className="flex items-start gap-3">
          <MilSymbol
            type={track.type}
            disposition={track.disposition}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-nexus-text-primary">
                {track.name}
              </h3>
              <Star
                size={12}
                className={cn(
                  "shrink-0",
                  track.starred
                    ? "text-amber-400"
                    : "text-nexus-text-muted"
                )}
                fill={track.starred ? "currentColor" : "none"}
              />
            </div>
            <div className="mt-1 flex items-center gap-2">
              <ForceTag disposition={track.disposition} />
              <span className="font-mono text-[10px] text-nexus-text-muted">
                {track.id}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 时间轴 */}
      <div className="border-b border-white/[0.06] p-4">
        <h4 className="mb-3 text-[10px] font-semibold tracking-widest text-nexus-text-muted">
          航迹时间线
        </h4>
        <Timeline />
      </div>

      {/* 属性网格 */}
      <div className="border-b border-white/[0.06] p-4">
        <h4 className="mb-3 text-[10px] font-semibold tracking-widest text-nexus-text-muted">
          航迹属性
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <PropCard icon={Gauge} label="速度" value={`${track.speed}`} unit={track.type === "ground" ? "mph" : "kn"} />
          <PropCard icon={Navigation} label="航向" value={`${track.heading}`} unit="°" />
          <PropCard
            icon={MapPin}
            label="纬度"
            value={`${track.lat.toFixed(4)}`}
            unit="°N"
          />
          <PropCard
            icon={MapPin}
            label="经度"
            value={`${Math.abs(track.lng).toFixed(4)}`}
            unit={`°${track.lng >= 0 ? "E" : "W"}`}
          />
          {track.altitude && (
            <PropCard icon={Crosshair} label="高度" value={`${track.altitude}`} unit="ft" />
          )}
          <PropCard icon={Radio} label="传感器" value={track.sensor} />
          <PropCard icon={Eye} label="最后更新" value={track.lastUpdate} />
          <PropCard icon={Clock} label="追踪时长" value="10m22s" />
        </div>
      </div>

      {/* 轨迹历史 */}
      <div className="p-4">
        <h4 className="mb-3 text-[10px] font-semibold tracking-widest text-nexus-text-muted">
          航迹历史
        </h4>
        <div className="space-y-0">
          <HistoryRow time="14:02:41" event={`速度 ${track.speed} ${track.type === "ground" ? "mph" : "kn"} · 航向 ${track.heading}°`} />
          <HistoryRow time="14:01:30" event="航向变更 → 当前方位" />
          <HistoryRow time="14:00:15" event="速度变化检测" />
          <HistoryRow time="13:58:00" event="传感器确认目标" />
          <HistoryRow time="13:52:19" event="首次探测" highlight />
        </div>
      </div>
    </div>
  );
}

function PropCard({
  icon: Icon,
  label,
  value,
  unit,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="rounded-md border border-white/[0.04] bg-white/[0.02] px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <Icon size={10} className="text-nexus-text-muted" />
        <span className="text-[10px] text-nexus-text-muted">{label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-0.5">
        <span className="font-mono text-sm font-semibold text-nexus-text-primary">{value}</span>
        {unit && <span className="font-mono text-[10px] text-nexus-text-muted">{unit}</span>}
      </div>
    </div>
  );
}

function HistoryRow({
  time,
  event,
  highlight,
}: {
  time: string;
  event: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 border-l border-white/[0.08] py-2 pl-3">
      <span className="shrink-0 font-mono text-[10px] text-nexus-text-muted">{time}</span>
      <span className={cn("text-[11px] leading-snug", highlight ? "text-nexus-text-primary font-medium" : "text-nexus-text-secondary")}>
        {event}
      </span>
    </div>
  );
}
