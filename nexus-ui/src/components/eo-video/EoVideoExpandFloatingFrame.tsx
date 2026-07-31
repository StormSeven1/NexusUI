"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Rect = { x: number; y: number; w: number; h: number };

const LS_PREFIX = "nexus.eo.expandFrame.";

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function defaultRect(): Rect {
  if (typeof window === "undefined") return { x: 48, y: 80, w: 900, h: 520 };
  const margin = 12;
  const w = clamp(Math.min(900, window.innerWidth - margin * 2), 360, window.innerWidth - margin * 2);
  const h = clamp(Math.min(520, window.innerHeight - margin * 2), 240, window.innerHeight - margin * 2);
  const x = (window.innerWidth - w) / 2;
  const y = (window.innerHeight - h) / 2;
  return { x, y, w, h };
}

function loadRect(key: string): Rect | null {
  try {
    const t = localStorage.getItem(LS_PREFIX + key);
    if (!t) return null;
    const j = JSON.parse(t) as Rect;
    if (
      typeof j.x !== "number" ||
      typeof j.y !== "number" ||
      typeof j.w !== "number" ||
      typeof j.h !== "number"
    )
      return null;
    return j;
  } catch {
    return null;
  }
}

function saveRect(key: string, r: Rect) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(r));
  } catch {
    /* noop */
  }
}

function fitRectToViewport(r: Rect): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;
  const maxW = vw - margin * 2;
  const maxH = vh - margin * 2;
  let w = clamp(r.w, 360, maxW);
  let h = clamp(r.h, 240, maxH);
  let x = clamp(r.x, margin, vw - w - margin);
  let y = clamp(r.y, margin, vh - h - margin);
  return { x, y, w, h };
}

const MIN_W = 360;
const MIN_H = 240;
const EDGE_MARGIN = 8;

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

function resizeRectFromPointer(start: Rect, edge: ResizeEdge, cx: number, cy: number): Rect {
  const m = EDGE_MARGIN;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const startRight = start.x + start.w;
  const startBottom = start.y + start.h;
  let x = start.x;
  let y = start.y;
  let w = start.w;
  let h = start.h;

  const applyN = edge === "n" || edge === "nw" || edge === "ne";
  const applyS = edge === "s" || edge === "sw" || edge === "se";
  const applyW = edge === "w" || edge === "nw" || edge === "sw";
  const applyE = edge === "e" || edge === "ne" || edge === "se";

  if (applyE) {
    w = clamp(cx - x, MIN_W, vw - x - m);
  }
  if (applyS) {
    h = clamp(cy - y, MIN_H, vh - y - m);
  }
  if (applyW) {
    const nx = clamp(cx, m, startRight - MIN_W);
    w = startRight - nx;
    x = nx;
  }
  if (applyN) {
    const ny = clamp(cy, m, startBottom - MIN_H);
    h = startBottom - ny;
    y = ny;
  }

  return fitRectToViewport({ x, y, w, h });
}

let zOrderSeed = 1450;

/**
 * 放大浮层几何：供同一 `EoVideoPanel` 本体 `position:fixed` 复用小窗 WebRTC，避免再挂第二路面板。
 */
