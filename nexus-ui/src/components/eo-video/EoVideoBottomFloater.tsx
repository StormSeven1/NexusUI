"use client";

import { Camera, Plane } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EoVideoBottomFloaterProps {
  variant: "camera" | "uav";
  streamLabel: string;
  /** 右侧任务态文案，默认「空闲中」 */
  taskLine?: string;
  /** 状态栏中间提示（无人机键控反馈） */
  centerLine?: string;
  centerTone?: "success" | "error" | "warn";
  className?: string;
}

/**
 * 相机 / 无人机 共用的底部状态条：图标 | 名称 | 当前任务。
 * 横向由父级 px-2 约束；纵向父级 pb-0 时贴容器底。
 */
export function EoVideoBottomFloater({
  variant,
  streamLabel,
  taskLine = "空闲中",
  centerLine,
  centerTone = "success",
  className,
}: EoVideoBottomFloaterProps) {
  const Icon = variant === "uav" ? Plane : Camera;
  const iconBg =
    variant === "uav" ? "bg-emerald-700/90 text-white" : "bg-sky-700/90 text-white";

  return (
    <div className={cn("w-full", className)}>
      <div
        className={cn(
          "relative flex w-full items-center gap-2.5 border border-white/[0.08] px-2 py-1.5",
          "bg-black/25",
        )}
      >
        <span
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
            iconBg,
          )}
          aria-hidden
        >
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-nexus-text-primary drop-shadow-sm">
          {streamLabel}
        </span>
        <span className="max-w-[45%] shrink-0 truncate text-right text-[10px] text-nexus-text-muted drop-shadow-sm">
          {taskLine}
        </span>
        <span
          className={cn(
            "pointer-events-none absolute left-1/2 -translate-x-1/2 truncate text-[11px] drop-shadow-sm",
            !centerLine
              ? "text-transparent"
              : centerTone === "success"
                ? "text-emerald-300/95"
                : centerTone === "error"
                  ? "text-red-300/95"
                  : "text-amber-300/95",
          )}
        >
          {centerLine || " "}
        </span>
      </div>
    </div>
  );
}
