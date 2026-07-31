"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { reattachVideoFromPeer } from "@/lib/eo-video/eoSharedPlaybackStream";
import { shouldCutEoVideoHardwarePassthrough } from "@/lib/eo-video/eoVideoHardwarePassthrough";
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
  /**
   * 运行时强制 `<video>` 接流（WebCodecs 硬/软解均失败或无画面时由上层置 true 并 restart）。
   * 仍保留 Insertable Streams → encodedSyncHub 供检测对齐。
   */
  forceVideoPassthrough?: boolean;
  /**
   * 停帧看门狗间隔（ms）。默认开启（约 4s）；显式传 `0` 关闭。
   * 用 `getStats().framesDecoded` 判断停帧（避免 videoWidth>0 冻帧误判为正常）。
   */
  stallWatchIntervalMs?: number;
  /** 递增时强制重建 WebRTC（如私有云 start 推流后需重连 ZLM） */
  webRtcKickEpoch?: number;
  /** 停帧恢复前先调用（如 poke 推流）；随后自动 WebRTC restart */
  onStallRecover?: () => void;
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

/** 对齐 C++ `PtzMainWidget::m_uavReconnectTimer`（6000ms） */
export const WEBRTC_UAV_STALL_WATCH_INTERVAL_MS = 6000;
/** 相机/UAV 硬件播默认停帧看门狗；显式传 stallWatchIntervalMs=0 关闭 */
export const WEBRTC_DEFAULT_STALL_WATCH_INTERVAL_MS = 4000;
const STALL_WATCH_GRACE_MS = 5000;
const STALL_NEVER_PICTURE_GRACE_MS = 8000;
const STALL_RECOVER_COOLDOWN_MS = 8000;
const ICE_FAIL_HARD_LIMIT = 14;
const ICE_FAIL_UNLOCK_MS = 20000;
/** 切回前台后等待解码/出画的探测窗口；仍无进展则判定停流并重连 */
const FOREGROUND_PROBE_MS = 1800;
/** 多路光电同时 focus 重连时错开信令，避免 ZLM 挤爆只剩部分窗有画 */
const FOREGROUND_RESTART_STAGGER_STEP_MS = 380;
const FOREGROUND_RESTART_STAGGER_SLOTS = 6;

function staggerMsForKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return (Math.abs(h) % FOREGROUND_RESTART_STAGGER_SLOTS) * FOREGROUND_RESTART_STAGGER_STEP_MS;
}

/**
 * 等真正送到 `<video>` 的一帧（遮挡/切窗后常见：framesDecoded 仍涨但画面黑）。
 * 无 rVFC 时退化为 videoWidth>0 且未 paused。
 */
function waitForVideoPaint(video: HTMLVideoElement | null, timeoutMs: number): Promise<boolean> {
  if (!video) return Promise.resolve(false);
  if (video.videoWidth > 0 && video.videoHeight > 0 && !video.paused) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const v = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: unknown) => void) => number;
      cancelVideoFrameCallback?: (id: number) => void;
    };
    let rVfcId: number | null = null;
    let timer: number | null = null;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (timer != null) window.clearTimeout(timer);
      if (rVfcId != null) {
        try {
          v.cancelVideoFrameCallback?.(rVfcId);
        } catch {
          /* ignore */
        }
      }
      resolve(ok);
    };
    if (typeof v.requestVideoFrameCallback === "function") {
      rVfcId = v.requestVideoFrameCallback(() => finish(true));
    }
    timer = window.setTimeout(() => {
      finish(video.videoWidth > 0 && video.videoHeight > 0 && !video.paused);
    }, timeoutMs);
  });
}

