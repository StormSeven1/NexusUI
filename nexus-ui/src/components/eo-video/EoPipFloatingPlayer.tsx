"use client";

import { Loader2 } from "lucide-react";
import { useRef } from "react";
import type { EoVideoIceServer, EoVideoStreamsConfig } from "@/lib/eo-video/types";
import { cn } from "@/lib/utils";
import { EoVideoViewport } from "./EoVideoViewport";
import { EoStreamContextMenu } from "./EoStreamContextMenu";

export interface EoPipFloatingPlayerProps {
  /** 由光电主画面容器的 `relative` 内 `absolute` 定位右上角小窗 */
  open: boolean;
  config: EoVideoStreamsConfig | null;
  iceServers: EoVideoIceServer[];
  pipStreamId: string;
  onSelectPipStream: (streamId: string) => void;
  signalingUrl: string;
  loading: boolean;
  error: string | null;
  streamLabel: string;
}

/** 叠在主画面区域内右上：独立 WebRTC；右键与主画面同源菜单切流 */
export function EoPipFloatingPlayer({
  open,
  config,
  iceServers,
  pipStreamId,
  onSelectPipStream,
  signalingUrl,
  loading,
  error,
  streamLabel,
}: EoPipFloatingPlayerProps) {
  const pipVideoRef = useRef<HTMLVideoElement>(null);

  if (!open || !config) return null;

  return (
    <div
      className="pointer-events-none absolute right-2 top-10 z-[40] flex w-[min(32vw,260px)] max-w-[90%] flex-col outline-none"
      aria-label="画中画"
      data-eo-pip="1"
    >
      <EoStreamContextMenu config={config} activeStreamId={pipStreamId} onSelectStream={onSelectPipStream}>
        <div
          role="presentation"
          title="右键切换画中画视频流"
          className={cn(
            "pointer-events-auto relative aspect-video w-full cursor-context-menu overflow-hidden rounded-sm border border-white/25 bg-black/90 shadow-xl",
          )}
          aria-label={`画中画：${streamLabel}`}
        >
          {signalingUrl.trim() ? (
            <EoVideoViewport
              signalingUrl={signalingUrl}
              iceServers={iceServers}
              enabled
              videoRef={pipVideoRef}
              streamLabel={`PiP · ${streamLabel}`}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-[10px] text-nexus-text-muted">
              {loading ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden /> 画中画解析中…
                </span>
              ) : (
                error || "暂无信令地址"
              )}
            </div>
          )}
          {(error ?? "").trim() && signalingUrl.trim() ? (
            <div className="pointer-events-none absolute bottom-1 left-1 max-w-[95%] truncate rounded bg-black/75 px-1 py-0.5 text-[9px] text-red-300">
              {error}
            </div>
          ) : null}
        </div>
      </EoStreamContextMenu>
    </div>
  );
}
