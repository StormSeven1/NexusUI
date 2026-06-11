"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EncodedFrameData } from "@/lib/eo-video/eoWebrtcEncodedSync";

/** 直播低延迟：2 帧即可开解；原 16 帧在 25fps 下约 +640ms，叠加 Insertable Streams 易体感数秒延迟 */
const FRAME_BUFFER_SIZE = 2;

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
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  webCodecsActive: boolean;
  videoWidth: number;
  videoHeight: number;
  /** 解码器初始化结果：pending → hardware/software，或 failed */
  decodePath: WebCodecsDecodePath;
  /** 是否已成功绘制至少一帧到 Canvas */
  hasRenderedFrame: boolean;
}

async function tryConfigureDecoder(
  decoder: VideoDecoder,
  codec: string,
  hardwareAcceleration: VideoDecoderConfig["hardwareAcceleration"],
): Promise<boolean> {
  const config: VideoDecoderConfig = {
    codec,
    hardwareAcceleration,
    optimizeForLatency: true,
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
 * 初始化顺序：prefer-hardware → prefer-software；均失败时由上层回退 `<video>`。
 */
export function useWebCodecsCanvas(): WebCodecsCanvasHandle {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const frameBufferRef = useRef<EncodedFrameData[]>([]);
  const firstKeyFrameRef = useRef(false);
  const hasRenderedFrameRef = useRef(false);
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

    const renderFrame = (videoFrame: VideoFrame) => {
      if (closed) {
        try {
          videoFrame.close();
        } catch {
          /* */
        }
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
        markRendered();
        videoFrame.close();
      } catch {
        try {
          videoFrame.close();
        } catch {
          /* */
        }
      }
    };

    void (async () => {
      try {
        const decoder = new VideoDecoder({
          output: (frame) => renderFrame(frame),
          error: (err) => {
            console.error("[WebCodecs] decode error:", err);
            if (!closed) {
              setWebCodecsActive(false);
              setDecodePath("failed");
            }
          },
        });

        for (const hw of HW_MODES) {
          for (const codec of CODECS) {
            try {
              const ok = await tryConfigureDecoder(decoder, codec, hw);
              if (!ok) continue;
              if (!closed) {
                decoderRef.current = decoder;
                setWebCodecsActive(true);
                setDecodePath(hw === "prefer-hardware" ? "hardware" : "software");
                console.info(`[WebCodecs] decoder ready codec=${codec} acceleration=${hw}`);
              } else {
                decoder.close();
              }
              return;
            } catch {
              continue;
            }
          }
        }
        decoder.close();
        if (!closed) {
          console.warn("[WebCodecs] no supported codec (hardware + software exhausted)");
          setDecodePath("failed");
        }
      } catch {
        if (!closed) setDecodePath("failed");
      }
    })();

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
      hasRenderedFrameRef.current = false;
      setWebCodecsActive(false);
      setHasRenderedFrame(false);
      setDecodePath("pending");
    };
  }, []);

  const addEncodedFrame = useCallback((frame: EncodedFrameData) => {
    const fb = frameBufferRef.current;
    fb.push(frame);

    if (fb.length >= FRAME_BUFFER_SIZE) {
      const oldest = fb.shift()!;
      const decoder = decoderRef.current;
      if (!decoder || decoder.state !== "configured") return;

      if (!firstKeyFrameRef.current && oldest.type !== "key") return;
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
      }
    }
  }, []);

  return {
    addEncodedFrame,
    canvasRef,
    webCodecsActive,
    videoWidth,
    videoHeight,
    decodePath,
    hasRenderedFrame,
  };
}
