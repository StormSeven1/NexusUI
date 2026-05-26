"use client";

import { Battery, Camera, Plane } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EoVideoBottomFloaterProps {
  variant: "camera" | "uav";
  streamLabel: string;
  /** 无人机电量 0–100；无遥测时为 null */
  batteryPercent?: number | null;
  /** 右侧任务态文案，默认「空闲中」 */
  taskLine?: string;
  /** 状态栏中间提示（无人机键控反馈） */
  centerLine?: string;
  centerTone?: "success" | "error" | "warn";
  className?: string;
}

function batteryToneClass(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "text-nexus-text-muted";
  if (pct <= 20) return "text-red-400";
  if (pct <= 40) return "text-amber-400";
  return "text-emerald-300/90";
}

/**
 * 相机 / 无人机 共用的底部状态条：图标 | 名称 | 当前任务。
 * 横向由父级 px-2 约束；纵向父级 pb-0 时贴容器底。
 */
export function EoVideoBottomFloater({
  variant,
  streamLabel,
  batteryPercent = null,
  taskLine = "空闲中",
  centerLine,
  centerTone = "success",
  className,
}: EoVideoBottomFloaterProps) {
  const Icon = variant === "uav" ? Plane : Camera;
  const iconBg =
    variant === "uav" ? "bg-emerald-700/90 text-white" : "bg-sky-700/90 text-white";
  const batteryColor = batteryToneClass(batteryPercent);
  const batteryLabel =
    batteryPercent == null || !Number.isFinite(batteryPercent)
      ? "—"
      : `${Math.round(batteryPercent)}%`;

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
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 truncate text-[11px] font-medium text-nexus-text-primary drop-shadow-sm">
            {streamLabel}
          </span>
          {variant === "uav" ? (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium tabular-nums drop-shadow-sm",
                batteryColor,
              )}
              title="无人机电量"
              aria-label={`电量 ${batteryLabel}`}
            >
              <Battery className="size-3 shrink-0" aria-hidden />
              {batteryLabel}
            </span>
          ) : null}
        </div>
        <span className="max-w-[45%] shrink-0 truncate text-right text-[10px] text-nexus-text-primary drop-shadow-sm">
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
