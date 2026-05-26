import { MIN_WINDOW_SIZE } from "@/components/dock/types";

export type DockPopupResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export type DockPopupRect = { x: number; y: number; width: number; height: number };

const VIEWPORT_MARGIN = 8;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function fitDockPopupRectToViewport(rect: DockPopupRect): DockPopupRect {
  if (typeof window === "undefined") return rect;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxW = vw - VIEWPORT_MARGIN * 2;
  const maxH = vh - VIEWPORT_MARGIN * 2;
  const width = clamp(rect.width, MIN_WINDOW_SIZE.width, maxW);
  const height = clamp(rect.height, MIN_WINDOW_SIZE.height, maxH);
  const x = clamp(rect.x, VIEWPORT_MARGIN, vw - width - VIEWPORT_MARGIN);
  const y = clamp(rect.y, VIEWPORT_MARGIN, vh - height - VIEWPORT_MARGIN);
  return { x, y, width, height };
}

/** 根据指针位置与起始矩形，计算 popup 窗口新位置与尺寸 */
export function resizeDockPopupRect(
  start: DockPopupRect,
  edge: DockPopupResizeEdge,
  clientX: number,
  clientY: number,
): DockPopupRect {
  const minW = MIN_WINDOW_SIZE.width;
  const minH = MIN_WINDOW_SIZE.height;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1920;
  const vh = typeof window !== "undefined" ? window.innerHeight : 1080;
  const m = VIEWPORT_MARGIN;

  const startRight = start.x + start.width;
  const startBottom = start.y + start.height;
  let x = start.x;
  let y = start.y;
  let width = start.width;
  let height = start.height;

  const applyN = edge === "n" || edge === "nw" || edge === "ne";
  const applyS = edge === "s" || edge === "sw" || edge === "se";
  const applyW = edge === "w" || edge === "nw" || edge === "sw";
  const applyE = edge === "e" || edge === "ne" || edge === "se";

  if (applyE) {
    width = clamp(clientX - x, minW, vw - x - m);
  }
  if (applyS) {
    height = clamp(clientY - y, minH, vh - y - m);
  }
  if (applyW) {
    const nx = clamp(clientX, m, startRight - minW);
    width = startRight - nx;
    x = nx;
  }
  if (applyN) {
    const ny = clamp(clientY, m, startBottom - minH);
    height = startBottom - ny;
    y = ny;
  }

  return fitDockPopupRectToViewport({ x, y, width, height });
}

export const DOCK_POPUP_RESIZE_HANDLE_CLASS =
  "absolute z-[60] touch-none hover:bg-cyan-400/10";

export const DOCK_POPUP_RESIZE_EDGE_HIT = {
  n: "left-3 right-3 top-0 h-2 cursor-ns-resize",
  s: "left-3 right-3 bottom-0 h-3 cursor-ns-resize",
  e: "right-0 top-10 bottom-10 w-3 cursor-ew-resize",
  w: "left-0 top-10 bottom-10 w-3 cursor-ew-resize",
  nw: "left-0 top-0 h-4 w-4 cursor-nw-resize",
  ne: "right-0 top-0 h-4 w-4 cursor-ne-resize",
  sw: "left-0 bottom-0 h-5 w-5 cursor-sw-resize",
  se: "right-0 bottom-0 h-5 w-5 cursor-se-resize",
} as const satisfies Record<DockPopupResizeEdge, string>;
