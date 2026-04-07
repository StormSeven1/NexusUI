"use client";

import { useAppStore } from "@/stores/app-store";
import {
  Wifi,
  MapPin,
  Monitor,
  Layers,
  Maximize2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function StatusBar() {
  const { mouseCoords, zoomLevel, mapViewMode, setMapViewMode } = useAppStore();

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between border-t border-white/[0.06] bg-nexus-bg-surface/90 px-3 backdrop-blur-md">
      {/* 连接状态 */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-blink" />
          <span className="text-[10px] font-medium text-emerald-400">已连接</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-nexus-text-muted">
          <Wifi size={10} />
          <span>延迟 12ms</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-nexus-text-muted">
          <Monitor size={10} />
          <span>帧率 60</span>
        </div>
      </div>

      {/* 快捷操作 */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setMapViewMode("2d")}
          className={cn(
            "rounded px-2 py-0.5 text-[10px] font-semibold transition-colors",
            mapViewMode === "2d"
              ? "bg-white/[0.08] text-nexus-text-primary"
              : "text-nexus-text-muted hover:text-nexus-text-secondary"
          )}
        >
          2D
        </button>
        <button
          onClick={() => setMapViewMode("3d")}
          className={cn(
            "rounded px-2 py-0.5 text-[10px] font-semibold transition-colors",
            mapViewMode === "3d"
              ? "bg-white/[0.08] text-nexus-text-primary"
              : "text-nexus-text-muted hover:text-nexus-text-secondary"
          )}
        >
          3D
        </button>
        <div className="mx-2 h-3 w-px bg-white/[0.06]" />
        <button className="flex items-center gap-1 text-[10px] text-nexus-text-muted hover:text-nexus-text-secondary">
          <Layers size={10} />
          <span>8 图层</span>
        </button>
        <button className="ml-1 flex items-center justify-center rounded p-0.5 text-nexus-text-muted hover:bg-white/5 hover:text-nexus-text-secondary">
          <Maximize2 size={10} />
        </button>
      </div>

      {/* 坐标 */}
      <div className="flex items-center gap-3 font-mono text-[10px] text-nexus-text-muted">
        <div className="flex items-center gap-1">
          <MapPin size={10} />
          <span>
            {mouseCoords
              ? `${mouseCoords.lat.toFixed(4)}°N  ${Math.abs(mouseCoords.lng).toFixed(4)}°${mouseCoords.lng >= 0 ? "E" : "W"}`
              : "—"}
          </span>
        </div>
        <span>Z{zoomLevel}</span>
      </div>
    </footer>
  );
}
