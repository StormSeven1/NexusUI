"use client";

/**
 * Dock 光电容器：无外框留白，整块区域即为 `EoVideoPanel`（与旧版「对话框」分离）。
 */
import { cn } from "@/lib/utils";
import { EoVideoPanel } from "./EoVideoPanel";

export interface EoVideoDockPanelProps {
  className?: string;
  panelId?: string;
}

export function EoVideoDockPanel({ className, panelId = "electro-optical" }: EoVideoDockPanelProps) {
  return (
    <div className={cn("h-full min-h-0 w-full overflow-hidden bg-black", className)}>
      <EoVideoPanel
        className="h-full min-h-0 rounded-none border-0 shadow-none"
        entityId="camera_004"
        streamPersistKey={panelId}
      />
    </div>
  );
}
