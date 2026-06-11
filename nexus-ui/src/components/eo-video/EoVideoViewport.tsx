"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { isEoVideoDebugUiEnabled } from "@/lib/eo-video/eoVideoDebugUi";
import type { EoWebCodecsPresentation } from "@/lib/eo-video/eoVideoWebCodecsCanvas";
import { isEoVideoHardwarePassthroughEnabled } from "@/lib/eo-video/eoVideoHardwarePassthrough";
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
  /** 无人机停帧看门狗：每 N ms 查 framesDecoded（通常 6000） */
  stallWatchIntervalMs?: number;
  /** 停帧恢复前回调（如 poke 推流） */
  onStallRecover?: () => void;
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
 * `<video>` 仅用 `opacity-0` 隐藏（默认仍硬件解码）；`HARDWARE_PASSTHROUGH=false` 时不绑流、不解码，仅 WebCodecs Canvas 出画。
 * WebCodecs 硬解 → 软解均失败，或长时间无画面时，自动回退 `<video>` 解码（仍保留 syncHub）。
 * 检测同步仍走 Insertable Streams → encodedSyncHub。
 */

/** WebCodecs 已就绪但迟迟无首帧时回退 `<video>`（无 GPU 软解成功但缺关键帧等） */
const WEBCODECS_NO_FRAME_FALLBACK_MS = 5000;
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
  stallWatchIntervalMs,
  onStallRecover,
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
        stallWatchIntervalMs={stallWatchIntervalMs}
        onStallRecover={onStallRecover}
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
      stallWatchIntervalMs={stallWatchIntervalMs}
      onStallRecover={onStallRecover}
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
  stallWatchIntervalMs,
  onStallRecover,
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
    stallWatchIntervalMs,
    onStallRecover,
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
  stallWatchIntervalMs,
  onStallRecover,
}: EoVideoViewportProps) {
  const showDebugOverlay = isEoVideoDebugUiEnabled();
  const {
    addEncodedFrame,
    canvasRef,
    webCodecsActive,
    videoWidth,
    videoHeight,
    decodePath,
    hasRenderedFrame,
  } = useWebCodecsCanvas();
  const [videoFallback, setVideoFallback] = useState(false);
  const fallbackRestartedRef = useRef(false);

  const { connectionState, iceConnectionState, error, restart } = useWebRtcPlayer({
    signalingUrl,
    iceServers,
    videoRef,
    enabled,
    peerConnectionRef,
    encodedSyncHub,
    videoReceiverRef,
    onEncodedFrame: addEncodedFrame,
    forceVideoPassthrough: videoFallback,
    stallWatchIntervalMs,
    onStallRecover,
  });

  /** 硬解 + 软解均无法初始化 → 立即回退 `<video>` */
  useEffect(() => {
    if (decodePath === "failed") {
      setVideoFallback(true);
    }
  }, [decodePath]);

  /** 解码器已就绪但超时仍无首帧 → 回退 `<video>` */
  useEffect(() => {
    if (videoFallback || decodePath === "pending" || decodePath === "failed") return;
    if (hasRenderedFrame) return;
    const tid = window.setTimeout(() => {
      if (!hasRenderedFrame) {
        console.warn("[WebCodecs] no frame rendered, falling back to <video>");
        setVideoFallback(true);
      }
    }, WEBCODECS_NO_FRAME_FALLBACK_MS);
    return () => window.clearTimeout(tid);
  }, [videoFallback, decodePath, hasRenderedFrame]);

  /** 回退后重连 WebRTC，使 Insertable Streams 走 passthrough + video 接流 */
  useEffect(() => {
    if (!videoFallback) {
      fallbackRestartedRef.current = false;
      return;
    }
    if (fallbackRestartedRef.current) return;
    fallbackRestartedRef.current = true;
    console.info("[WebCodecs] video fallback active, restarting WebRTC with passthrough");
    restart();
  }, [videoFallback, restart]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const canvasPresenting =
      !videoFallback && webCodecsActive && videoWidth > 0 && videoHeight > 0;
    applyPresentationRef(webCodecsPresentationRef, {
      active: canvasPresenting,
      width: videoWidth,
      height: videoHeight,
      canvas: canvasPresenting ? canvas : null,
    });
    return () => {
      applyPresentationRef(webCodecsPresentationRef, {
        active: false,
        width: 0,
        height: 0,
        canvas: null,
      });
    };
  }, [videoFallback, webCodecsActive, videoWidth, videoHeight, canvasRef, webCodecsPresentationRef]);

  const canvasPresenting =
    !videoFallback && webCodecsActive && videoWidth > 0 && videoHeight > 0;

  const decodePathLabel =
    decodePath === "hardware"
      ? "hw"
      : decodePath === "software"
        ? "sw"
        : decodePath === "failed"
          ? "fail"
          : "…";

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
        aria-hidden={canvasPresenting}
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
            {videoFallback
              ? " · videoFallback"
              : webCodecsActive
                ? " · WebCodecsCanvas"
                : " · WebCodecs…"}
            {!videoFallback && !isEoVideoHardwarePassthroughEnabled() ? " · noVideoPassthrough" : ""}
            {!videoFallback ? ` · ${decodePathLabel}` : ""}
          </span>
          {error ? <span className="text-nexus-error">ERR {error}</span> : null}
        </div>
      ) : null}
    </>
  );
}
