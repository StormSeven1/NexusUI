"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { isEoVideoDebugUiEnabled } from "@/lib/eo-video/eoVideoDebugUi";
import type { EoWebCodecsPresentation } from "@/lib/eo-video/eoVideoWebCodecsCanvas";
import { isEoVideoWebCodecsCanvasEnabled } from "@/lib/eo-video/eoVideoWebCodecsCanvas";
import type { EoEncodedSyncHub } from "@/lib/eo-video/eoWebrtcEncodedSync";
import type { EoVideoIceServer } from "@/lib/eo-video/types";
import { useWebCodecsCanvas } from "@/hooks/useWebCodecsCanvas";
import { useWebRtcPlayer } from "@/hooks/useWebRtcPlayer";

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
  /**
   * WebCodecs Canvas 模式：每次解码输出尺寸或 canvas 变化时更新，供叠层 letterbox / 截图。
   * `active` 为 false 时表示当前未使用或未就绪。
   */
  webCodecsPresentationRef?: React.MutableRefObject<EoWebCodecsPresentation>;
}

/**
 * 默认：画面由硬件 `<video>` 解码。
 *
 * `NEXT_PUBLIC_EO_VIDEO_WEBCODECS_CANVAS=true` 且传入 `encodedSyncHub` 时：增加 WebCodecs + Canvas 主显示，
 * `<video>` 仅用 `opacity-0` 隐藏（保留解码与尺寸），避免过去 `visibility:invisible` + Canvas 叠层导致整区黑屏的情况。
 * 检测同步仍走 Insertable Streams → encodedSyncHub。
 */
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
  webCodecsPresentationRef,
}: EoVideoViewportProps) {
  const useCanvas =
    isEoVideoWebCodecsCanvasEnabled() && Boolean(encodedSyncHub && signalingUrl && enabled);

  if (useCanvas) {
    return (
      <EoVideoViewportWebCodecs
        signalingUrl={signalingUrl}
        iceServers={iceServers}
        enabled={enabled}
        videoRef={videoRef}
        peerConnectionRef={peerConnectionRef}
        encodedSyncHub={encodedSyncHub}
        videoReceiverRef={videoReceiverRef}
        containerClassName={containerClassName}
        streamLabel={streamLabel}
        videoObjectFit={videoObjectFit}
        webCodecsPresentationRef={webCodecsPresentationRef}
      />
    );
  }

  return (
    <EoVideoViewportHardware
      signalingUrl={signalingUrl}
      iceServers={iceServers}
      enabled={enabled}
      videoRef={videoRef}
      peerConnectionRef={peerConnectionRef}
      encodedSyncHub={encodedSyncHub}
      videoReceiverRef={videoReceiverRef}
      containerClassName={containerClassName}
      streamLabel={streamLabel}
      videoObjectFit={videoObjectFit}
      webCodecsPresentationRef={webCodecsPresentationRef}
    />
  );
}

function applyPresentationRef(
  ref: React.MutableRefObject<EoWebCodecsPresentation> | undefined,
  p: EoWebCodecsPresentation,
) {
  if (!ref) return;
  ref.current = p;
}

