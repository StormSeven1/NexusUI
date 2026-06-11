"use client";

/**
 * EO 视频视口层。
 *
 * 这个组件只负责“把视频画出来”，不负责决定播哪一路视频，也不负责接收检测框。
 * 现在播放层相关逻辑已经直接内联在本文件中，不再拆成只被这里单点使用的两个 hook。
 *
 * 当前职责分层：
 * - `EoVideoModal`：决定当前播哪个实体的视频
 * - `EoVideoViewport`：负责 WebRTC 拉流、可选的 WebCodecs canvas 呈现、连接状态显示
 * - `useEoSyncedDetections`：负责从全局检测框 store 中读取当前相机的检测框并同步
 * - `EoDetectionOverlay`：负责把同步后的框画出来
 *
 * 为什么同时保留 video + canvas：
 * - `video` 是最稳的原生播放回退路径
 * - `canvas` 路径可以把“接收到的 encoded frame”与检测框同步头绑定起来，
 *   从而把检测框对齐到真正展示的那一帧附近
 *
 * 调用关系：
 * - `EoVideoModal` 把 `signalingUrl / encodedSyncHub / videoRef` 传进来
 * - 本组件内部直接完成 WebRTC 协商与播放
 * - 如果启用了 WebCodecs，本组件内部也直接完成编码帧解码到 `<canvas>`
 * - 最终外层 `EoDetectionOverlay` 再覆盖在这个视口上面
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { isEoVideoWebCodecsCanvasEnabled, type EoWebCodecsPresentation } from "@/lib/eo-video/eoVideoWebCodecsCanvas";
import { attachEncodedVideoFrameSync, type EncodedFrameData, type EoEncodedSyncHub } from "@/lib/eo-video/eoWebrtcEncodedSync";
import type { EoVideoIceServer } from "@/lib/eo-video/types";

const SIGNALING_TIMEOUT_MS = 5000;
const FRAME_BUFFER_SIZE = 16;
const CODECS = ["avc1.640028", "avc1.42001e", "avc1.42e01e", "avc1.42001f"];

async function negotiate(pc: RTCPeerConnection, signalingUrl: string, signal: AbortSignal): Promise<void> {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const localSdp = pc.localDescription?.sdp;
  if (!localSdp) throw new Error("Missing local SDP");
  const response = await fetch(signalingUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
      Accept: "application/json,*/*",
    },
    body: localSdp,
    signal,
  });
  if (!response.ok) throw new Error(`Signaling HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await response.json()) as { code?: number; sdp?: string; msg?: string };
    if (json.code !== 0 || !json.sdp) throw new Error(json.msg ?? "Invalid signaling response");
    await pc.setRemoteDescription({ type: "answer", sdp: json.sdp });
    return;
  }
  const answerSdp = await response.text();
  if (!answerSdp.trim()) throw new Error("Empty signaling response");
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
}

export function EoVideoViewport({
  signalingUrl,
  iceServers,
  enabled,
  videoRef,
  peerConnectionRef,
  encodedSyncHub,
  videoReceiverRef,
  webCodecsPresentationRef,
}: {
  signalingUrl: string;
  iceServers: EoVideoIceServer[];
  enabled: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  peerConnectionRef?: React.MutableRefObject<RTCPeerConnection | null>;
  encodedSyncHub?: EoEncodedSyncHub;
  videoReceiverRef?: React.MutableRefObject<RTCRtpReceiver | null>;
  webCodecsPresentationRef?: React.MutableRefObject<EoWebCodecsPresentation>;
}) {
  const useCanvas = isEoVideoWebCodecsCanvasEnabled() && Boolean(encodedSyncHub && signalingUrl && enabled);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const frameBufferRef = useRef<EncodedFrameData[]>([]);
  const firstKeyFrameRef = useRef(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const detachEncodedRef = useRef<(() => void) | null>(null);
  const [webCodecsActive, setWebCodecsActive] = useState(false);
  const [videoWidth, setVideoWidth] = useState(0);
  const [videoHeight, setVideoHeight] = useState(0);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | "idle">("idle");
  const [iceConnectionState, setIceConnectionState] = useState<RTCIceConnectionState | "idle">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!useCanvas) {
      frameBufferRef.current = [];
      firstKeyFrameRef.current = false;
      const decoder = decoderRef.current;
      decoderRef.current = null;
      if (decoder && decoder.state !== "closed") {
        try {
          decoder.close();
        } catch {}
      }
      setWebCodecsActive(false);
      setVideoWidth(0);
      setVideoHeight(0);
      return;
    }
    if (typeof window === "undefined" || !window.VideoDecoder || !window.EncodedVideoChunk) return;
    let closed = false;

    const renderFrame = (videoFrame: VideoFrame) => {
      const canvas = canvasRef.current;
      if (!canvas || closed) {
        videoFrame.close();
        return;
      }
      const context = canvas.getContext("2d");
      if (!context) {
        videoFrame.close();
        return;
      }
      const width = videoFrame.displayWidth || videoFrame.codedWidth;
      const height = videoFrame.displayHeight || videoFrame.codedHeight;
      if (!width || !height) {
        videoFrame.close();
        return;
      }
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        setVideoWidth(width);
        setVideoHeight(height);
      }
      context.clearRect(0, 0, width, height);
      context.drawImage(videoFrame, 0, 0, width, height);
      videoFrame.close();
    };

    void (async () => {
      const decoder = new VideoDecoder({
        output: renderFrame,
        error: () => {},
      });
      for (const codec of CODECS) {
        try {
          const supported = VideoDecoder.isConfigSupported
            ? await VideoDecoder.isConfigSupported({
                codec,
                hardwareAcceleration: "prefer-hardware",
                optimizeForLatency: true,
              })
            : { supported: true };
          if (!supported.supported) continue;
          decoder.configure({
            codec,
            hardwareAcceleration: "prefer-hardware",
            optimizeForLatency: true,
          });
          if (!closed) {
            decoderRef.current = decoder;
            setWebCodecsActive(true);
          } else {
            decoder.close();
          }
          return;
        } catch {
          continue;
        }
      }
      decoder.close();
    })();

    return () => {
      closed = true;
      frameBufferRef.current = [];
      firstKeyFrameRef.current = false;
      const decoder = decoderRef.current;
      decoderRef.current = null;
      if (decoder && decoder.state !== "closed") {
        try {
          decoder.close();
        } catch {}
      }
      setWebCodecsActive(false);
    };
  }, [useCanvas]);

  const addEncodedFrame = useCallback((frame: EncodedFrameData) => {
    const decoder = decoderRef.current;
    if (!decoder || decoder.state !== "configured") return;
    const buffer = frameBufferRef.current;
    buffer.push(frame);
    if (buffer.length < FRAME_BUFFER_SIZE) return;
    const oldest = buffer.shift();
    if (!oldest) return;
    if (!firstKeyFrameRef.current && oldest.type !== "key") return;
    if (oldest.type === "key") firstKeyFrameRef.current = true;
    try {
      decoder.decode(
        new EncodedVideoChunk({
          type: oldest.type,
          timestamp: oldest.timestamp,
          data: oldest.data,
        }),
      );
    } catch {}
  }, []);

  const cleanup = useCallback(() => {
    detachEncodedRef.current?.();
    detachEncodedRef.current = null;
    encodedSyncHub?.clear();
    if (videoReceiverRef) videoReceiverRef.current = null;
    const pc = pcRef.current;
    pcRef.current = null;
    if (peerConnectionRef) peerConnectionRef.current = null;
    if (pc) {
      try {
        pc.close();
      } catch {}
    }
    const video = videoRef.current;
    if (video) video.srcObject = null;
    setConnectionState("idle");
    setIceConnectionState("idle");
  }, [encodedSyncHub, peerConnectionRef, videoReceiverRef, videoRef]);

  const start = useCallback(async () => {
    if (!enabled) return;
    if (!signalingUrl.trim()) {
      setError("Missing signalingUrl in EO video config");
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    cleanup();
    setError(null);
    const pc = new RTCPeerConnection({
      iceServers: iceServers as RTCIceServer[],
      ...(encodedSyncHub ? { encodedInsertableStreams: true } : {}),
    } as RTCConfiguration);
    pcRef.current = pc;
    if (peerConnectionRef) peerConnectionRef.current = pc;

    pc.onconnectionstatechange = () => setConnectionState(pc.connectionState);
    pc.oniceconnectionstatechange = () => setIceConnectionState(pc.iceConnectionState);
    pc.ontrack = (event) => {
      if (event.track.kind === "video" && encodedSyncHub) {
        if (videoReceiverRef) videoReceiverRef.current = event.receiver;
        detachEncodedRef.current?.();
        detachEncodedRef.current = attachEncodedVideoFrameSync(
          event.receiver,
          encodedSyncHub,
          useCanvas ? addEncodedFrame : undefined,
        );
      }
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      void video.play().catch(() => {});
    };

    try {
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), SIGNALING_TIMEOUT_MS);
      try {
        await negotiate(pc, signalingUrl, controller.signal);
      } finally {
        window.clearTimeout(timer);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      cleanup();
    }
  }, [addEncodedFrame, cleanup, enabled, encodedSyncHub, iceServers, peerConnectionRef, signalingUrl, useCanvas, videoReceiverRef, videoRef]);

  useEffect(() => {
    void start();
    return () => {
      cleanup();
    };
  }, [cleanup, start]);

  useEffect(() => {
    if (!webCodecsPresentationRef) return;
    webCodecsPresentationRef.current = {
      active: useCanvas && webCodecsActive && videoWidth > 0 && videoHeight > 0,
      width: videoWidth,
      height: videoHeight,
      canvas: useCanvas && webCodecsActive ? canvasRef.current : null,
    };
    return () => {
      webCodecsPresentationRef.current = {
        active: false,
        width: 0,
        height: 0,
        canvas: null,
      };
    };
  }, [canvasRef, useCanvas, videoHeight, videoWidth, webCodecsActive, webCodecsPresentationRef]);

  const canvasPresenting = useCanvas && webCodecsActive && videoWidth > 0 && videoHeight > 0;
  const showStatusBadge = Boolean(error) || connectionState !== "connected";
  const statusText = error
    ? error
    : connectionState === "connecting" || iceConnectionState === "checking"
      ? "视频连接中..."
      : connectionState === "failed" || iceConnectionState === "failed"
        ? "视频连接失败"
        : connectionState === "disconnected" || iceConnectionState === "disconnected"
          ? "视频连接已断开"
          : connectionState === "idle"
            ? "等待视频流..."
            : "";

  return (
    <>
      <video
        ref={videoRef}
        className={cn(
          "pointer-events-none absolute inset-0 h-full w-full object-fill",
          canvasPresenting && "opacity-0",
        )}
        playsInline
        muted
        autoPlay
        disablePictureInPicture
        controlsList="nopictureinpicture"
        disableRemotePlayback
      />
      {useCanvas ? (
        <canvas
          ref={canvasRef}
          className={cn(
            "pointer-events-none absolute inset-0 h-full w-full object-fill",
            !canvasPresenting && "opacity-0",
          )}
          aria-hidden
        />
      ) : null}
      {showStatusBadge && statusText ? (
        <div className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-black/60 px-2 py-1 text-[10px] text-white/85 backdrop-blur-sm">
          {statusText}
        </div>
      ) : null}
    </>
  );
}
