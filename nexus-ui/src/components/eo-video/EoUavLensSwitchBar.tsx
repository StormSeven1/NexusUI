"use client";

import { useCallback, useState } from "react";
import type { UavVideoLensType } from "@/lib/eo-video/postUavSwitchVideoCamera";
import { cn } from "@/lib/utils";

type Props = {
  droneSn: string;
  payloadIndex?: string;
  disabled?: boolean;
  onSwitch: (videoType: UavVideoLensType) => void | Promise<void>;
  /** 当前选中镜头（受控可选） */
  activeLens?: UavVideoLensType;
  className?: string;
};

const LENS_OPTIONS: { id: UavVideoLensType; label: string }[] = [
  { id: "wide", label: "广角" },
  { id: "zoom", label: "变焦" },
  { id: "ir", label: "红外" },
];

/**
 * 对齐 WatchSys `switchboard`（广角 / 变焦 / 红外），放大态叠在画面顶部居中。
 */
export function EoUavLensSwitchBar({ droneSn, disabled, onSwitch, activeLens, className }: Props) {
  const [localLens, setLocalLens] = useState<UavVideoLensType>("wide");
  const [busy, setBusy] = useState<UavVideoLensType | null>(null);
  const selected = activeLens ?? localLens;

  const onPick = useCallback(
    async (lens: UavVideoLensType) => {
      if (disabled || busy || !droneSn.trim()) return;
      setBusy(lens);
      try {
        await onSwitch(lens);
        setLocalLens(lens);
      } finally {
        setBusy(null);
      }
    },
    [busy, disabled, droneSn, onSwitch],
  );

  if (!droneSn.trim()) return null;

  return (
    <div
      className={cn(
        "pointer-events-auto inline-flex overflow-hidden rounded-md border border-white/20 bg-[rgba(22,27,34,0.72)] shadow-[0_2px_8px_rgba(0,0,0,0.45)] backdrop-blur-sm",
        className,
      )}
      role="toolbar"
      aria-label="无人机镜头切换"
    >
      {LENS_OPTIONS.map((opt, idx) => {
        const active = selected === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled || busy != null}
            className={cn(
              "min-w-[3.25rem] px-3 py-1.5 text-xs font-medium transition-colors",
              idx === 0 && "rounded-l-md",
              idx === LENS_OPTIONS.length - 1 && "rounded-r-md",
              active ? "bg-sky-950/55 text-[#6BFAE9]" : "text-white/90 hover:bg-white/10",
              (disabled || busy != null) && "cursor-not-allowed opacity-50",
              busy === opt.id && "animate-pulse",
            )}
            aria-pressed={active}
            onClick={() => void onPick(opt.id)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