async function readInboundVideoFramesDecoded(pc: RTCPeerConnection): Promise<number | null> {
  const stats = await pc.getStats();
  for (const report of stats.values()) {
    if (report.type !== "inbound-rtp") continue;
    const rtp = report as RTCInboundRtpStreamStats;
    if (rtp.kind !== "video") continue;
    if (typeof rtp.framesDecoded === "number" && Number.isFinite(rtp.framesDecoded)) {
      return rtp.framesDecoded;
    }
  }
  return null;
}

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
  forceVideoPassthrough = false,
  stallWatchIntervalMs,
  onStallRecover,
  webRtcKickEpoch = 0,
}: UseWebRtcPlayerOptions): UseWebRtcPlayerResult {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const detachEncodedRef = useRef<(() => void) | null>(null);
  /** 浏览器定时器句柄（避免与 Node `Timeout` 类型合并冲突） */
  const iceRecoverTimerRef = useRef<number | null>(null);
  const iceUnlockTimerRef = useRef<number | null>(null);
  const blackFrameTimerRef = useRef<number | null>(null);
  const stallWatchTimerRef = useRef<number | null>(null);
  const prevFramesDecodedRef = useRef<number | null>(null);
  const hadLiveFramesRef = useRef(false);
  const stallWatchSinceRef = useRef(0);
  const lastStallRecoverAtRef = useRef(0);
  const softHealAttemptedRef = useRef(false);
  const onStallRecoverRef = useRef(onStallRecover);
  onStallRecoverRef.current = onStallRecover;
  const iceFailCountRef = useRef(0);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | "idle">("idle");
  const [iceConnectionState, setIceConnectionState] = useState<RTCIceConnectionState | "idle">("idle");
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(0);
  /** 仅在 signalingUrl / enabled / ice 配置变化时递增，用于取消旧的重连定时器（避免与 gen 递增冲突） */
  const bootSeqRef = useRef(0);
  /** 本 hook 是否曾接管过 video.srcObject；共享小窗流时不得在 cleanup 里清空 */
  const didOwnPlaybackRef = useRef(false);

  const cleanup = useCallback(() => {
    if (iceRecoverTimerRef.current != null) {
      window.clearTimeout(iceRecoverTimerRef.current);
      iceRecoverTimerRef.current = null;
    }
    if (iceUnlockTimerRef.current != null) {
      window.clearTimeout(iceUnlockTimerRef.current);
      iceUnlockTimerRef.current = null;
    }
    if (blackFrameTimerRef.current != null) {
      window.clearInterval(blackFrameTimerRef.current);
      blackFrameTimerRef.current = null;
    }
    if (stallWatchTimerRef.current != null) {
      window.clearInterval(stallWatchTimerRef.current);
      stallWatchTimerRef.current = null;
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
    const owned = didOwnPlaybackRef.current;
    didOwnPlaybackRef.current = false;
    const v = videoRef.current;
    if (v && owned) {
      v.srcObject = null;
    }
    setConnectionState("idle");
    setIceConnectionState("idle");
  }, [encodedSyncHub, peerConnectionRef, videoRef, videoReceiverRef]);

  const start = useCallback(async () => {
    if (!enabled || !signalingUrl) return;
    const video = videoRef.current;
    if (!video) return;

    const gen = ++genRef.current;
    const bootSnapshot = bootSeqRef.current;
    cleanup();
    didOwnPlaybackRef.current = true;
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
      if (iceFailCountRef.current > ICE_FAIL_HARD_LIMIT) {
        setError(`WebRTC 多次重连仍失败（${reason}），稍后自动再试…`);
        if (iceUnlockTimerRef.current == null) {
          iceUnlockTimerRef.current = window.setTimeout(() => {
            iceUnlockTimerRef.current = null;
            if (bootSnapshot !== bootSeqRef.current) return;
            iceFailCountRef.current = 0;
            setError(null);
            void start();
          }, ICE_FAIL_UNLOCK_MS);
        }
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
            detachEncodedRef.current = attachEncodedVideoFrameSync(
              ev.receiver,
              encodedSyncHub,
              onEncodedFrame,
              forceVideoPassthrough,
            );
          } catch {
            detachEncodedRef.current = null;
          }
        }
      }
      const cutVideoDecode =
        shouldCutEoVideoHardwarePassthrough(Boolean(onEncodedFrame)) && !forceVideoPassthrough;
      if (!cutVideoDecode) {
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
      } else {
        video.srcObject = null;
        iceFailCountRef.current = 0;
      }
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
  }, [
    cleanup,
    enabled,
    encodedSyncHub,
    forceVideoPassthrough,
    iceServers,
    onEncodedFrame,
    peerConnectionRef,
    signalingUrl,
    videoReceiverRef,
    videoRef,
  ]);

  const restart = useCallback(() => {
    void start();
  }, [start]);

  const restartRef = useRef(restart);
  restartRef.current = restart;

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
  }, [signalingUrl, enabled, iceKey, forceVideoPassthrough, webRtcKickEpoch, start, cleanup]);

  useEffect(() => {
    const intervalMs =
      stallWatchIntervalMs === undefined
        ? WEBRTC_DEFAULT_STALL_WATCH_INTERVAL_MS
        : stallWatchIntervalMs;
    if (!enabled || intervalMs <= 0) return;

    const resetStallWatchState = () => {
      prevFramesDecodedRef.current = null;
      hadLiveFramesRef.current = false;
      softHealAttemptedRef.current = false;
      stallWatchSinceRef.current = Date.now();
    };

    resetStallWatchState();

    const triggerRecover = () => {
      lastStallRecoverAtRef.current = Date.now();
      iceFailCountRef.current = Math.min(iceFailCountRef.current, 2);
      resetStallWatchState();
      try {
        onStallRecoverRef.current?.();
      } catch {
        /* ignore */
      }
      restartRef.current();
    };

    const checkStall = async () => {
      if (typeof document !== "undefined" && document.hidden) return;

      const now = Date.now();
      if (now - lastStallRecoverAtRef.current < STALL_RECOVER_COOLDOWN_MS) return;

      const pc = pcRef.current;
      const video = videoRef.current;
      if (!pc) return;

      const ice = pc.iceConnectionState;
      if (ice !== "connected" && ice !== "completed") {
        prevFramesDecodedRef.current = null;
        softHealAttemptedRef.current = false;
        return;
      }
      if (pc.connectionState !== "connected") return;

      // 软恢复：轨还在但 video 空/暂停（放大关窗、srcObject 被清等）
      if (video) {
        const healed = reattachVideoFromPeer(video, pc);
        if (healed && video.videoWidth > 0 && video.videoHeight > 0) {
          softHealAttemptedRef.current = false;
        }
      }

      let framesDecoded: number | null;
      try {
        framesDecoded = await readInboundVideoFramesDecoded(pc);
      } catch {
        return;
      }

      const videoHasPicture = Boolean(video && video.videoWidth > 0 && video.videoHeight > 0);
      const since = now - stallWatchSinceRef.current;

      // 无 inbound-rtp：宽限后仍无画 → 重建
      if (framesDecoded == null) {
        if (since >= STALL_NEVER_PICTURE_GRACE_MS && !videoHasPicture) {
          if (!softHealAttemptedRef.current) {
            softHealAttemptedRef.current = true;
            reattachVideoFromPeer(video, pc);
            return;
          }
          triggerRecover();
        }
        return;
      }

      const prev = prevFramesDecodedRef.current;
      if (prev != null) {
        const delta = framesDecoded - prev;
        if (delta > 0) {
          hadLiveFramesRef.current = true;
          iceFailCountRef.current = 0;
          softHealAttemptedRef.current = false;
        }

        const stalledAfterLive =
          since >= STALL_WATCH_GRACE_MS && hadLiveFramesRef.current && delta <= 0;
        // 不要求 videoHasPicture：冻帧常仍有 videoWidth>0，旧逻辑会永远不恢复
        const neverGotPicture =
          since >= STALL_NEVER_PICTURE_GRACE_MS && !hadLiveFramesRef.current && !videoHasPicture && delta <= 0;

        if (stalledAfterLive || neverGotPicture) {
          if (!softHealAttemptedRef.current) {
            softHealAttemptedRef.current = true;
            reattachVideoFromPeer(video, pc);
            prevFramesDecodedRef.current = framesDecoded;
            return;
          }
          triggerRecover();
          return;
        }
      }

      prevFramesDecodedRef.current = framesDecoded;
    };

    stallWatchTimerRef.current = window.setInterval(() => {
      void checkStall();
    }, intervalMs);

    return () => {
      if (stallWatchTimerRef.current != null) {
        window.clearInterval(stallWatchTimerRef.current);
        stallWatchTimerRef.current = null;
      }
    };
  }, [enabled, stallWatchIntervalMs, signalingUrl, videoRef]);

  /**
   * 切回前台主动恢复：
   * - 切标签：document.hidden + visibilitychange
   * - 编译器盖住再点回网页：常不改 hidden，只靠 window focus
   * 旧逻辑只看 framesDecoded：遮挡后解码计数仍可能上涨，但 `<video>` 黑屏（右侧小窗更易中招），
   * 误判为正常就不重连——表现为「多光电 4 黑、点重连才好」。
   * 现改为：软挂回轨 + 等真正出画；无出画则按流 URL 错开硬重连，避免多路同时打 ZLM。
   */
  useEffect(() => {
    if (!enabled) return;
    if (typeof document === "undefined") return;

    let foregroundGen = 0;
    let lastForegroundAt = 0;

    const scheduleHardRestart = () => {
      const delay = staggerMsForKey(signalingUrl || "webrtc");
      window.setTimeout(() => {
        if (document.hidden) return;
        restartRef.current();
      }, delay);
    };

    const onForeground = () => {
      if (document.hidden) return;
      const now = Date.now();
      // focus 会连打多次，短窗内合并成一次探测
      if (now - lastForegroundAt < 400) return;
      lastForegroundAt = now;
      const gen = ++foregroundGen;

      const pc = pcRef.current;
      const video = videoRef.current;

      if (!pc || pc.connectionState === "failed" || pc.connectionState === "closed") {
        scheduleHardRestart();
        return;
      }

      lastStallRecoverAtRef.current = 0;

      if (video) {
        reattachVideoFromPeer(video, pc);
        void video.play().catch(() => {});
      }

      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
        scheduleHardRestart();
        return;
      }

      void (async () => {
        const paintedQuick = await waitForVideoPaint(videoRef.current, Math.min(600, FOREGROUND_PROBE_MS));
        if (gen !== foregroundGen || document.hidden) return;
        if (paintedQuick) return;

        let base: number | null = null;
        try {
          base = await readInboundVideoFramesDecoded(pc);
        } catch {
          /* ignore */
        }
        if (gen !== foregroundGen || document.hidden) return;

        window.setTimeout(() => {
          if (gen !== foregroundGen || document.hidden) return;
          const cur = pcRef.current;
          if (!cur || cur !== pc) return;
          void (async () => {
            let after: number | null = null;
            try {
              after = await readInboundVideoFramesDecoded(cur);
            } catch {
              /* ignore */
            }
            const v = videoRef.current;
            const painted = await waitForVideoPaint(v, 400);
            if (gen !== foregroundGen || document.hidden) return;
            const advancing = after != null && base != null && after > base;
            // 无出画就重连：即便 framesDecoded 在涨（遮挡后解码空转/画面未挂上）
            if (!painted || !advancing) {
              scheduleHardRestart();
            } else if (v) {
              void v.play().catch(() => {});
            }
          })();
        }, FOREGROUND_PROBE_MS);
      })();
    };

    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    return () => {
      foregroundGen += 1;
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
    };
  }, [enabled, signalingUrl, videoRef]);

  return { connectionState, iceConnectionState, error, restart };
}
