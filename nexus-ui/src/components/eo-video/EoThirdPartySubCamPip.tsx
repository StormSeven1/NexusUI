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
        "aspect-[3/2] shrink-0 overflow-hidden rounded-md border border-white/20 bg-black shadow-lg ring-1 ring-black/40",
        compact ? "w-[min(20vw,132px)]" : "w-[min(28vw,240px)]",
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
}

/** 广角母机旁路子相机画中画：默认 dock 左上/右上，放大态左上/右下 */
export function EoThirdPartySubCamPipStack({
  entityIds,
  expandedMode = false,
}: EoThirdPartySubCamPipStackProps) {
  if (!entityIds.length) return null;
  const compact = !expandedMode;
  const fallbackStepPx = compact ? 110 : 150;

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
                compact ? "right-2 top-2" : "bottom-3 right-3",
              )}
            >
              <EoThirdPartySubCamPipTile entityId={id} compact={compact} />
            </div>
          );
        }
        return (
          <div
            key={id}
            className={cn("absolute", compact ? "right-2" : "right-3")}
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
