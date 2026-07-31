"use client";

import { useAppStore } from "@/stores/app-store";
import { useMapPointerStore } from "@/stores/map-pointer-store";
import { useTrackStore } from "@/stores/track-store";
import { MapScaleBar } from "@/components/map/MapScaleBar";
import { Wifi, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatusBar() {
  const zoomLevel = useAppStore((s) => s.zoomLevel);
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
      </div>

      {/* 坐标 + 比例尺 */}
      <div className="flex items-center gap-3 font-mono text-[10px] text-nexus-text-secondary">
        <div className="flex items-center gap-1">
          <MapPin size={10} />
          <span>
            {mouseCoords
              ? `${mouseCoords.lat.toFixed(4)}°N  ${Math.abs(mouseCoords.lng).toFixed(4)}°${mouseCoords.lng >= 0 ? "E" : "W"}`
              : "—"}
          </span>
        </div>
        <div className="h-3 w-px bg-nexus-border" />
        <MapScaleBar />
        <span>Z{zoomLevel}</span>
      </div>
    </footer>
  );
}
