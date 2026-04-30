"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EncodedFrameData } from "@/lib/eo-video/eoWebrtcEncodedSync";

const FRAME_BUFFER_SIZE = 16;

const CODECS = [
  "avc1.640028",
  "avc1.42001e",
  "avc1.42e01e",
  "avc1.42001f",
];

export interface WebCodecsCanvasHandle {
  addEncodedFrame: (frame: EncodedFrameData) => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  webCodecsActive: boolean;
  videoWidth: number;
  videoHeight: number;
}

/**
 * WebCodecs + Canvas 视频解码渲染 hook。
 * 与 Vue videoPlayer.js 对齐：编码帧存入 frameBuffer（16帧），
 * 满时 shift 最老帧进 VideoDecoder.decode()，解码输出直接画 Canvas。
 * 检测框由 EoDetectionOverlay 统一绘制（支持点击/双击交互）。
 */
export function useWebCodecsCanvas(): WebCodecsCanvasHandle {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const frameBufferRef = useRef<EncodedFrameData[]>([]);
  const firstKeyFrameRef = useRef(false);
  const [webCodecsActive, setWebCodecsActive] = useState(false);
  const [videoWidth, setVideoWidth] = useState(0);
  const [videoHeight, setVideoHeight] = useState(0);

  const stableRefs = useRef({ canvasRef, setVideoWidth, setVideoHeight });

  useEffect(() => {
    if (typeof window === "undefined" || !window.VideoDecoder || !window.EncodedVideoChunk) {
      return;
    }

    let closed = false;

    const renderFrame = (videoFrame: VideoFrame) => {
      if (closed) { try { videoFrame.close(); } catch { /* */ } return; }
      const refs = stableRefs.current;
      try {
        const canvas = refs.canvasRef.current;
        if (!canvas) { videoFrame.close(); return; }
        const ctx = canvas.getContext("2d");
        if (!ctx) { videoFrame.close(); return; }

        const fw = videoFrame.displayWidth || videoFrame.codedWidth;
        const fh = videoFrame.displayHeight || videoFrame.codedHeight;
        if (fw <= 0 || fh <= 0) { videoFrame.close(); return; }

        if (canvas.width !== fw || canvas.height !== fh) {
          canvas.width = fw;
          canvas.height = fh;
          refs.setVideoWidth(fw);
          refs.setVideoHeight(fh);
        }

        ctx.clearRect(0, 0, fw, fh);
        ctx.drawImage(videoFrame, 0, 0, fw, fh);
        videoFrame.close();
      } catch {
        try { videoFrame.close(); } catch { /* */ }
      }
    };

    void (async () => {
      try {
        const decoder = new VideoDecoder({
          output: (frame) => renderFrame(frame),
          error: (err) => { console.error("[WebCodecs] decode error:", err); },
        });

        for (const codec of CODECS) {
          try {
            const config: VideoDecoderConfig = {
              codec,
              hardwareAcceleration: "prefer-hardware",
              optimizeForLatency: true,
            };
            if (VideoDecoder.isConfigSupported) {
              const support = await VideoDecoder.isConfigSupported(config);
              if (!support.supported) continue;
            }
            decoder.configure(config);
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
      } catch {
        /* WebCodecs not available */
      }
    })();

    return () => {
      closed = true;
      const d = decoderRef.current;
      decoderRef.current = null;
      if (d && d.state !== "closed") {
        try { d.close(); } catch { /* */ }
      }
      frameBufferRef.current = [];
      firstKeyFrameRef.current = false;
      setWebCodecsActive(false);
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
  };
}
