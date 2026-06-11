"use client";

/**
 * 检测框覆盖层。
 *
 * 这个组件只负责“把框画出来”，不负责接收框，也不负责同步。
 * 它的输入必须已经是同步完成后的 `EoDetectionBox[]`。
 *
 * 调用关系：
 * - `useEoSyncedDetections` 负责产出统一的 `boxes`
 * - `EoVideoModal` 把 `boxes` 传给本组件
 * - 本组件再把这些框画到视频或 canvas 的上层
 *
 * 这里真正要解决的问题不是“框有没有收到”，而是“框怎么和当前画面区域对齐”：
 * - video / canvas 使用 `object-fill` 按当前窗口完整铺满，不走 cover 裁剪
 * - 因此叠框也使用同一个 fill 矩形，缩放时和视频保持一致
 * - 再把 0..1 相对框映射到实际显示区域
 */

import { useCallback, useEffect, useRef } from "react";
import { getVideoContentRect } from "@/lib/eo-video/videoContentRect";
import type { EoDetectionBox } from "@/lib/eo-video/types";
import { cn } from "@/lib/utils";

const COLORS: Record<NonNullable<EoDetectionBox["colorToken"]>, string> = {
  friendly: "rgba(75,158,255,0.95)",
  hostile: "rgba(239,68,68,0.95)",
  neutral: "rgba(148,163,184,0.95)",
  accent: "rgba(34,211,238,0.95)",
};

export function EoDetectionOverlay({
  containerRef,
  videoRef,
  boxes,
  className,
  videoObjectFit = "fill",
  videoIntrinsicWidth = 0,
  videoIntrinsicHeight = 0,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  boxes: EoDetectionBox[];
  className?: string;
  videoObjectFit?: "contain" | "cover" | "fill";
  videoIntrinsicWidth?: number;
  videoIntrinsicHeight?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const video = videoRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const intrinsicWidth = video?.videoWidth || videoIntrinsicWidth;
    const intrinsicHeight = video?.videoHeight || videoIntrinsicHeight;
    const content = getVideoContentRect(width, height, intrinsicWidth, intrinsicHeight, videoObjectFit);
    for (const box of boxes) {
      const stroke = COLORS[box.colorToken ?? "accent"];
      const x = content.x + box.x * content.w;
      const y = content.y + box.y * content.h;
      const w = box.w * content.w;
      const h = box.h * content.h;
      context.strokeStyle = stroke;
      context.lineWidth = 2;
      context.strokeRect(x, y, w, h);
      if (box.label) {
        context.font = "10px ui-monospace, monospace";
        const textWidth = context.measureText(box.label).width;
        context.fillStyle = "rgba(0, 0, 0, 0.6)";
        context.fillRect(x, Math.max(0, y - 16), textWidth + 8, 14);
        context.fillStyle = stroke;
        context.fillText(box.label, x + 4, Math.max(10, y - 5));
      }
    }
  }, [boxes, containerRef, videoIntrinsicHeight, videoIntrinsicWidth, videoObjectFit, videoRef]);

  useEffect(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container) return;
    const schedule = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        draw();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    video?.addEventListener("loadedmetadata", schedule);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      observer.disconnect();
      video?.removeEventListener("loadedmetadata", schedule);
      window.removeEventListener("resize", schedule);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef, draw, videoRef]);

  useEffect(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      draw();
    });
  }, [boxes, draw]);

  return <canvas ref={canvasRef} className={cn("pointer-events-none absolute inset-0 z-[5]", className)} aria-hidden />;
}
