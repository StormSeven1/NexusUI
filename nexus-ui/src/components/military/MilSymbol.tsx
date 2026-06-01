"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { ForceDisposition } from "@/lib/theme-colors";
import { buildMarkerSymbolDataUrl, preloadTrackIconFragments } from "@/lib/map-icons";
import Image from "next/image";

interface MilSymbolProps {
  type: "air" | "sea" | "underwater";
  disposition: ForceDisposition;
  /** 虚兵：与地图航迹符号相同的条纹断续填色 */
  virtual?: boolean;
  /** 友方 tint，与地图 `trackTypeStyles.*.idColor` 一致 */
  friendlyFill?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * 统一的目标符号组件：与地图标绘使用同一 SVG 资产，保证“列表/详情/地图”视觉一致 *
 * Unified marker symbol used across panels and maps (same SVG generator as MapLibre/Cesium).
 */
export function MilSymbol({
  type,
  disposition,
  virtual = false,
  friendlyFill,
  size = "md",
  className,
}: MilSymbolProps) {
  const sizeClasses = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-10 w-10",
  };
  const px = { sm: 24, md: 32, lg: 40 }[size];
  const [src, setSrc] = useState(() =>
    buildMarkerSymbolDataUrl(type, disposition, undefined, virtual, friendlyFill),
  );

  useEffect(() => {
    let cancelled = false;
    void preloadTrackIconFragments().then(() => {
      if (!cancelled) {
        setSrc(buildMarkerSymbolDataUrl(type, disposition, undefined, virtual, friendlyFill));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [type, disposition, virtual, friendlyFill]);

  return (
    <Image
      src={src}
      alt={`${type}-${disposition}`}
      width={px}
      height={px}
      style={{ width: px, height: px }}
      className={cn("select-none", sizeClasses[size], className)}
      draggable={false}
      unoptimized
      priority={size === "lg"}
    />
  );
}
