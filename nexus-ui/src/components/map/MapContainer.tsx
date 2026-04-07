"use client";

import dynamic from "next/dynamic";
import { useAppStore } from "@/stores/app-store";
import { Map as MapIcon, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { MiniMap } from "./MiniMap";

const Map2D = dynamic(() => import("./Map2D").then((m) => m.Map2D), {
  ssr: false,
  loading: () => <MapPlaceholder />,
});

const Map3D = dynamic(() => import("./Map3D").then((m) => m.Map3D), {
  ssr: false,
  loading: () => <MapPlaceholder />,
});

function MapPlaceholder() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-nexus-bg-base">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-white/40" />
        <span className="text-xs text-nexus-text-muted">加载地图中...</span>
      </div>
    </div>
  );
}

export function MapContainer() {
  const { mapViewMode, setMapViewMode } = useAppStore();

  return (
    <div className="relative h-full w-full">
      <div className="h-full w-full">
        {mapViewMode === "2d" ? <Map2D /> : <Map3D />}
      </div>

      {/* 2D/3D 切换 */}
      <div className="absolute right-3 top-3 z-10 flex overflow-hidden rounded-md border border-white/[0.08] bg-nexus-bg-surface/90 backdrop-blur-md">
        <button
          onClick={() => setMapViewMode("2d")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
            mapViewMode === "2d"
              ? "bg-white/[0.08] text-nexus-text-primary"
              : "text-nexus-text-muted hover:bg-white/[0.04] hover:text-nexus-text-secondary"
          )}
        >
          <MapIcon size={13} />
          2D
        </button>
        <div className="w-px bg-white/[0.06]" />
        <button
          onClick={() => setMapViewMode("3d")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
            mapViewMode === "3d"
              ? "bg-white/[0.08] text-nexus-text-primary"
              : "text-nexus-text-muted hover:bg-white/[0.04] hover:text-nexus-text-secondary"
          )}
        >
          <Globe size={13} />
          3D
        </button>
      </div>

      <MiniMap />

      {/* 比例尺 */}
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2">
        <div className="flex items-center gap-1 rounded bg-nexus-bg-surface/80 px-2 py-1 backdrop-blur-sm">
          <div className="h-px w-12 bg-nexus-text-muted" />
          <span className="font-mono text-[9px] text-nexus-text-muted">10 km</span>
        </div>
      </div>

      {/* 中心十字 */}
      <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
        <div className="relative h-6 w-6 opacity-15">
          <div className="absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 bg-white" />
          <div className="absolute bottom-0 left-1/2 h-2 w-px -translate-x-1/2 bg-white" />
          <div className="absolute left-0 top-1/2 h-px w-2 -translate-y-1/2 bg-white" />
          <div className="absolute right-0 top-1/2 h-px w-2 -translate-y-1/2 bg-white" />
        </div>
      </div>

      {/* 边缘暗角 */}
      <div className="pointer-events-none absolute inset-0 z-[4] shadow-[inset_0_0_80px_rgba(0,0,0,0.5)]" />
    </div>
  );
}
