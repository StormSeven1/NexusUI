"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { attachEncodedVideoFrameSync, type EoEncodedSyncHub, type EncodedFrameData } from "@/lib/eo-video/eoWebrtcEncodedSync";
import type { EoVideoIceServer } from "@/lib/eo-video/types";

export interface UseWebRtcPlayerOptions {
  signalingUrl: string;
  iceServers: EoVideoIceServer[];
  /** 绑定远端流的 video 元素 */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** 为 false 时不建连（例如配置未就绪） */
  enabled?: boolean;
  /** 供检测框同步等读取 RTCPeerConnection（与 base-vue getStats 对齐） */
  peerConnectionRef?: React.MutableRefObject<RTCPeerConnection | null>;
  /** 可选：Insertable Streams 写入编码帧 ring，供检测按「显示滞后」取 syncHeader */
  encodedSyncHub?: EoEncodedSyncHub;
  /**
   * 视频接收端引用，供外部动态设置 jitterBufferTarget。
   * 检测 hook 学到后端延迟后会自动更新该值，让视频显示延迟与检测延迟对齐。
   */
  videoReceiverRef?: React.MutableRefObject<RTCRtpReceiver | null>;
  /** WebCodecs Canvas 模式：编码帧通过此回调传给 Canvas 解码渲染 */
  onEncodedFrame?: (frame: EncodedFrameData) => void;
}

export interface UseWebRtcPlayerResult {
  connectionState: RTCPeerConnectionState | "idle";
  iceConnectionState: RTCIceConnectionState | "idle";
  error: string | null;
  /** 手动重连（切换流时调用） */
  restart: () => void;
}

const SIGNALING_FETCH_TIMEOUT_MS = 5000;
const ICE_RECONNECT_DELAYS_MS = [300, 350, 400, 500, 600, 800, 1000, 1200, 1500, 1800, 2200, 2600];
const BLACK_FRAME_CHECK_MS = 450;
const BLACK_FRAME_GIVEUP_MS = 2400;

/**
 * ZLMediaKit 风格 WebRTC 播放：POST offer SDP（text/plain），响应 JSON { code, sdp }。
 */
