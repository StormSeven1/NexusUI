"use client";

import { cn } from "@/lib/utils";
import type { EoEncodedSyncHub } from "@/lib/eo-video/eoWebrtcEncodedSync";
import type { EoVideoIceServer } from "@/lib/eo-video/types";
import { useWebRtcPlayer } from "@/hooks/useWebRtcPlayer";
import type { WebCodecsCanvasHandle } from "@/hooks/useWebCodecsCanvas";

export interface EoVideoViewportProps {
  signalingUrl: string;
  iceServers: EoVideoIceServer[];
  enabled: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  peerConnectionRef?: React.MutableRefObject<RTCPeerConnection | null>;
  encodedSyncHub?: EoEncodedSyncHub;
  videoReceiverRef?: React.MutableRefObject<RTCRtpReceiver | null>;
  containerClassName?: string;
  streamLabel?: string;
  videoObjectFit?: "contain" | "cover";
  /** WebCodecs Canvas handle — 当提供时，视频渲染到 Canvas 上（精确同步模式） */
  webCodecsHandle?: WebCodecsCanvasHandle;
}

export function EoVideoViewport({
  signalingUrl,
  iceServers,
  enabled,
  videoRef,
  peerConnectionRef,
  encodedSyncHub,
  videoReceiverRef,
  containerClassName,
  streamLabel,
  videoObjectFit = "cover",
  webCodecsHandle,
}: EoVideoViewportProps) {
  const { connectionState, iceConnectionState, error } = useWebRtcPlayer({
    signalingUrl,
    iceServers,
    videoRef,
    enabled,
    peerConnectionRef,
    encodedSyncHub,
    videoReceiverRef,
    onEncodedFrame: webCodecsHandle?.addEncodedFrame,
  });

  const useCanvas = webCodecsHandle?.webCodecsActive;

  return (
    <>
      {/* video 作为回退（WebCodecs 不可用时显示）或隐藏的媒体接收器 */}
      <video
        ref={videoRef}
        className={cn(
          "absolute inset-0 h-full w-full",
          videoObjectFit === "contain" ? "object-contain" : "object-cover",
          useCanvas ? "invisible" : "",
          containerClassName,
          /* Chromium 悬浮在原生 <video> 上会显示画中画、「翻译音频」等系统浮层；
             不参与指针命中可避免触发该 UA 控件层（交互由上层画布/叠加层接管）。 */
          "pointer-events-none",
        )}
        playsInline
        muted
        autoPlay
        disablePictureInPicture
        controlsList="nopictureinpicture"
        disableRemotePlayback
      />

      {/* WebCodecs Canvas：视频 + 检测框同画布渲染（z-1 确保在 video 上方、在 overlay 下方） */}
      {webCodecsHandle ? (
        <canvas
          ref={webCodecsHandle.canvasRef}
          className={cn(
            "absolute inset-0 z-[1] h-full w-full",
            videoObjectFit === "contain" ? "object-contain" : "object-cover",
            containerClassName,
          )}
        />
      ) : null}

      <div className="pointer-events-none absolute left-2 top-2 z-20 flex max-w-[min(90%,280px)] flex-col gap-0.5 rounded border border-white/10 bg-black/70 px-2 py-1 font-mono text-[9px] text-nexus-text-secondary">
        {streamLabel ? <span className="text-nexus-text-primary">{streamLabel}</span> : null}
        <span>
          PC {connectionState} · ICE {iceConnectionState}
          {useCanvas ? " · WebCodecs" : ""}
        </span>
        {error ? <span className="text-nexus-error">ERR {error}</span> : null}
      </div>
    </>
  );
}
