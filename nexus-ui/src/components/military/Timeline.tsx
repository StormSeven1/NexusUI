"use client";

import { useState } from "react";
import { SkipBack, Play, Pause, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";

interface TimelineProps {
  startTime?: string;
  endTime?: string;
  currentTime?: string;
  className?: string;
}

export function Timeline({
  startTime = "13:52:19",
  endTime = "14:02:41",
  currentTime = "13:58:30",
  className,
}: TimelineProps) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(65);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-1">
        <button className="flex h-6 w-6 items-center justify-center rounded text-nexus-text-secondary hover:bg-white/5 hover:text-nexus-text-primary">
          <SkipBack size={12} />
        </button>
        <button
          className="flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.15] bg-white/[0.06] text-nexus-text-primary hover:bg-white/[0.10]"
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
        </button>
        <button className="flex h-6 w-6 items-center justify-center rounded text-nexus-text-secondary hover:bg-white/5 hover:text-nexus-text-primary">
          <SkipForward size={12} />
        </button>
      </div>

      <div className="space-y-1">
        <div
          className="group relative h-1.5 cursor-pointer rounded-full bg-white/[0.08]"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setProgress(((e.clientX - rect.left) / rect.width) * 100);
          }}
        >
          <div
            className="h-full rounded-full bg-white/30 transition-all"
            style={{ width: `${progress}%` }}
          />
          <div
            className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white/40 bg-nexus-bg-surface opacity-0 shadow-[0_0_6px_rgba(255,255,255,0.15)] transition-opacity group-hover:opacity-100"
            style={{ left: `${progress}%`, marginLeft: -6 }}
          />
        </div>
        <div className="flex justify-between font-mono text-[10px] text-nexus-text-muted">
          <span>{startTime}</span>
          <span className="text-nexus-text-secondary">{currentTime}</span>
          <span>{endTime}</span>
        </div>
      </div>
    </div>
  );
}
