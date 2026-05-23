"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { canonicalEntityId } from "@/lib/camera-entity-id";
import type { EoDetectionBox } from "@/lib/eo-video/types";
import { mergeSingleTrackTelemetry } from "@/lib/eo-video/mergeSingleTrackTelemetry";
import { getVideoContentRect } from "@/lib/eo-video/videoContentRect";
import { useEoCameraDdsStatusStore } from "@/stores/eo-camera-dds-status-store";
import { useTrackStore } from "@/stores/track-store";
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
  /** 检测 WebSocket 用的实体 id（与 `useEoEntityDetection` 的 entityId 一致） */
  detectionEntityId?: string;
  /** DDS 相机行实体 id，可与 detectionEntityId 不同 */
  ddsCameraEntityId?: string;
  /** 与面板「放大窗口」一致：单目标标牌显示四行航迹信息（与 Qt 放大画面行为对齐） */
  expandedMode?: boolean;
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

/**
 * 与 Qt `OpenGLWidget::DrawCircleTag` 相仿：圆内类型字仅「海」「空」+ 右侧标题条。
 * 圆竖直中轴线过检测框左上角 `(boxTLX, boxTLY)`（与 Qt `tagPosition(show_rect.x()-15, show_rect.y()-30)` + tagSize=30 时圆心 x=框左 一致）。
 */
function drawSingleTrackTagCluster(
  ctx: CanvasRenderingContext2D,
  boxTLX: number,
  boxTLY: number,
  typeChar: string,
  /** 与右下角 DDS 同源；`null` 不画标题条 */
  titleText: string | null,
  isSelected: boolean,
  opts: { expandedMode: boolean; detail?: EoDetectionBox["singleTrackDetail"] },
) {
  const tagSize = 24;
  /** 圆竖直径下端落在检测框上沿 boxTLY（与 Qt：圆底 = 框顶）。标题条底边与框顶对齐。 */
  const cy = boxTLY - tagSize / 2;
  const cx = boxTLX;
  const r = tagSize / 2;

  const chRaw = typeChar.trim().slice(0, 1) || "海";
  const ch = chRaw === "空" ? "空" : "海";
  const sea = ch === "海";
  const circleBg = sea ? "#2A3140" : "#FAF0E6";
  const borderMain = isSelected ? "rgba(250,204,21,0.98)" : sea ? "rgba(177,250,255,0.95)" : "rgba(147,253,255,0.95)";
  const circleFg = sea ? "rgba(177,250,255,0.98)" : "rgba(37,99,235,0.95)";

  ctx.save();
  ctx.lineJoin = "miter";
  ctx.lineCap = "round";

  const barH = Math.max(18, Math.floor((tagSize * 2) / 3));
  /** 标题条左缘与检测框左缘对齐；下缘与检测框上沿重合 */
  const barX = boxTLX;
  const barY = boxTLY - barH;
  const showTitleBar = titleText != null && titleText.trim() !== "";
  const showDetail = opts.expandedMode || isSelected;
  const d = opts.detail;
  const aziLine =
    d?.azimuthDeg != null && Number.isFinite(d.azimuthDeg) ? `AZI ${d.azimuthDeg.toFixed(1)}°` : "AZI —";
  const disLine =
    d?.distanceM != null && Number.isFinite(d.distanceM)
      ? `DIS ${(d.distanceM / 1852).toFixed(1)}NM`
      : "DIS —";
  const spdLine =
    d?.speedMps != null && Number.isFinite(d.speedMps) ? `SPD ${d.speedMps.toFixed(1)}m/s` : "SPD —";
  const cogLine =
    d?.courseDeg != null && Number.isFinite(d.courseDeg) ? `COG ${d.courseDeg.toFixed(1)}°` : "COG —";
  const detailLines = [aziLine, disLine, spdLine, cogLine];

  const titleFont = "11px ui-sans-serif, system-ui, sans-serif";
  /** 四行航迹：较小字号；左/上下留白略大于行距，避免挤在一起 */
  const detailFont = "9px ui-sans-serif, system-ui, sans-serif";
  const detailPadLeft = 8;
  const detailPadRight = 6;
  const detailPadTop = 5;
  const detailPadBottom = 5;
  const detailLineHeight = 13;

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const maxBarW = 240;
  let barW = 72;
  let text = "";
  if (showTitleBar) {
    ctx.font = titleFont;
    text = titleText!.trim();
    let tw = ctx.measureText(text).width + 10;
    while (tw > maxBarW && text.length > 2) {
      text = `${text.slice(0, -2)}…`;
      tw = ctx.measureText(text).width + 10;
    }
    barW = Math.max(72, Math.min(maxBarW, tw));
  }
  if (showDetail) {
    ctx.font = detailFont;
    let mw = 0;
    for (const ln of detailLines) {
      mw = Math.max(mw, ctx.measureText(ln).width);
    }
    barW = Math.max(barW, Math.min(maxBarW, mw + detailPadLeft + detailPadRight));
  }

  if (showDetail) {
    const detailH = detailPadTop + detailPadBottom + detailLineHeight * 4;
    const detailY = barY - detailH;
    ctx.fillStyle = "rgba(22, 27, 34, 0.5)";
    ctx.fillRect(barX, detailY, barW, detailH);
    ctx.strokeStyle = borderMain;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, detailY, barW, detailH);
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.font = detailFont;
    ctx.textBaseline = "middle";
    for (let i = 0; i < detailLines.length; i++) {
      const line = detailLines[i]!;
      const ty = detailY + detailPadTop + detailLineHeight * i + detailLineHeight / 2;
      ctx.fillText(line, barX + detailPadLeft, ty);
    }
  }

  if (showTitleBar) {
    ctx.font = titleFont;
    ctx.fillStyle = isSelected ? "rgba(250,204,21,0.42)" : sea ? "rgba(177,250,255,0.88)" : "rgba(147,253,255,0.78)";
    ctx.fillRect(barX, barY, barW, barH);
    ctx.strokeStyle = borderMain;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);
    ctx.fillStyle = sea ? "#0f172a" : "#1e293b";
    ctx.fillText(text, barX + 5, barY + barH / 2);
  }

  /** 圆与字后画，保证叠在标题条之上（抗锯齿边缘也不挡圆） */
  ctx.beginPath();
  ctx.lineWidth = 2;
  ctx.strokeStyle = borderMain;
  ctx.fillStyle = circleBg;
  ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.font = "bold 13px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = circleFg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(ch, cx, cy + 0.5);

  ctx.restore();
}

