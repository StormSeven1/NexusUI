"use client";

import { useCallback, useEffect, useRef } from "react";
import type { EoDetectionBox } from "@/lib/eo-video/types";
import { getVideoContentRect } from "@/lib/eo-video/videoContentRect";
import { cn } from "@/lib/utils";

const COLORS: Record<NonNullable<EoDetectionBox["colorToken"]>, string> = {
  friendly: "rgba(75,158,255,0.9)",
  hostile: "rgba(239,68,68,0.9)",
  neutral: "rgba(139,139,146,0.9)",
  accent: "rgba(34,211,238,0.9)",
};

export interface EoDetectionOverlayProps {
  containerRef: React.RefObject<HTMLElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  boxes: EoDetectionBox[];
  selectedBoxId?: string | null;
  onSelectBox?: (boxId: string | null) => void;
  onDoubleClickPoint?: (payload: {
    normalizedX: number;
    normalizedY: number;
    hitBoxId: string | null;
    hitBox: EoDetectionBox | null;
  }) => void;
  className?: string;
  /** 与视频元素/Canvas 的 object-fit 一致，默认 cover */
  videoObjectFit?: "contain" | "cover";
  /** WebCodecs 模式下 video 元素可能无法提供 intrinsic size，用此 fallback */
  videoIntrinsicWidth?: number;
  videoIntrinsicHeight?: number;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** 与 base-vue `drawSingleTargetRect` 一致：主框 + 四角 L 形角标，区别于多目标半透明填充框 */
function drawSingleTrackOverlay(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bw: number,
  bh: number,
  label: string | undefined,
  isSelected: boolean,
) {
  const cornerBase = Math.min(bw, bh) * 0.18;
  const corner = Math.max(8, Math.min(22, Math.min(cornerBase, Math.min(bw, bh) / 2.4)));
  const mainStroke = isSelected ? "rgba(250,204,21,0.98)" : "rgba(147,253,255,0.95)";
  const cornerStroke = isSelected ? "rgba(254,240,138,0.95)" : "rgba(255,255,255,0.92)";
  const mainLw = isSelected ? 3 : 2.25;
  const cornerLw = isSelected ? 2.25 : 1.85;

  ctx.save();
  ctx.lineJoin = "miter";
  ctx.lineCap = "square";

  ctx.fillStyle = isSelected ? "rgba(250,204,21,0.08)" : "rgba(147,253,255,0.07)";
  ctx.fillRect(x, y, bw, bh);

  ctx.strokeStyle = mainStroke;
  ctx.lineWidth = mainLw;
  ctx.strokeRect(x + mainLw / 2, y + mainLw / 2, bw - mainLw, bh - mainLw);

  ctx.strokeStyle = cornerStroke;
  ctx.lineWidth = cornerLw;
  // 左上
  ctx.beginPath();
  ctx.moveTo(x, y + corner);
  ctx.lineTo(x, y);
  ctx.lineTo(x + corner, y);
  ctx.stroke();
  // 右上
  ctx.beginPath();
  ctx.moveTo(x + bw - corner, y);
  ctx.lineTo(x + bw, y);
  ctx.lineTo(x + bw, y + corner);
  ctx.stroke();
  // 左下
  ctx.beginPath();
  ctx.moveTo(x, y + bh - corner);
  ctx.lineTo(x, y + bh);
  ctx.lineTo(x + corner, y + bh);
  ctx.stroke();
  // 右下
  ctx.beginPath();
  ctx.moveTo(x + bw - corner, y + bh);
  ctx.lineTo(x + bw, y + bh);
  ctx.lineTo(x + bw, y + bh - corner);
  ctx.stroke();

  if (label) {
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    const pad = 3;
    ctx.font = "10px ui-monospace, monospace";
    const metrics = ctx.measureText(label);
    ctx.fillRect(x, y - 14, metrics.width + pad * 2, 14);
    ctx.fillStyle = mainStroke;
    ctx.fillText(label, x + pad, y - 4);
  }
  ctx.restore();
}

export function EoDetectionOverlay({
  containerRef,
  videoRef,
  boxes,
  selectedBoxId,
  onSelectBox,
  onDoubleClickPoint,
  className,
  videoObjectFit = "cover",
  videoIntrinsicWidth = 0,
  videoIntrinsicHeight = 0,
}: EoDetectionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const video = videoRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const vw = video?.videoWidth || videoIntrinsicWidth;
    const vh = video?.videoHeight || videoIntrinsicHeight;
    const content = getVideoContentRect(w, h, vw, vh, videoObjectFit);

    for (const b of boxes) {
      const isSelected = b.id === selectedBoxId;
      const x = content.x + b.x * content.w;
      const y = content.y + b.y * content.h;
      const bw = b.w * content.w;
      const bh = b.h * content.h;

      if (b.variant === "singleTrack") {
        drawSingleTrackOverlay(ctx, x, y, bw, bh, b.label, isSelected);
        continue;
      }

      const stroke = isSelected ? "rgba(250,204,21,1)" : COLORS[b.colorToken ?? "accent"];
      ctx.strokeStyle = stroke;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.strokeRect(x, y, bw, bh);
      ctx.fillStyle = isSelected ? "rgba(250,204,21,0.18)" : stroke.replace("0.9", "0.12");
      ctx.fillRect(x, y, bw, bh);
      if (b.label) {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        const pad = 3;
        ctx.font = "10px ui-monospace, monospace";
        const metrics = ctx.measureText(b.label);
        ctx.fillRect(x, y - 14, metrics.width + pad * 2, 14);
        ctx.fillStyle = stroke;
        ctx.fillText(b.label, x + pad, y - 4);
      }
    }
  }, [boxes, containerRef, selectedBoxId, videoObjectFit, videoIntrinsicWidth, videoIntrinsicHeight, videoRef]);

  const schedule = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      draw();
    });
  }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => schedule());
    ro.observe(container);
    const onVideo = () => schedule();
    video?.addEventListener("loadedmetadata", onVideo);
    window.addEventListener("resize", onVideo);
    schedule();

    return () => {
      ro.disconnect();
      video?.removeEventListener("loadedmetadata", onVideo);
      window.removeEventListener("resize", onVideo);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef, schedule, videoRef]);

  useEffect(() => {
    schedule();
  }, [boxes, schedule]);

  const resolveHit = useCallback(
    (
      clientX: number,
      clientY: number,
    ): { normalizedX: number; normalizedY: number; hitBoxId: string | null; hitBox: EoDetectionBox | null } | null => {
      const container = containerRef.current;
      const video = videoRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const vw = video?.videoWidth || videoIntrinsicWidth;
      const vh = video?.videoHeight || videoIntrinsicHeight;
      const content = getVideoContentRect(rect.width, rect.height, vw, vh, videoObjectFit);
      /** 与 draw() 完全一致：在画布像素空间判命中，避免「归一化 + clamp」与视觉框错位 */
      const pad = 10;
      let hitBoxId: string | null = null;
      let hitBox: EoDetectionBox | null = null;
      for (let i = boxes.length - 1; i >= 0; i--) {
        const b = boxes[i]!;
        const bx = content.x + b.x * content.w;
        const by = content.y + b.y * content.h;
        const bw = b.w * content.w;
        const bh = b.h * content.h;
        if (px >= bx - pad && px <= bx + bw + pad && py >= by - pad && py <= by + bh + pad) {
          hitBoxId = b.id;
          hitBox = b;
          break;
        }
      }
      const nx = content.w > 0 ? (px - content.x) / content.w : 0;
      const ny = content.h > 0 ? (py - content.y) / content.h : 0;
      const normalizedX = clamp01(nx);
      const normalizedY = clamp01(ny);
      return { normalizedX, normalizedY, hitBoxId, hitBox };
    },
    [boxes, containerRef, videoRef, videoObjectFit, videoIntrinsicWidth, videoIntrinsicHeight],
  );

  return (
    <canvas
      ref={canvasRef}
      className={cn("absolute inset-0 z-10", className)}
      onClick={(e) => {
        if (!onSelectBox) return;
        const hit = resolveHit(e.clientX, e.clientY);
        onSelectBox(hit?.hitBoxId ?? null);
      }}
      onDoubleClick={(e) => {
        const hit = resolveHit(e.clientX, e.clientY);
        if (!hit) return;
        /** 双击第二次落点常偏出小框，仍应视为对「当前选中框」发任务 */
        let out = hit;
        if (!hit.hitBox && selectedBoxId) {
          const b = boxes.find((x) => x.id === selectedBoxId) ?? null;
          if (b) {
            out = {
              normalizedX: b.x + b.w / 2,
              normalizedY: b.y + b.h / 2,
              hitBoxId: selectedBoxId,
              hitBox: b,
            };
          }
        }
        if (onSelectBox) onSelectBox(out.hitBoxId);
        onDoubleClickPoint?.(out);
      }}
      aria-hidden
    />
  );
}