async function negotiateZlmStyle(pc: RTCPeerConnection, signalingUrl: string, signal: AbortSignal): Promise<void> {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const sdp = pc.localDescription?.sdp;
  if (!sdp) throw new Error("Missing local SDP");

  const res = await fetch(signalingUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8", Accept: "application/json,*/*" },
    body: sdp,
    signal,
  });
  if (!res.ok) throw new Error(`Signaling HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const json = (await res.json()) as { code?: number; sdp?: string; msg?: string };
    if (json.code !== 0 || !json.sdp) throw new Error(json.msg ?? "Invalid signaling JSON");
    await pc.setRemoteDescription({ type: "answer", sdp: json.sdp });
    return;
  }
  const answerSdp = await res.text();
  if (!answerSdp.trim()) throw new Error("Empty SDP answer");
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
}

export function useWebRtcPlayer({
  signalingUrl,
  iceServers,
  videoRef,
  enabled = true,
  peerConnectionRef,
  encodedSyncHub,
  videoReceiverRef,
  onEncodedFrame,
}: UseWebRtcPlayerOptions): UseWebRtcPlayerResult {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const detachEncodedRef = useRef<(() => void) | null>(null);
  /** 浏览器定时器句柄（避免与 Node `Timeout` 类型合并冲突） */
  const iceRecoverTimerRef = useRef<number | null>(null);
  const blackFrameTimerRef = useRef<number | null>(null);
  const iceFailCountRef = useRef(0);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | "idle">("idle");
  const [iceConnectionState, setIceConnectionState] = useState<RTCIceConnectionState | "idle">("idle");
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(0);
  /** 仅在 signalingUrl / enabled / ice 配置变化时递增，用于取消旧的重连定时器（避免与 gen 递增冲突） */
  const bootSeqRef = useRef(0);

  const cleanup = useCallback(() => {
    if (iceRecoverTimerRef.current != null) {
      window.clearTimeout(iceRecoverTimerRef.current);
      iceRecoverTimerRef.current = null;
    }
    if (blackFrameTimerRef.current != null) {
      window.clearInterval(blackFrameTimerRef.current);
      blackFrameTimerRef.current = null;
    }
    detachEncodedRef.current?.();
    detachEncodedRef.current = null;
    encodedSyncHub?.clear();
    if (videoReceiverRef) videoReceiverRef.current = null;
    const pc = pcRef.current;
    pcRef.current = null;
    if (peerConnectionRef) peerConnectionRef.current = null;
    if (pc) {
      try {
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.oniceconnectionstatechange = null;
        pc.close();
      } catch {
        /* ignore */
      }
    }
    const v = videoRef.current;
    if (v) {
      v.srcObject = null;
    }
    setConnectionState("idle");
    setIceConnectionState("idle");
  }, [encodedSyncHub, peerConnectionRef, videoRef]);

  const start = useCallback(async () => {
    if (!enabled || !signalingUrl) return;
    const video = videoRef.current;
    if (!video) return;

    const gen = ++genRef.current;
    const bootSnapshot = bootSeqRef.current;
    cleanup();
    setError(null);

    const rtcConfig = {
      iceServers: iceServers as RTCIceServer[],
      ...(encodedSyncHub ? { encodedInsertableStreams: true } : {}),
    } as RTCConfiguration;
    const pc = new RTCPeerConnection(rtcConfig);
    pcRef.current = pc;
    if (peerConnectionRef) peerConnectionRef.current = pc;

    const scheduleIceReconnect = (reason: string) => {
      if (bootSnapshot !== bootSeqRef.current) return;
      if (iceRecoverTimerRef.current != null) return;
      iceFailCountRef.current += 1;
      if (iceFailCountRef.current > 14) {
        setError(`WebRTC 多次重连仍失败（${reason}）`);
        return;
      }
      const delay = ICE_RECONNECT_DELAYS_MS[Math.min(iceFailCountRef.current - 1, ICE_RECONNECT_DELAYS_MS.length - 1)];
      iceRecoverTimerRef.current = window.setTimeout(() => {
        iceRecoverTimerRef.current = null;
        if (bootSnapshot !== bootSeqRef.current) return;
        void start();
      }, delay);
    };

    pc.onconnectionstatechange = () => {
      if (genRef.current !== gen) return;
      setConnectionState(pc.connectionState);
      if (pc.connectionState === "failed") {
        scheduleIceReconnect(`PC=${pc.connectionState}`);
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (genRef.current !== gen) return;
      setIceConnectionState(pc.iceConnectionState);
      const s = pc.iceConnectionState;
      if (s === "connected" || s === "completed") {
        iceFailCountRef.current = 0;
      }
      if (s === "failed") {
        scheduleIceReconnect(`ICE=${s}`);
      }
      if (s === "disconnected") {
        window.setTimeout(() => {
          if (genRef.current !== gen) return;
          if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
            scheduleIceReconnect(`ICE=${pc.iceConnectionState}`);
          }
        }, 900);
      }
    };

    pc.ontrack = (ev) => {
      if (genRef.current !== gen) return;
      if (ev.track.kind === "video") {
        if (videoReceiverRef) videoReceiverRef.current = ev.receiver;
        if (encodedSyncHub) {
          detachEncodedRef.current?.();
          detachEncodedRef.current = null;
          try {
            detachEncodedRef.current = attachEncodedVideoFrameSync(ev.receiver, encodedSyncHub, onEncodedFrame);
          } catch {
            detachEncodedRef.current = null;
          }
        }
      }
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      try {
        video.disablePictureInPicture = true;
      } catch {
        /* UA 不支持时忽略 */
      }
      void video.play().catch(() => {
        /* autoplay policy */
      });

      if (blackFrameTimerRef.current != null) {
        window.clearInterval(blackFrameTimerRef.current);
        blackFrameTimerRef.current = null;
      }
      const t0 = Date.now();
      blackFrameTimerRef.current = window.setInterval(() => {
        if (genRef.current !== gen) {
          if (blackFrameTimerRef.current != null) window.clearInterval(blackFrameTimerRef.current);
          blackFrameTimerRef.current = null;
          return;
        }
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          iceFailCountRef.current = 0;
          if (blackFrameTimerRef.current != null) window.clearInterval(blackFrameTimerRef.current);
          blackFrameTimerRef.current = null;
          return;
        }
        if (Date.now() - t0 >= BLACK_FRAME_GIVEUP_MS) {
          if (blackFrameTimerRef.current != null) window.clearInterval(blackFrameTimerRef.current);
          blackFrameTimerRef.current = null;
          scheduleIceReconnect("black_frame_timeout");
        }
      }, BLACK_FRAME_CHECK_MS);
    };

    try {
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
      const ac = new AbortController();
      const to = window.setTimeout(() => ac.abort(), SIGNALING_FETCH_TIMEOUT_MS);
      try {
        await negotiateZlmStyle(pc, signalingUrl, ac.signal);
      } finally {
        window.clearTimeout(to);
      }
    } catch (e) {
      if (genRef.current !== gen) return;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("abort") || msg === "timeout" || msg.includes("The user aborted")) {
        setError(`信令超时（>${SIGNALING_FETCH_TIMEOUT_MS}ms），正在重试…`);
        cleanup();
        scheduleIceReconnect("signaling_timeout");
        return;
      }
      setError(msg);
      cleanup();
    }
  }, [cleanup, enabled, encodedSyncHub, iceServers, onEncodedFrame, peerConnectionRef, signalingUrl, videoReceiverRef, videoRef]);

  const restart = useCallback(() => {
    void start();
  }, [start]);

  const iceKey = JSON.stringify(iceServers);

  useEffect(() => {
    bootSeqRef.current += 1;
    iceFailCountRef.current = 0;
    void start();
    return () => {
      genRef.current += 1;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- videoRef 稳定；iceServers 用序列化键
  }, [signalingUrl, enabled, iceKey, start, cleanup]);

  return { connectionState, iceConnectionState, error, restart };
}
