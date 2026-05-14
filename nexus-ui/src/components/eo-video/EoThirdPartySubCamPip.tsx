"use client";

import { useRef } from "react";
import { useEoThirdPartyCameraWebSocket } from "@/hooks/useEoThirdPartyCameraWebSocket";
import { EoHighSpeedYuvStack, type EoHighSpeedYuvStackHandle } from "./EoHighSpeedYuvStack";

function EoThirdPartySubCamPipTile({ entityId }: { entityId: string }) {
  const stackRef = useRef<EoHighSpeedYuvStackHandle | null>(null);
  const live = useEoThirdPartyCameraWebSocket(true, entityId, stackRef);
  return (
    <div className="h-[min(22vh,200px)] w-[min(42vw,360px)] shrink-0 overflow-hidden rounded-md border border-white/20 bg-black shadow-lg ring-1 ring-black/40">
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

/** 放大态：广角母机旁路里列出的子相机，自上而下各一路 UDP→WS 画中画 */
export function EoThirdPartySubCamPipStack({ entityIds }: { entityIds: string[] }) {
  if (!entityIds.length) return null;
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-[22] flex max-h-[min(72vh,640px)] flex-col gap-2 overflow-y-auto overscroll-contain">
      {entityIds.map((id) => (
        <EoThirdPartySubCamPipTile key={id} entityId={id} />
      ))}
    </div>
  );
}
