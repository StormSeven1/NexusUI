"use client";

import { useRef } from "react";
import { useEoThirdPartyCameraWebSocket } from "@/hooks/useEoThirdPartyCameraWebSocket";
import { cn } from "@/lib/utils";
import { EoHighSpeedYuvStack, type EoHighSpeedYuvStackHandle } from "./EoHighSpeedYuvStack";

function EoThirdPartySubCamPipTile({
  entityId,
  compact,
}: {
  entityId: string;
  compact: boolean;
}) {
  const stackRef = useRef<EoHighSpeedYuvStackHandle | null>(null);
  const live = useEoThirdPartyCameraWebSocket(true, entityId, stackRef);
  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden rounded-md border border-white/20 bg-black shadow-lg ring-1 ring-black/40",
        compact ? "h-[88px] w-[min(18vw,112px)]" : "h-[160px] w-[min(24vw,208px)]",
      )}
    >
      <EoHighSpeedYuvStack
        ref={stackRef}
        className="h-full w-full"
        videoWidth={live.videoWidth}
        videoHeight={live.videoHeight}
        strideY={live.strideY}
        yuv420={null}
        boxes={[]}
        placeholderHint={[entityId, live.hint].filter(Boolean).join(" · ")}
      />
    </div>
  );
}

export interface EoThirdPartySubCamPipStackProps {
  entityIds: string[];
  /** false = dock 默认态（左上 + 右上、较小）；true = 放大态（左上 + 右下、较大） */
  expandedMode?: boolean;
  /** 为右侧悬浮工具栏留白（与 EoVideoPlayStage taskHint 的 right-[4.25rem] 一致） */
  sideToolbarReserved?: boolean;
}

/** 广角母机旁路子相机画中画：默认 dock 左上/右上，放大态左上/右下 */
export function EoThirdPartySubCamPipStack({
  entityIds,
  expandedMode = false,
  sideToolbarReserved = false,
}: EoThirdPartySubCamPipStackProps) {
  if (!entityIds.length) return null;
  const compact = !expandedMode;
  const fallbackStepPx = compact ? 96 : 172;
  const rightEdge = sideToolbarReserved ? "right-[4.25rem]" : compact ? "right-2" : "right-3";

  return (
    <div className="pointer-events-none absolute inset-0 z-[22]">
      {entityIds.map((id, idx) => {
        if (idx === 0) {
          return (
            <div key={id} className={cn("absolute", compact ? "left-2 top-2" : "left-3 top-3")}>
              <EoThirdPartySubCamPipTile entityId={id} compact={compact} />
            </div>
          );
        }
        if (idx === 1) {
          return (
            <div
              key={id}
              className={cn(
                "absolute",
                rightEdge,
                compact ? "top-2" : "bottom-3",
              )}
            >
              <EoThirdPartySubCamPipTile entityId={id} compact={compact} />
            </div>
          );
        }
        return (
          <div
            key={id}
            className={cn("absolute", rightEdge)}
            style={
              compact
                ? { top: `${8 + (idx - 1) * fallbackStepPx}px` }
                : { bottom: `${12 + (idx - 1) * fallbackStepPx}px` }
            }
          >
            <EoThirdPartySubCamPipTile entityId={id} compact={compact} />
          </div>
        );
      })}
    </div>
  );
}
