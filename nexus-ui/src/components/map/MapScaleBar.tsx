"use client";

import { useMemo } from "react";
import { useMapPointerStore } from "@/stores/map-pointer-store";
import { computeScaleBarDisplay } from "@/lib/map-scale-bar";

/** 状态栏用线段比例尺（米/像素由 Map2D / Map3D 写入 store） */
export function MapScaleBar({ maxBarPx = 64 }: { maxBarPx?: number }) {
  const metersPerPixel = useMapPointerStore((s) => s.metersPerPixel);

  const scale = useMemo(
    () => (metersPerPixel != null ? computeScaleBarDisplay(metersPerPixel, maxBarPx) : null),
    [metersPerPixel, maxBarPx],
  );

  if (!scale) return null;

  return (
    <div className="flex items-center gap-1.5" title="地图比例尺">
      <div
        className="relative h-2 shrink-0"
        style={{ width: Math.round(scale.widthPx) }}
        aria-hidden
      >
        <div className="absolute bottom-0 left-0 right-0 h-px bg-nexus-text-secondary/80" />
        <div className="absolute bottom-0 left-0 h-1.5 w-px bg-nexus-text-secondary/80" />
        <div className="absolute bottom-0 right-0 h-1.5 w-px bg-nexus-text-secondary/80" />
      </div>
      <span className="font-mono text-[10px] tabular-nums text-nexus-text-secondary">
        {scale.label}
      </span>
    </div>
  );
}
