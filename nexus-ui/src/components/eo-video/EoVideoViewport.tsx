"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { isEoVideoDebugUiEnabled } from "@/lib/eo-video/eoVideoDebugUi";
import type { EoWebCodecsPresentation } from "@/lib/eo-video/eoVideoWebCodecsCanvas";
import { isEoVideoHardwarePassthroughEnabled } from "@/lib/eo-video/eoVideoHardwarePassthrough";
import { isEoVideoWebCodecsCanvasEnabled } from "@/lib/eo-video/eoVideoWebCodecsCanvas";
import type { EoEncodedSyncHub } from "@/lib/eo-video/eoWebrtcEncodedSync";
import type { EoVideoIceServer } from "@/lib/eo-video/types";
import type { EoVideoObjectFit } from "@/lib/eo-video/eoVideoObjectFit";
import { eoVideoObjectFitToTailwindClass } from "@/lib/eo-video/eoVideoObjectFit";
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
  videoObjectFit?: EoVideoObjectFit;
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
/** Canvas 曾出画但 RTP 长时间不更新（等 IDR / 解码卡死）时回退 `<video>` */
const WEBCODECS_CANVAS_STALL_FALLBACK_MS = 2500;
const WEBCODECS_CANVAS_STALL_CHECK_MS = 400;
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
  videoObjectFit = "fill",
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
  videoObjectFit = "fill",
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
      lastRenderedRtpTimestamp: 0,
      videoFallbackActive: false,
      presentationEpoch: 0,
    });
    return () => {
      applyPresentationRef(webCodecsPresentationRef, {
        active: false,
        width: 0,
        height: 0,
        canvas: null,
        lastRenderedRtpTimestamp: 0,
        videoFallbackActive: false,
        presentationEpoch: 0,
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
          eoVideoObjectFitToTailwindClass(videoObjectFit),
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
  videoObjectFit = "fill",
  webCodecsPresentationRef,
  stallWatchIntervalMs,
  onStallRecover,
}: EoVideoViewportProps) {
  const showDebugOverlay = isEoVideoDebugUiEnabled();
  const {
    addEncodedFrame,
    resetForNewStream,
    canvasRef,
    webCodecsActive,
    videoWidth,
    videoHeight,
    decodePath,
    hasRenderedFrame,
    lastRenderedRtpTimestampRef,
  } = useWebCodecsCanvas();
  const [videoFallback, setVideoFallback] = useState(false);
  const fallbackRestartedRef = useRef(false);
  const presentationEpochRef = useRef(0);
  const canvasWasPresentingRef = useRef(false);
  const lastCanvasRtpRef = useRef(0);
  const lastCanvasRtpChangeAtRef = useRef(0);

  const bumpPresentationEpoch = (reason: string) => {
    presentationEpochRef.current += 1;
    if (isEoVideoDebugUiEnabled()) {
      console.info(`[WebCodecs] presentationEpoch=${presentationEpochRef.current} (${reason})`);
    }
  };

  /** 舱内/舱外或任意信令切换：清 Canvas 残留帧，避免长时间仍显示机场画面 */
  useEffect(() => {
    resetForNewStream();
    setVideoFallback(false);
    fallbackRestartedRef.current = false;
    presentationEpochRef.current = 0;
    canvasWasPresentingRef.current = false;
    lastCanvasRtpRef.current = 0;
    lastCanvasRtpChangeAtRef.current = 0;
    applyPresentationRef(webCodecsPresentationRef, {
      active: false,
      width: 0,
      height: 0,
      canvas: null,
      lastRenderedRtpTimestamp: 0,
      videoFallbackActive: false,
      presentationEpoch: 0,
    });
  }, [signalingUrl, resetForNewStream, webCodecsPresentationRef]);

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
    bumpPresentationEpoch("videoFallback");
    if (fallbackRestartedRef.current) return;
    fallbackRestartedRef.current = true;
    console.info("[WebCodecs] video fallback active, restarting WebRTC with passthrough");
    restart();
  }, [videoFallback, restart]);

  /** 曾出画但 Canvas RTP 停更超过阈值 → 回退 `<video>`（PASSTHROUGH=false 时防长期黑屏） */
  useEffect(() => {
    if (videoFallback || !hasRenderedFrame || decodePath === "pending" || decodePath === "failed") {
      return;
    }
    lastCanvasRtpRef.current = lastRenderedRtpTimestampRef.current;
    lastCanvasRtpChangeAtRef.current = Date.now();

    const tid = window.setInterval(() => {
      const ts = lastRenderedRtpTimestampRef.current;
      const now = Date.now();
      if (ts <= 0) return;
      if (ts !== lastCanvasRtpRef.current) {
        lastCanvasRtpRef.current = ts;
        lastCanvasRtpChangeAtRef.current = now;
        return;
      }
      if (now - lastCanvasRtpChangeAtRef.current >= WEBCODECS_CANVAS_STALL_FALLBACK_MS) {
        console.warn(
          `[WebCodecs] canvas stall ${now - lastCanvasRtpChangeAtRef.current}ms, falling back to <video>`,
        );
        setVideoFallback(true);
      }
    }, WEBCODECS_CANVAS_STALL_CHECK_MS);

    return () => window.clearInterval(tid);
  }, [videoFallback, hasRenderedFrame, decodePath, lastRenderedRtpTimestampRef]);

  useEffect(() => {
    let rafId = 0;
    let stopped = false;

    const syncPresentation = () => {
      if (stopped) return;
      const canvas = canvasRef.current;
      const canvasPresenting =
        !videoFallback && hasRenderedFrame && videoWidth > 0 && videoHeight > 0;
      const ts =
        lastRenderedRtpTimestampRef.current > 0 ? lastRenderedRtpTimestampRef.current : 0;

      if (canvasPresenting && ts > 0) {
        if (!canvasWasPresentingRef.current) {
          bumpPresentationEpoch("canvas-resume");
        } else if (ts !== lastCanvasRtpRef.current) {
          const gapMs = Date.now() - lastCanvasRtpChangeAtRef.current;
          if (lastCanvasRtpRef.current > 0 && gapMs >= 600) {
            bumpPresentationEpoch("canvas-rtp-resume");
          }
        }
        if (ts !== lastCanvasRtpRef.current) {
          lastCanvasRtpRef.current = ts;
          lastCanvasRtpChangeAtRef.current = Date.now();
        }
      } else {
        canvasWasPresentingRef.current = false;
      }
      if (canvasPresenting) {
        canvasWasPresentingRef.current = true;
      }

      applyPresentationRef(webCodecsPresentationRef, {
        active: canvasPresenting,
        width: videoWidth,
        height: videoHeight,
        canvas: canvasPresenting ? canvas : null,
        lastRenderedRtpTimestamp: ts,
        videoFallbackActive: videoFallback,
        presentationEpoch: presentationEpochRef.current,
      });
      rafId = window.requestAnimationFrame(syncPresentation);
    };

    syncPresentation();
    return () => {
      stopped = true;
      window.cancelAnimationFrame(rafId);
      applyPresentationRef(webCodecsPresentationRef, {
        active: false,
        width: 0,
        height: 0,
        canvas: null,
        lastRenderedRtpTimestamp: 0,
        videoFallbackActive: false,
        presentationEpoch: presentationEpochRef.current,
      });
    };
  }, [
    videoFallback,
    webCodecsActive,
    hasRenderedFrame,
    videoWidth,
    videoHeight,
    canvasRef,
    webCodecsPresentationRef,
    lastRenderedRtpTimestampRef,
  ]);

  const canvasPresenting =
    !videoFallback && hasRenderedFrame && videoWidth > 0 && videoHeight > 0;

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
          eoVideoObjectFitToTailwindClass(videoObjectFit),
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
          eoVideoObjectFitToTailwindClass(videoObjectFit),
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
