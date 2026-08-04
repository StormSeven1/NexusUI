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
/** 边框热区宽度（px），略宽以便 hover 易触发 */
const EDGE_HIT_PX = 6;

/** 仅四边拉伸（不用四角），hover 显示系统箭头光标 */
type ResizeEdge = "n" | "s" | "e" | "w";

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

  if (edge === "e") {
    w = clamp(cx - x, MIN_W, vw - x - m);
  } else if (edge === "s") {
    h = clamp(cy - y, MIN_H, vh - y - m);
  } else if (edge === "w") {
    const nx = clamp(cx, m, startRight - MIN_W);
    w = startRight - nx;
    x = nx;
  } else if (edge === "n") {
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

/** 四边拉伸条：全长覆盖、高 z-index，避免被视频/工具栏挡住（相机/无人机一致） */
function EdgeResizeHandle({
  edge,
  onPointerDown,
}: {
  edge: ResizeEdge;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const hit = EDGE_HIT_PX;
  const base =
    "pointer-events-auto absolute z-[60] touch-none transition-colors hover:bg-sky-400/25 active:bg-sky-400/35";
  const byEdge: Record<ResizeEdge, string> = {
    n: cn(base, "cursor-ns-resize left-0 right-0 top-0"),
    s: cn(base, "cursor-ns-resize bottom-0 left-0 right-0"),
    e: cn(base, "cursor-ew-resize right-0 top-0 bottom-0"),
    w: cn(base, "cursor-ew-resize left-0 top-0 bottom-0"),
  };
  const style: React.CSSProperties =
    edge === "n" || edge === "s"
      ? { height: hit }
      : { width: hit };
  const label =
    edge === "n" ? "上边调整高度" : edge === "s" ? "下边调整高度" : edge === "e" ? "右边调整宽度" : "左边调整宽度";
  return (
    <div
      role="separator"
      aria-orientation={edge === "n" || edge === "s" ? "horizontal" : "vertical"}
      aria-label={label}
      title={label}
      className={byEdge[edge]}
      style={style}
      onPointerDown={onPointerDown}
    />
  );
}

/** 放大浮层标题栏 + 四边拉伸（叠在同一面板根节点上） */
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
          className="relative z-[40] flex h-9 shrink-0 cursor-grab select-none items-center justify-between gap-2 border-b border-white/12 bg-zinc-900/95 px-2 active:cursor-grabbing"
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
          {/* 四边贴窗口外缘；上边在标题栏顶沿（不是标题下），与系统窗口一致 */}
          <EdgeResizeHandle edge="n" onPointerDown={startResize("n")} />
          <EdgeResizeHandle edge="s" onPointerDown={startResize("s")} />
          <EdgeResizeHandle edge="e" onPointerDown={startResize("e")} />
          <EdgeResizeHandle edge="w" onPointerDown={startResize("w")} />
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
        mode="headerOnly"
      />
      <div className="relative z-0 min-h-0 flex-1 overflow-hidden">{children}</div>
      {/* 拉伸条放在内容之后，保证相机/无人机模式下热区都不被视频盖住 */}
      <EoVideoExpandFloatingChrome
        title={title}
        onClose={onClose}
        startDragMove={startDragMove}
        startResize={startResize}
        mode="handlesOnly"
      />
    </div>,
    document.body,
  );
}
