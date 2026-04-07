"use client";

import { MOCK_TRACKS } from "@/lib/mock-data";
import { ForceTag } from "@/components/military/ForceTag";
import { MilSymbol } from "@/components/military/MilSymbol";
import { Timeline } from "@/components/military/Timeline";
import {
  Star,
  MapPin,
  ExternalLink,
  Crosshair,
  Navigation,
  Gauge,
  Radio,
  Eye,
  MoreHorizontal,
  Video,
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
        <Timeline />
      </div>

      {/* 属性网格 */}
      <div className="border-b border-white/[0.06] p-4">
        <h4 className="mb-3 text-[10px] font-semibold tracking-widest text-nexus-text-muted">
          航迹属性
        </h4>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <DetailRow icon={Gauge} label="速度" value={`${track.speed} ${track.type === "ground" ? "mph" : "kn"}`} />
          <DetailRow icon={Navigation} label="航向" value={`${track.heading}°`} />
          <DetailRow
            icon={MapPin}
            label="位置"
            value={`${track.lat.toFixed(4)}°N`}
            subValue={`${Math.abs(track.lng).toFixed(4)}°${track.lng >= 0 ? "E" : "W"}`}
          />
          {track.altitude && (
            <DetailRow icon={Crosshair} label="高度" value={`${track.altitude} ft`} />
          )}
          <DetailRow icon={Radio} label="传感器" value={track.sensor} />
          <DetailRow icon={Eye} label="最后更新" value={track.lastUpdate} />
        </div>
      </div>

      {/* 传感器画面占位 */}
      <div className="border-b border-white/[0.06] p-4">
        <h4 className="mb-3 text-[10px] font-semibold tracking-widest text-nexus-text-muted">
          传感器画面
        </h4>
        <div className="relative aspect-video overflow-hidden rounded-md border border-white/[0.06] bg-black/40">
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Video size={24} className="text-nexus-text-muted" />
            <span className="text-[10px] text-nexus-text-muted">
              {track.sensor}: EO
            </span>
          </div>
          <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(0,0,0,0.03)_2px,rgba(0,0,0,0.03)_4px)]" />
          {/* 角框标记 */}
          <div className="absolute left-2 top-2 h-4 w-4 border-l-2 border-t-2 border-white/20" />
          <div className="absolute right-2 top-2 h-4 w-4 border-r-2 border-t-2 border-white/20" />
          <div className="absolute bottom-2 left-2 h-4 w-4 border-b-2 border-l-2 border-white/20" />
          <div className="absolute bottom-2 right-2 h-4 w-4 border-b-2 border-r-2 border-white/20" />
          <div className="absolute bottom-3 left-3 font-mono text-[9px] text-white/40">
            <div>自动 · {track.sensor}</div>
            <div>
              {track.lat.toFixed(4)}, {track.lng.toFixed(4)}
            </div>
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="p-4">
        <div className="flex gap-2">
          <button className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-white/[0.10] bg-white/[0.06] text-xs font-medium text-nexus-text-primary hover:bg-white/[0.10]">
            <Crosshair size={12} />
            跟踪
          </button>
          <button className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] text-xs font-medium text-nexus-text-secondary hover:bg-white/[0.06]">
            <ExternalLink size={12} />
            任务
          </button>
          <button className="flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03] text-nexus-text-muted hover:bg-white/[0.06]">
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  subValue,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  subValue?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={12} className="mt-0.5 shrink-0 text-nexus-text-muted" />
      <div>
        <div className="text-[10px] text-nexus-text-muted">{label}</div>
        <div className="font-mono text-xs text-nexus-text-primary">{value}</div>
        {subValue && (
          <div className="font-mono text-[10px] text-nexus-text-secondary">
            {subValue}
          </div>
        )}
      </div>
    </div>
  );
}
