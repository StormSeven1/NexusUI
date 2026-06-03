"use client";

import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DockGuideZone } from "@/lib/dock/dockGuideLayout";

const ZONE_META: {
  zone: DockGuideZone;
  label: string;
  Icon: typeof ChevronUp;
}[] = [
  { zone: "top", label: "上方新建分区", Icon: ChevronUp },
  { zone: "middle", label: "并入当前分区", Icon: Square },
  { zone: "bottom", label: "下方新建分区", Icon: ChevronDown },
];

export interface DockGuideDashboardProps {
  /** 锚定分区在视口中的矩形 */
  anchorRect: { top: number; left: number; width: number; height: number };
  side: "left" | "right";
  activeZone: DockGuideZone | null;
  onZoneChange: (zone: DockGuideZone) => void;
}

/**
 * Visual Studio 风格停靠仪表盘：上 / 中 / 下 三个命中区。
 * 鼠标悬停在哪一格，即预览并停靠到对应区域。
 */
export function DockGuideDashboard({
  anchorRect,
  side,
  activeZone,
  onZoneChange,
}: DockGuideDashboardProps) {
  const dashboardW = 112;
  const dashboardH = 132;
  const centerX = anchorRect.left + anchorRect.width / 2;
  const centerY = anchorRect.top + anchorRect.height / 2;
  const left = Math.min(
    Math.max(8, centerX - dashboardW / 2),
    window.innerWidth - dashboardW - 8,
  );
  const top = Math.min(
    Math.max(anchorRect.top + 8, centerY - dashboardH / 2),
    anchorRect.top + anchorRect.height - dashboardH - 8,
  );

  const node = (
    <div
      className="fixed z-[9999] select-none"
      style={{ left, top, width: dashboardW, height: dashboardH }}
      data-dock-guide-root
      onMouseDown={(e) => e.preventDefault()}
    >
      <div
        className={cn(
          "flex h-full flex-col gap-1 rounded-lg border p-1.5 shadow-2xl backdrop-blur-md",
          "border-cyan-500/40 bg-[#1a1a22]/92",
        )}
        role="toolbar"
        aria-label="停靠位置"
      >
        {ZONE_META.map(({ zone, label, Icon }) => {
          const active = activeZone === zone;
          return (
            <button
              key={zone}
              type="button"
              data-dock-guide-zone={zone}
              title={label}
              aria-label={label}
              aria-pressed={active}
              className={cn(
                "flex flex-1 items-center justify-center rounded-md border transition-colors",
                active
                  ? "border-cyan-400 bg-cyan-500/25 text-cyan-100"
                  : "border-transparent bg-white/5 text-zinc-400 hover:border-cyan-500/35 hover:bg-cyan-500/10 hover:text-cyan-200",
              )}
              onMouseEnter={() => onZoneChange(zone)}
            >
              <Icon
                size={zone === "middle" ? 18 : 20}
                strokeWidth={2}
                className={cn(active && "drop-shadow-[0_0_6px_rgba(34,211,238,0.8)]")}
              />
            </button>
          );
        })}
      </div>
      <p className="pointer-events-none absolute -bottom-5 left-1/2 w-max -translate-x-1/2 text-[10px] text-cyan-300/80">
        {side === "left" ? "左侧" : "右侧"}停靠
      </p>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
}