/** 与 base-vue `drawSingleTargetRect` 一致：主框 + 四角 L 形角标，左上角 DrawCircleTag 式标签 */
function drawSingleTrackOverlay(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bw: number,
  bh: number,
  box: EoDetectionBox,
  isSelected: boolean,
  expandedMode: boolean,
  mergedDetail: EoDetectionBox["singleTrackDetail"],
) {
  const cornerBase = Math.min(bw, bh) * 0.18;
  const corner = Math.max(8, Math.min(22, Math.min(cornerBase, Math.min(bw, bh) / 2.4)));
  const mainStroke = isSelected ? "rgba(250,204,21,0.98)" : "rgba(147,253,255,0.95)";
  const cornerStroke = isSelected ? "rgba(254,240,138,0.95)" : "rgba(255,255,255,0.92)";
  const mainLw = isSelected ? 2 : 1.4;
  const cornerLw = isSelected ? 1.6 : 1.2;

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
  ctx.beginPath();
  ctx.moveTo(x, y + corner);
  ctx.lineTo(x, y);
  ctx.lineTo(x + corner, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + bw - corner, y);
  ctx.lineTo(x + bw, y);
  ctx.lineTo(x + bw, y + corner);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y + bh - corner);
  ctx.lineTo(x, y + bh);
  ctx.lineTo(x + corner, y + bh);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + bw - corner, y + bh);
  ctx.lineTo(x + bw, y + bh);
  ctx.lineTo(x + bw, y + bh - corner);
  ctx.stroke();

  const typeChar = (box.singleTagShort ?? "海").slice(0, 1);
  const title = box.singleTrackOverlayTitle ?? null;
  drawSingleTrackTagCluster(ctx, x, y, typeChar, title, isSelected, {
    expandedMode,
    detail: mergedDetail,
  });
  ctx.restore();
}

export function EoDetectionOverlay({
  containerRef,
  videoRef,
  boxes,
  detectionEntityId,
  ddsCameraEntityId,
  expandedMode = false,
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

  const ddsLookupKey = useMemo(() => {
    const raw = (ddsCameraEntityId ?? detectionEntityId ?? "").trim();
    if (!raw) return "";
    return canonicalEntityId(raw) || raw;
  }, [ddsCameraEntityId, detectionEntityId]);

  const ddsRow = useEoCameraDdsStatusStore((s) => (ddsLookupKey ? s.byEntityId[ddsLookupKey] : undefined));
  const tracks = useTrackStore((s) => s.tracks);

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
        const mergedDetail = mergeSingleTrackTelemetry(b, ddsRow, tracks);
        drawSingleTrackOverlay(ctx, x, y, bw, bh, b, isSelected, expandedMode, mergedDetail);
        continue;
      }

      const stroke = isSelected ? "rgba(250,204,21,1)" : COLORS[b.colorToken ?? "accent"];
      ctx.strokeStyle = stroke;
      ctx.lineWidth = isSelected ? 1.8 : 1.1;
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
  }, [
    boxes,
    containerRef,
    ddsRow,
    expandedMode,
    selectedBoxId,
    tracks,
    videoObjectFit,
    videoIntrinsicWidth,
    videoIntrinsicHeight,
    videoRef,
  ]);

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
  }, [boxes, ddsRow, schedule, tracks]);

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