export function useEoVideoExpandFrame(persistKey: string, open: boolean) {
  const [rect, setRect] = useState<Rect>(defaultRect);
  const [z, setZ] = useState(1450);
  const rectRef = useRef(rect);
  rectRef.current = rect;

  const bumpZ = useCallback(() => {
    zOrderSeed += 1;
    setZ(zOrderSeed);
  }, []);

  useEffect(() => {
    if (!open) return;
    const saved = loadRect(persistKey);
    setRect(fitRectToViewport(saved ?? defaultRect()));
    bumpZ();
  }, [open, persistKey, bumpZ]);

  useEffect(() => {
    if (!open) return;
    const onWin = () => setRect((r) => fitRectToViewport(r));
    window.addEventListener("resize", onWin);
    return () => window.removeEventListener("resize", onWin);
  }, [open]);

  const persistNow = useCallback(() => {
    saveRect(persistKey, fitRectToViewport(rectRef.current));
  }, [persistKey]);

  const startDragMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      bumpZ();
      const start = { ...rectRef.current };
      const ox = e.clientX - start.x;
      const oy = e.clientY - start.y;
      const target = e.currentTarget;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      const onMove = (ev: PointerEvent) => {
        const nx = ev.clientX - ox;
        const ny = ev.clientY - oy;
        const next = fitRectToViewport({ ...start, x: nx, y: ny });
        rectRef.current = next;
        setRect(next);
      };
      const onUp = () => {
        try {
          target.releasePointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        persistNow();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      e.preventDefault();
    },
    [bumpZ, persistNow],
  );

  const startResize = useCallback(
    (edge: ResizeEdge) => (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      bumpZ();
      const start = { ...rectRef.current };
      const target = e.currentTarget;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      const onMove = (ev: PointerEvent) => {
        const next = resizeRectFromPointer(start, edge, ev.clientX, ev.clientY);
        rectRef.current = next;
        setRect(next);
      };
      const onUp = () => {
        try {
          target.releasePointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        persistNow();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      e.preventDefault();
    },
    [bumpZ, persistNow],
  );

  return { rect, z, bumpZ, startDragMove, startResize };
}

export interface EoVideoExpandFloatingChromeProps {
  title?: string;
  onClose: () => void;
  startDragMove: (e: React.PointerEvent) => void;
  startResize: (edge: ResizeEdge) => (e: React.PointerEvent) => void;
  /** 默认 true：标题栏 + 拉伸条；`handlesOnly` 仅拉伸条 */
  mode?: "full" | "handlesOnly" | "headerOnly";
}

/** 放大浮层标题栏 + 边角拉伸（叠在同一面板根节点上） */
export function EoVideoExpandFloatingChrome({
  title = "光电",
  onClose,
  startDragMove,
  startResize,
  mode = "full",
}: EoVideoExpandFloatingChromeProps) {
  const showHeader = mode === "full" || mode === "headerOnly";
  const showHandles = mode === "full" || mode === "handlesOnly";
  return (
    <>
      {showHeader ? (
        <header
          className="flex h-9 shrink-0 cursor-grab select-none items-center justify-between gap-2 border-b border-white/12 bg-zinc-900/95 px-2 active:cursor-grabbing"
          onPointerDown={startDragMove}
        >
          <span className="min-w-0 truncate text-xs font-medium text-white/90">{title}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-white/80 hover:bg-white/10 hover:text-white"
            title="关闭"
            aria-label="关闭放大窗口"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <X className="size-3.5" />
          </Button>
        </header>
      ) : null}
      {showHandles ? (
        <>
          <div
            role="presentation"
            className="absolute left-0 top-9 bottom-12 z-10 w-3 cursor-ew-resize hover:bg-white/[0.06]"
            onPointerDown={startResize("w")}
            aria-hidden
          />
          <div
            role="presentation"
            className="absolute right-0 top-9 bottom-12 z-10 w-3 cursor-ew-resize hover:bg-white/[0.06]"
            onPointerDown={startResize("e")}
            aria-hidden
          />
          <div
            role="presentation"
            className="absolute bottom-0 left-12 right-12 z-10 h-3 cursor-ns-resize hover:bg-white/[0.06]"
            onPointerDown={startResize("s")}
            aria-hidden
          />
          <div
            role="presentation"
            className="absolute left-0 top-9 z-10 h-12 w-12 cursor-[nw-resize] hover:bg-white/[0.06]"
            onPointerDown={startResize("nw")}
            aria-hidden
          />
          <div
            role="presentation"
            className="absolute right-0 top-9 z-10 h-12 w-12 cursor-[ne-resize] hover:bg-white/[0.06]"
            onPointerDown={startResize("ne")}
            aria-hidden
          />
          <div
            role="presentation"
            className="absolute bottom-0 left-0 z-20 h-12 w-12 cursor-[sw-resize] hover:bg-white/[0.08]"
            onPointerDown={startResize("sw")}
            aria-hidden
          />
          <div
            role="presentation"
            className="absolute bottom-0 right-0 z-20 h-12 w-12 cursor-[se-resize] hover:bg-white/[0.08]"
            onPointerDown={startResize("se")}
            aria-hidden
          />
          <div
            role="presentation"
            className="absolute left-12 right-12 top-9 z-10 h-2 cursor-ns-resize hover:bg-white/[0.06]"
            onPointerDown={startResize("n")}
            aria-hidden
          />
        </>
      ) : null}
    </>
  );
}

export interface EoVideoExpandFloatingFrameProps {
  open: boolean;
  onClose: () => void;
  /** 与 dock `streamPersistKey` 对齐，用于记忆位置/尺寸及「每 dock 单窗」 */
  persistKey: string;
  title?: string;
  children: React.ReactNode;
}

/**
 * @deprecated 放大应复用小窗同一 `EoVideoPanel`（见 `useEoVideoExpandFrame`），勿再嵌套第二路面板。
 * 保留给仍传 children 的旧调用；新逻辑请用 hook + chrome。
 */
export function EoVideoExpandFloatingFrame({
  open,
  onClose,
  persistKey,
  title = "光电",
  children,
}: EoVideoExpandFloatingFrameProps) {
  const { rect, z, bumpZ, startDragMove, startResize } = useEoVideoExpandFrame(persistKey, open);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-label={title}
      className={cn(
        "fixed flex flex-col overflow-hidden rounded-lg border border-white/25 bg-black shadow-2xl ring-1 ring-black/40",
      )}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: z }}
      onPointerDown={bumpZ}
    >
      <EoVideoExpandFloatingChrome
        title={title}
        onClose={onClose}
        startDragMove={startDragMove}
        startResize={startResize}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>,
    document.body,
  );
}
