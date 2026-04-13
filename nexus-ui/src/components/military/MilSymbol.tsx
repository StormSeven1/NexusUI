"use client";

import { cn } from "@/lib/utils";
import type { ForceDisposition } from "@/lib/colors";
import { buildMarkerSymbolDataUrl } from "@/lib/map-symbols";
import Image from "next/image";

interface MilSymbolProps {
  type: "air" | "sea" | "underwater";
  disposition: ForceDisposition;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * 统一的目标符号组件：与地图标绘使用同一套 SVG 资产，保证“列表/详情/地图”视觉一致。
 *
 * Unified marker symbol used across panels and maps (same SVG generator as MapLibre/Cesium).
 */
export function MilSymbol({ type, disposition, size = "md", className }: MilSymbolProps) {
  const sizeClasses = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-10 w-10",
  };
  const px = { sm: 24, md: 32, lg: 40 }[size];
  const src = buildMarkerSymbolDataUrl(type, disposition);

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
