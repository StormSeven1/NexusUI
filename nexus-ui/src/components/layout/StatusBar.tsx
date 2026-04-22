"use client";

import { useAppStore } from "@/stores/app-store";
import { useMapPointerStore } from "@/stores/map-pointer-store";
import { useTrackStore } from "@/stores/track-store";
import {
  Wifi,
  MapPin,
  Monitor,
  Layers,
  Maximize2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function StatusBar() {
  const { zoomLevel, mapViewMode, setMapViewMode } = useAppStore();
  const mouseCoords = useMapPointerStore((s) => s.mouseCoords);
  const wsConnected = useTrackStore((s) => s.connected);

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between border-t border-nexus-border bg-nexus-bg-elevated px-3">
      {/* 连接状态 */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className={cn(
            "h-1.5 w-1.5 rounded-full",
            wsConnected ? "nexus-status-active" : "bg-nexus-danger",
          )} />
          <span className={cn(
            "text-[10px] font-medium",
            wsConnected ? "text-nexus-success" : "text-nexus-danger",
          )}>
            {wsConnected ? "已连接" : "未连接"}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-nexus-text-secondary">
          <Wifi size={10} />
          <span>{wsConnected ? "WebSocket" : "—"}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-nexus-text-secondary">
          <Monitor size={10} />
          <span>帧率 60</span>
        </div>
      </div>

      {/* 快捷操作 */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setMapViewMode("2d")}
          className={cn(
            "rounded px-2 py-0.5 text-[10px] font-semibold transition-all duration-200",
            mapViewMode === "2d"
              ? "bg-nexus-accent-glow text-nexus-text-primary border border-nexus-border-accent"
              : "text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-secondary"
          )}
        >
          2D
        </button>
        <button
          onClick={() => setMapViewMode("3d")}
          className={cn(
            "rounded px-2 py-0.5 text-[10px] font-semibold transition-all duration-200",
            mapViewMode === "3d"
              ? "bg-nexus-accent-glow text-nexus-text-primary border border-nexus-border-accent"
              : "text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-secondary"
          )}
        >
          3D
        </button>
        <div className="mx-2 h-3 w-px bg-nexus-border" />
        <button className="flex items-center gap-1 text-[10px] text-nexus-text-secondary hover:text-nexus-text-primary transition-colors">
          <Layers size={10} />
          <span>8 图层</span>
        </button>
        <button className="ml-1 flex items-center justify-center rounded p-0.5 text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-secondary transition-colors">
          <Maximize2 size={10} />
        </button>
      </div>

      {/* 坐标 */}
      <div className="flex items-center gap-3 font-mono text-[10px] text-nexus-text-secondary">
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
