"use client";

import { Bot, BotOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEoVideoSmartWindowStore } from "@/stores/eo-video-smart-window-store";

export interface EoVideoSmartWindowToggleProps {
  panelId: string;
}

/** 光电 dock 标题栏：智能窗口开关（机器人图标，默认关闭） */
export function EoVideoSmartWindowToggle({ panelId }: EoVideoSmartWindowToggleProps) {
  const enabled = useEoVideoSmartWindowStore((s) => s.enabledByPanelId[panelId] ?? false);
  const toggle = useEoVideoSmartWindowStore((s) => s.toggle);

  return (
    <button
      type="button"
      className={cn(
        "shrink-0 rounded p-1 transition-colors",
        enabled
          ? "text-sky-400 hover:bg-sky-950/40 hover:text-sky-300"
          : "text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-secondary",
      )}
      title={enabled ? "智能窗口：已开启（按任务自动切流）" : "智能窗口：已关闭"}
      aria-label={enabled ? "关闭智能窗口" : "开启智能窗口"}
      aria-pressed={enabled}
      onClick={(e) => {
        e.stopPropagation();
        toggle(panelId);
      }}
    >
      {enabled ? <Bot size={14} /> : <BotOff size={14} />}
    </button>
  );
}
