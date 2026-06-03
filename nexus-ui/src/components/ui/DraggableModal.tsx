"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type ElementType,
} from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export interface DraggableModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: ElementType;
  size?: "small" | "medium" | "large" | "auto";
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  initialX?: number;
  initialY?: number;
  maxHeight?: number;
  headerActions?: ReactNode;
  minWidth?: number;
  minHeight?: number;
}

type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const SIZE_CONFIG = {
  small:  { width: 320, maxHeight: 500 },
  medium: { width: 380, maxHeight: 600 },
  large:  { width: 460, maxHeight: 700 },
  auto:   { width: 600, height: 500 },
};

const VIEWPORT_MARGIN = 8;

const UNIFIED_STYLES = {
  titlePadding:   "px-4 py-3",
  contentPadding: "px-4 py-3.5",
  footerPadding:  "px-4 py-3",
  iconSize: 16,
  closeSize: 16,
} as const;

export function DraggableModal({
  open,
  onClose,
  title,
  icon: Icon,
  size = "small",
  children,
  footer,
  className,
  headerClassName,
  contentClassName,
  initialX,
  initialY,
  maxHeight,
  headerActions,
  minWidth = 180,
  minHeight = 120,
}: DraggableModalProps) {
  const config = SIZE_CONFIG[size];
  const [position, setPosition] = useState(() => {
    if (typeof window === "undefined") return { x: initialX ?? 20, y: initialY ?? 20 };
    return {
      x: initialX ?? Math.max(20, Math.round((window.innerWidth - 380) / 2)),
      y: initialY ?? Math.max(20, Math.round((window.innerHeight - 260) / 2)),
    };
  });
  /** 首次定位完成前隐藏，避免在 (0,0) 处闪烁 */
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isResizing, setIsResizing] = useState(false);
  const [modalSize, setModalSize] = useState(() => {
    if (size === "auto") {
      const c = config as { width: number; height: number };
      return { width: c.width, height: c.height };
    }
    const c = config as { width: number; maxHeight: number };
    return { width: c.width, height: maxHeight ?? c.maxHeight };
  });

  const dialogRef = useRef<HTMLDivElement>(null);
  const resizeStartPosRef      = useRef({ x: 0, y: 0 });
  const resizeStartSizeRef     = useRef({ width: 0, height: 0 });
  const resizeStartPositionRef = useRef({ x: 0, y: 0 });
  const [resizeDirection, setResizeDirection] = useState<ResizeDirection | null>(null);

  /** 同步（useLayoutEffect）定位，paint 前完成，彻底消除闪烁 */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest(".drag-handle")) {
        setIsDragging(true);
        setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
      }
    },
    [position],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDragging) {
        const newX = e.clientX - dragOffset.x;
        const newY = e.clientY - dragOffset.y;
        setPosition({
          x: Math.max(-modalSize.width + 50, Math.min(newX, window.innerWidth - 50)),
          y: Math.max(0, Math.min(newY, window.innerHeight - 50)),
        });
      } else if (isResizing && resizeDirection) {
        const dX = e.clientX - resizeStartPosRef.current.x;
        const dY = e.clientY - resizeStartPosRef.current.y;
        let nW = resizeStartSizeRef.current.width;
        let nH = resizeStartSizeRef.current.height;
        let nX = resizeStartPositionRef.current.x;
        let nY = resizeStartPositionRef.current.y;

        if (resizeDirection.includes("e")) nW = Math.max(minWidth, nW + dX);
        if (resizeDirection.includes("w")) {
          nW = Math.max(minWidth, resizeStartSizeRef.current.width - dX);
          nX = resizeStartPositionRef.current.x + (resizeStartSizeRef.current.width - nW);
        }
        if (resizeDirection.includes("s")) nH = Math.max(minHeight, nH + dY);
        if (resizeDirection.includes("n")) {
          nH = Math.max(minHeight, resizeStartSizeRef.current.height - dY);
          nY = resizeStartPositionRef.current.y + (resizeStartSizeRef.current.height - nH);
        }
        if (resizeDirection.includes("e")) {
          nW = Math.min(nW, Math.max(minWidth, window.innerWidth - resizeStartPositionRef.current.x - VIEWPORT_MARGIN));
        }
        if (resizeDirection.includes("s")) {
          nH = Math.min(nH, Math.max(minHeight, window.innerHeight - resizeStartPositionRef.current.y - VIEWPORT_MARGIN));
        }
        if (resizeDirection.includes("w")) {
          const right = resizeStartPositionRef.current.x + resizeStartSizeRef.current.width;
          nW = Math.min(nW, Math.max(minWidth, right - VIEWPORT_MARGIN));
          nX = Math.max(VIEWPORT_MARGIN, right - nW);
        }
        if (resizeDirection.includes("n")) {
          const bottom = resizeStartPositionRef.current.y + resizeStartSizeRef.current.height;
          nH = Math.min(nH, Math.max(minHeight, bottom - VIEWPORT_MARGIN));
          nY = Math.max(VIEWPORT_MARGIN, bottom - nH);
        }
        setModalSize({ width: nW, height: nH });
        setPosition({ x: nX, y: nY });
      }
    },
    [isDragging, isResizing, resizeDirection, dragOffset, modalSize.width, minWidth, minHeight],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
    setResizeDirection(null);
  }, []);

  const handleResizeStart = useCallback(
    (dir: ResizeDirection) => (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setIsResizing(true);
      setResizeDirection(dir);
      resizeStartPosRef.current      = { x: e.clientX, y: e.clientY };
      resizeStartSizeRef.current     = { width: modalSize.width, height: modalSize.height };
      resizeStartPositionRef.current = { x: position.x, y: position.y };
    },
    [modalSize.width, modalSize.height, position.x, position.y],
  );

  useEffect(() => {
    if (isDragging || isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  if (!open) return null;

  const isResizable = size === "auto";
  const effectiveMaxHeight =
    maxHeight ?? (isResizable ? modalSize.height : (config as { width: number; maxHeight: number }).maxHeight);

  return (
    <div
      ref={dialogRef}
      className={cn(
        "fixed z-50 flex flex-col rounded-lg border border-nexus-border shadow-xl",
        isResizing && "select-none",
        className,
      )}
      style={{
        left:       `${position.x}px`,
        top:        `${position.y}px`,
        width:      `${modalSize.width}px`,
        height:     size === "auto" ? `${modalSize.height}px` : "auto",
        backgroundColor: "#212126",
      }}
      onMouseDown={handleMouseDown}
    >
      {/* 标题栏（拖拽区域） */}
      <div
        className={cn(
          "drag-handle flex items-center justify-between border-b border-nexus-border select-none",
          UNIFIED_STYLES.titlePadding,
          headerClassName,
        )}
        style={{ cursor: isDragging ? "grabbing" : "move" }}
      >
        <div className="flex items-center gap-2">
          {Icon && <Icon size={UNIFIED_STYLES.iconSize} className="text-nexus-accent shrink-0" />}
          <h3 className="text-sm font-semibold text-nexus-text-primary">{title}</h3>
        </div>
        <div className="flex items-center gap-1">
          {headerActions}
          <button
            onClick={onClose}
            className="rounded p-1 text-nexus-text-muted hover:bg-nexus-bg-hover hover:text-nexus-text-primary transition-colors"
            aria-label="关闭"
          >
            <X size={UNIFIED_STYLES.closeSize} />
          </button>
        </div>
      </div>

      {/* 内容区域 */}
      <div
        className={cn("min-h-0 flex-1 overflow-y-auto", UNIFIED_STYLES.contentPadding, contentClassName)}
        style={size === "auto" ? undefined : { maxHeight: effectiveMaxHeight }}
      >
        {children}
      </div>

      {/* 底部区域 */}
      {footer && (
        <div
          className={cn(
            "flex items-center justify-between border-t border-nexus-border",
            UNIFIED_STYLES.footerPadding,
          )}
        >
          {footer}
        </div>
      )}

      {/* resize 手柄（仅 auto 模式） */}
      {isResizable && (
        <>
          <div className="absolute top-0 left-0 right-0 h-1 cursor-n-resize hover:bg-nexus-accent/20" onMouseDown={handleResizeStart("n")} />
          <div className="absolute bottom-0 left-0 right-0 h-1 cursor-s-resize hover:bg-nexus-accent/20" onMouseDown={handleResizeStart("s")} />
          <div className="absolute top-0 right-0 bottom-0 w-1 cursor-e-resize hover:bg-nexus-accent/20" onMouseDown={handleResizeStart("e")} />
          <div className="absolute top-0 left-0 bottom-0 w-1 cursor-w-resize hover:bg-nexus-accent/20" onMouseDown={handleResizeStart("w")} />
          <div className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize hover:bg-nexus-accent/30" onMouseDown={handleResizeStart("ne")} />
          <div className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize hover:bg-nexus-accent/30" onMouseDown={handleResizeStart("nw")} />
          <div className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize hover:bg-nexus-accent/30" onMouseDown={handleResizeStart("se")} />
          <div className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize hover:bg-nexus-accent/30" onMouseDown={handleResizeStart("sw")} />
        </>
      )}
    </div>
  );
}
