"use client";

import { useRef } from "react";
import { useEoThirdPartyCameraWebSocket } from "@/hooks/useEoThirdPartyCameraWebSocket";
import { EoHighSpeedYuvStack, type EoHighSpeedYuvStackHandle } from "./EoHighSpeedYuvStack";

function EoThirdPartySubCamPipTile({ entityId }: { entityId: string }) {
  const stackRef = useRef<EoHighSpeedYuvStackHandle | null>(null);
  const live = useEoThirdPartyCameraWebSocket(true, entityId, stackRef);
  return (
    <div className="aspect-[3/2] w-[min(28vw,240px)] shrink-0 overflow-hidden rounded-md border border-white/20 bg-black shadow-lg ring-1 ring-black/40">
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

/** 放大态：广角母机旁路里列出的子相机，优先布局为左上与右下双窗 */
export function EoThirdPartySubCamPipStack({ entityIds }: { entityIds: string[] }) {
  if (!entityIds.length) return null;
  const fallbackStepPx = 150;
  return (
    <div className="pointer-events-none absolute inset-0 z-[22]">
      {entityIds.map((id, idx) => {
        if (idx === 0) {
          return (
            <div key={id} className="absolute left-3 top-3">
              <EoThirdPartySubCamPipTile entityId={id} />
            </div>
          );
        }
        if (idx === 1) {
          return (
            <div key={id} className="absolute bottom-3 right-3">
              <EoThirdPartySubCamPipTile entityId={id} />
            </div>
          );
        }
        return (
          <div
            key={id}
            className="absolute right-3"
            style={{ bottom: `${12 + (idx - 1) * fallbackStepPx}px` }}
          >
            <EoThirdPartySubCamPipTile entityId={id} />
          </div>
        );
      })}
    </div>
  );
}
