"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildAvcCFromKeyFrame } from "@/lib/eo-video/h264AvcConfig";
import type { EncodedFrameData } from "@/lib/eo-video/eoWebrtcEncodedSync";

/** 环缓冲上限：避免挤掉 IDR；与开解阈值分离以控制首帧延迟 */
const MAX_FRAME_BUFFER = 8;
const MIN_FRAMES_BEFORE_DECODE = 2;

/** WebRTC H.264 常用 90kHz RTP 时钟 */
const RTP_CLOCK_HZ = 90_000;
/** 允许解码输出相对已显示帧最多回退约 2 帧（25fps） */
const MAX_RENDER_BACKWARD_TICKS = Math.round((2 / 25) * RTP_CLOCK_HZ);
/** 相对当前输入前沿超过该 lag 的编码包/解码输出视为过期，拒绝解码或上屏（防「闪很久以前的画面」） */
const MAX_STALE_TICKS = Math.round(0.5 * RTP_CLOCK_HZ);

/** RTP timestamp 有符号差值（a - b），正确处理 32-bit 回绕 */
function rtpSignedDelta(a: number, b: number): number {
  let d = (a - b) | 0;
  if (d > 0x7fffffff) d -= 0x100000000;
  if (d < -0x80000000) d += 0x100000000;
  return d;
}

const CODECS = [
  "avc1.640028",
  "avc1.42001e",
  "avc1.42e01e",
  "avc1.42001f",
];

const HW_MODES = ["prefer-hardware", "prefer-software"] as const;

export type WebCodecsDecodePath = "pending" | "hardware" | "software" | "failed";

export interface WebCodecsCanvasHandle {
  addEncodedFrame: (frame: EncodedFrameData) => void;
  /** 切换 WebRTC 信令 URL 时清空 Canvas/解码状态，避免仍显示上一路画面 */
  resetForNewStream: () => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  webCodecsActive: boolean;
  videoWidth: number;
  videoHeight: number;
  decodePath: WebCodecsDecodePath;
  hasRenderedFrame: boolean;
  /** 已上屏最新 RTP timestamp（供检测 syncHeader 对齐） */
  lastRenderedRtpTimestampRef: React.MutableRefObject<number>;
}

async function tryConfigureDecoder(
  decoder: VideoDecoder,
  codec: string,
  hardwareAcceleration: VideoDecoderConfig["hardwareAcceleration"],
  description?: Uint8Array | null,
): Promise<boolean> {
  const config: VideoDecoderConfig = {
    codec,
    hardwareAcceleration,
    optimizeForLatency: true,
    ...(description?.byteLength ? { description } : {}),
  };
  if (VideoDecoder.isConfigSupported) {
    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) return false;
  }
  decoder.configure(config);
  return true;
}

/**
 * WebCodecs + Canvas 视频解码渲染 hook。
 * 首帧 IDR 提取 avcC 再 configure；关键帧丢失或 decode 错误时 reset。
 */