/** 纯硬件解码（原行为） */
function EoVideoViewportHardware({
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
  webCodecsPresentationRef,
}: EoVideoViewportProps) {
  const showDebugOverlay = isEoVideoDebugUiEnabled();
  useEffect(() => {
    applyPresentationRef(webCodecsPresentationRef, {
      active: false,
      width: 0,
      height: 0,
      canvas: null,
    });
    return () => {
      applyPresentationRef(webCodecsPresentationRef, {
        active: false,
        width: 0,
        height: 0,
        canvas: null,
      });
    };
  }, [webCodecsPresentationRef]);

  const { connectionState, iceConnectionState, error } = useWebRtcPlayer({
    signalingUrl,
    iceServers,
    videoRef,
    enabled,
    peerConnectionRef,
    encodedSyncHub,
    videoReceiverRef,
  });

  return (
    <>
      <video
        ref={videoRef}
        className={cn(
          "pointer-events-none absolute inset-0 z-0 h-full w-full",
          videoObjectFit === "contain" ? "object-contain" : "object-cover",
          containerClassName,
        )}
        playsInline
        muted
        autoPlay
        disablePictureInPicture
        controlsList="nopictureinpicture"
        disableRemotePlayback
      />

      {showDebugOverlay ? (
        <div className="pointer-events-none absolute left-2 top-2 z-20 flex max-w-[min(90%,280px)] flex-col gap-0.5 rounded border border-white/10 bg-black/70 px-2 py-1 font-mono text-[9px] text-nexus-text-secondary">
          {streamLabel ? <span className="text-nexus-text-primary">{streamLabel}</span> : null}
          <span>
            PC {connectionState} · ICE {iceConnectionState}
            {encodedSyncHub ? " · syncHub" : ""}
          </span>
          {error ? <span className="text-nexus-error">ERR {error}</span> : null}
        </div>
      ) : null}
    </>
  );
}

/** WebCodecs Canvas 主画面 + 隐藏 video */
function EoVideoViewportWebCodecs({
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
  webCodecsPresentationRef,
}: EoVideoViewportProps) {
  const showDebugOverlay = isEoVideoDebugUiEnabled();
  const { addEncodedFrame, canvasRef, webCodecsActive, videoWidth, videoHeight } = useWebCodecsCanvas();

  const { connectionState, iceConnectionState, error } = useWebRtcPlayer({
    signalingUrl,
    iceServers,
    videoRef,
    enabled,
    peerConnectionRef,
    encodedSyncHub,
    videoReceiverRef,
    onEncodedFrame: addEncodedFrame,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const presenting = webCodecsActive && videoWidth > 0 && videoHeight > 0;
    applyPresentationRef(webCodecsPresentationRef, {
      active: presenting,
      width: videoWidth,
      height: videoHeight,
      canvas: presenting ? canvas : null,
    });
    return () => {
      applyPresentationRef(webCodecsPresentationRef, {
        active: false,
        width: 0,
        height: 0,
        canvas: null,
      });
    };
  }, [webCodecsActive, videoWidth, videoHeight, canvasRef, webCodecsPresentationRef]);

  const canvasPresenting = webCodecsActive && videoWidth > 0 && videoHeight > 0;

  return (
    <>
      <video
        ref={videoRef}
        className={cn(
          "pointer-events-none absolute inset-0 z-0 h-full w-full",
          canvasPresenting ? "opacity-0" : "opacity-100",
          videoObjectFit === "contain" ? "object-contain" : "object-cover",
          containerClassName,
        )}
        playsInline
        muted
        autoPlay
        disablePictureInPicture
        controlsList="nopictureinpicture"
        disableRemotePlayback
        aria-hidden
      />
      <canvas
        ref={canvasRef}
        className={cn(
          "pointer-events-none absolute inset-0 z-[4] h-full w-full",
          !canvasPresenting && "opacity-0",
          videoObjectFit === "contain" ? "object-contain" : "object-cover",
          containerClassName,
        )}
        aria-hidden
      />

      {showDebugOverlay ? (
        <div className="pointer-events-none absolute left-2 top-2 z-20 flex max-w-[min(90%,280px)] flex-col gap-0.5 rounded border border-white/10 bg-black/70 px-2 py-1 font-mono text-[9px] text-nexus-text-secondary">
          {streamLabel ? <span className="text-nexus-text-primary">{streamLabel}</span> : null}
          <span>
            PC {connectionState} · ICE {iceConnectionState}
            {encodedSyncHub ? " · syncHub" : ""}
            {webCodecsActive ? " · WebCodecsCanvas" : " · WebCodecs…"}
          </span>
          {error ? <span className="text-nexus-error">ERR {error}</span> : null}
        </div>
      ) : null}
    </>
  );
}