export function useWebCodecsCanvas(): WebCodecsCanvasHandle {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const frameBufferRef = useRef<EncodedFrameData[]>([]);
  const firstKeyFrameRef = useRef(false);
  const decoderConfiguredRef = useRef(false);
  const avcDescriptionRef = useRef<Uint8Array | null>(null);
  const hasRenderedFrameRef = useRef(false);
  const lastRenderedTimestampRef = useRef(0);
  const latestInputTimestampRef = useRef(0);
  const decodePendingRef = useRef<() => void>(() => {});
  const [webCodecsActive, setWebCodecsActive] = useState(false);
  const [videoWidth, setVideoWidth] = useState(0);
  const [videoHeight, setVideoHeight] = useState(0);
  const [decodePath, setDecodePath] = useState<WebCodecsDecodePath>("pending");
  const [hasRenderedFrame, setHasRenderedFrame] = useState(false);

  const stableRefs = useRef({ canvasRef, setVideoWidth, setVideoHeight });

  useEffect(() => {
    if (typeof window === "undefined" || !window.VideoDecoder || !window.EncodedVideoChunk) {
      setDecodePath("failed");
      return;
    }

    let closed = false;

    const markRendered = () => {
      if (hasRenderedFrameRef.current) return;
      hasRenderedFrameRef.current = true;
      setHasRenderedFrame(true);
    };

    const resetDecoderState = (reason: string) => {
      if (closed) return;
      console.warn(`[WebCodecs] reset: ${reason}`);
      firstKeyFrameRef.current = false;
      decoderConfiguredRef.current = false;
      avcDescriptionRef.current = null;
      const d = decoderRef.current;
      if (d && d.state === "configured") {
        try {
          d.reset();
        } catch {
          /* */
        }
      }
    };

    const shouldDropDecodedOutput = (timestamp: number): boolean => {
      const lastRendered = lastRenderedTimestampRef.current;
      if (lastRendered !== 0) {
        const behindRendered = rtpSignedDelta(lastRendered, timestamp);
        if (behindRendered > MAX_RENDER_BACKWARD_TICKS) {
          return true;
        }
      }
      const inputFront = latestInputTimestampRef.current;
      if (inputFront !== 0) {
        const behindInput = rtpSignedDelta(inputFront, timestamp);
        if (behindInput > MAX_STALE_TICKS) {
          return true;
        }
      }
      return false;
    };

    const configureFromKeyFrame = async (keyData: ArrayBuffer): Promise<boolean> => {
      const decoder = decoderRef.current;
      if (!decoder || closed) return false;

      const avcC = buildAvcCFromKeyFrame(keyData);
      if (avcC) avcDescriptionRef.current = avcC;

      for (const hw of HW_MODES) {
        for (const codec of CODECS) {
          try {
            const ok = await tryConfigureDecoder(
              decoder,
              codec,
              hw,
              avcDescriptionRef.current,
            );
            if (!ok || closed) continue;
            decoderConfiguredRef.current = true;
            setWebCodecsActive(true);
            setDecodePath(hw === "prefer-hardware" ? "hardware" : "software");
            console.info(
              `[WebCodecs] decoder ready codec=${codec} acceleration=${hw}${avcC ? " avcC" : ""}`,
            );
            return true;
          } catch {
            continue;
          }
        }
      }
      return false;
    };

    const drainDecodeQueue = () => {
      if (closed) return;
      const decoder = decoderRef.current;
      if (!decoder || decoder.decodeQueueSize > 0) return;

      const fb = frameBufferRef.current;
      const inputFront = latestInputTimestampRef.current;

      while (fb.length >= MIN_FRAMES_BEFORE_DECODE) {
        const oldest = fb[0]!;
        if (inputFront !== 0 && rtpSignedDelta(inputFront, oldest.timestamp) > MAX_STALE_TICKS) {
          fb.shift();
          if (oldest.type === "key") {
            resetDecoderState("stale key frame dropped");
          }
          continue;
        }

        if (!firstKeyFrameRef.current && oldest.type !== "key") {
          if (fb.length >= MAX_FRAME_BUFFER) {
            /** 丢弃最旧 delta，继续等 IDR，避免整段清空导致黑屏 */
            fb.shift();
          }
          return;
        }

        if (oldest.type === "key" && !decoderConfiguredRef.current) {
          void configureFromKeyFrame(oldest.data).then((ok) => {
            if (ok && !closed) drainDecodeQueue();
            else if (!ok && !closed) {
              resetDecoderState("configure failed");
              setDecodePath("failed");
              setWebCodecsActive(false);
            }
          });
          return;
        }

        if (!decoderConfiguredRef.current || decoder.state !== "configured") return;

        fb.shift();
        if (oldest.type === "key") firstKeyFrameRef.current = true;

        try {
          const chunk = new EncodedVideoChunk({
            type: oldest.type,
            timestamp: oldest.timestamp,
            data: oldest.data,
          });
          decoder.decode(chunk);
        } catch (err) {
          console.error("[WebCodecs] decode chunk error:", err);
          resetDecoderState("decode chunk error");
        }
        return;
      }
    };

    decodePendingRef.current = drainDecodeQueue;

    const renderFrame = (videoFrame: VideoFrame) => {
      if (closed) {
        try {
          videoFrame.close();
        } catch {
          /* */
        }
        return;
      }
      const ts = videoFrame.timestamp ?? 0;
      if (shouldDropDecodedOutput(ts)) {
        try {
          videoFrame.close();
        } catch {
          /* */
        }
        drainDecodeQueue();
        return;
      }
      const refs = stableRefs.current;
      try {
        const canvas = refs.canvasRef.current;
        if (!canvas) {
          videoFrame.close();
          return;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          videoFrame.close();
          return;
        }

        const fw = videoFrame.displayWidth || videoFrame.codedWidth;
        const fh = videoFrame.displayHeight || videoFrame.codedHeight;
        if (fw <= 0 || fh <= 0) {
          videoFrame.close();
          return;
        }

        if (canvas.width !== fw || canvas.height !== fh) {
          canvas.width = fw;
          canvas.height = fh;
          refs.setVideoWidth(fw);
          refs.setVideoHeight(fh);
        }

        ctx.clearRect(0, 0, fw, fh);
        ctx.drawImage(videoFrame, 0, 0, fw, fh);
        lastRenderedTimestampRef.current = ts;
        markRendered();
        videoFrame.close();
      } catch {
        try {
          videoFrame.close();
        } catch {
          /* */
        }
      } finally {
        drainDecodeQueue();
      }
    };

    try {
      const decoder = new VideoDecoder({
        output: (frame) => renderFrame(frame),
        error: (err) => {
          console.error("[WebCodecs] decode error:", err);
          if (!closed) {
            resetDecoderState(String(err));
            setDecodePath("failed");
            setWebCodecsActive(false);
          }
        },
      });
      decoderRef.current = decoder;
    } catch {
      setDecodePath("failed");
    }

    return () => {
      closed = true;
      const d = decoderRef.current;
      decoderRef.current = null;
      if (d && d.state !== "closed") {
        try {
          d.close();
        } catch {
          /* */
        }
      }
      frameBufferRef.current = [];
      firstKeyFrameRef.current = false;
      decoderConfiguredRef.current = false;
      avcDescriptionRef.current = null;
      hasRenderedFrameRef.current = false;
      lastRenderedTimestampRef.current = 0;
      latestInputTimestampRef.current = 0;
      decodePendingRef.current = () => {};
      setWebCodecsActive(false);
      setHasRenderedFrame(false);
      setDecodePath("pending");
    };
  }, []);

  const resetForNewStream = useCallback(() => {
    frameBufferRef.current = [];
    firstKeyFrameRef.current = false;
    decoderConfiguredRef.current = false;
    avcDescriptionRef.current = null;
    hasRenderedFrameRef.current = false;
    lastRenderedTimestampRef.current = 0;
    latestInputTimestampRef.current = 0;
    setWebCodecsActive(false);
    setHasRenderedFrame(false);
    setDecodePath("pending");
    setVideoWidth(0);
    setVideoHeight(0);

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 0;
      canvas.height = 0;
    }

    const d = decoderRef.current;
    if (d && d.state === "configured") {
      try {
        d.reset();
      } catch {
        /* */
      }
    }
  }, []);

  const addEncodedFrame = useCallback((frame: EncodedFrameData) => {
    latestInputTimestampRef.current = frame.timestamp;

    const fb = frameBufferRef.current;
    fb.push(frame);
    while (fb.length > MAX_FRAME_BUFFER) {
      const dropped = fb.shift();
      if (dropped?.type === "key" && firstKeyFrameRef.current) {
        firstKeyFrameRef.current = false;
        decoderConfiguredRef.current = false;
        const d = decoderRef.current;
        if (d && d.state === "configured") {
          try {
            d.reset();
          } catch {
            /* */
          }
        }
      }
    }

    decodePendingRef.current();
  }, []);

  return {
    addEncodedFrame,
    resetForNewStream,
    canvasRef,
    webCodecsActive,
    videoWidth,
    videoHeight,
    decodePath,
    hasRenderedFrame,
    lastRenderedRtpTimestampRef: lastRenderedTimestampRef,
  };
};
