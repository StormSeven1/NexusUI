"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { ExternalLink, Maximize2, Minimize2, X } from "lucide-react";
import { useAppConfigStore } from "@/stores/app-config-store";
import { useDzwlAlarmStore } from "@/stores/dzwl-alarm-store";
import { getDzwlAlarmConfig } from "@/lib/map-app-config";

const MIN_WIDTH = 320;
const MIN_HEIGHT = 220;
const INITIAL_WIDTH = 720;
const INITIAL_HEIGHT = 480;
const EDGE_MARGIN = 24;

type ResizeDir = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

type RectState = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function buildInitialRect(): RectState {
  if (typeof window === "undefined") {
    return { left: EDGE_MARGIN, top: EDGE_MARGIN, width: INITIAL_WIDTH, height: INITIAL_HEIGHT };
  }

  return {
    left: EDGE_MARGIN,
    top: Math.max(EDGE_MARGIN, window.innerHeight - INITIAL_HEIGHT - EDGE_MARGIN),
    width: Math.min(INITIAL_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - EDGE_MARGIN * 2)),
    height: Math.min(INITIAL_HEIGHT, Math.max(MIN_HEIGHT, window.innerHeight - EDGE_MARGIN * 2)),
  };
}

type PopupWindowProps = {
  pageUrl: string;
  onClose: () => void;
};

function PopupWindow({ pageUrl, onClose }: PopupWindowProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [iframeError, setIframeError] = useState(false);
  const [rect, setRect] = useState<RectState>(buildInitialRect);
  const savedRectRef = useRef<RectState | null>(null);

  useEffect(() => {
    const handleResize = () => {
      setRect((current) => ({
        left: Math.min(Math.max(0, current.left), Math.max(0, window.innerWidth - MIN_WIDTH)),
        top: Math.min(Math.max(0, current.top), Math.max(0, window.innerHeight - MIN_HEIGHT)),
        width: Math.min(current.width, Math.max(MIN_WIDTH, window.innerWidth)),
        height: Math.min(current.height, Math.max(MIN_HEIGHT, window.innerHeight)),
      }));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const panelStyle = useMemo<CSSProperties>(() => {
    if (isMaximized) {
      return { left: 0, top: 0, width: "100vw", height: "100vh" };
    }

    return {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    };
  }, [isMaximized, rect]);

  const startDrag = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (isMaximized) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-dzwl-action='true']")) return;
    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = rect.left;
    const startTop = rect.top;

    const onMove = (moveEvent: MouseEvent) => {
      setRect((current) => ({
        ...current,
        left: startLeft + (moveEvent.clientX - startX),
        top: startTop + (moveEvent.clientY - startY),
      }));
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const startResize = (dir: ResizeDir, event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = rect;

    const onMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      setRect(() => {
        let nextLeft = startRect.left;
        let nextTop = startRect.top;
        let nextWidth = startRect.width;
        let nextHeight = startRect.height;

        if (dir.includes("e")) nextWidth = Math.max(MIN_WIDTH, startRect.width + dx);
        if (dir.includes("s")) nextHeight = Math.max(MIN_HEIGHT, startRect.height + dy);
        if (dir.includes("w")) {
          nextWidth = Math.max(MIN_WIDTH, startRect.width - dx);
          nextLeft = startRect.left + (startRect.width - nextWidth);
        }
        if (dir.includes("n")) {
          nextHeight = Math.max(MIN_HEIGHT, startRect.height - dy);
          nextTop = startRect.top + (startRect.height - nextHeight);
        }

        return {
          left: nextLeft,
          top: nextTop,
          width: nextWidth,
          height: nextHeight,
        };
      });
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const toggleMaximize = () => {
    if (isMaximized) {
      setIsMaximized(false);
      if (savedRectRef.current) setRect(savedRectRef.current);
      savedRectRef.current = null;
      return;
    }

    savedRectRef.current = rect;
    setIsMaximized(true);
  };

  return (
    <div
      className="fixed z-[99990] overflow-hidden rounded-lg border border-sky-400/70 bg-[#0d1117] shadow-[0_0_0_1px_rgba(64,158,255,0.3),0_8px_32px_rgba(0,0,0,0.7),0_0_20px_rgba(64,158,255,0.15)]"
      style={panelStyle}
    >
      <div
        className={`flex h-9 items-center justify-between border-b border-sky-400/35 bg-gradient-to-r from-[#0d2137] to-[#0d1a2d] px-3 ${
          isMaximized ? "cursor-default" : "cursor-move"
        }`}
        onMouseDown={startDrag}
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-lime-500 shadow-[0_0_6px_#52c41a]" />
          <span className="text-sm font-semibold tracking-[0.08em] text-sky-200">电子战联络</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            data-dzwl-action="true"
            type="button"
            title={isMaximized ? "还原" : "最大化"}
            onClick={toggleMaximize}
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition hover:bg-sky-500/20 hover:text-sky-300"
          >
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <button
            data-dzwl-action="true"
            type="button"
            title="关闭"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition hover:bg-rose-500/20 hover:text-rose-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="relative h-[calc(100%-2.25rem)] bg-black">
        {pageUrl ? (
          <iframe
            src={pageUrl}
            className="h-full w-full border-0 bg-white"
            allow="*"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            onError={() => setIframeError(true)}
          />
        ) : null}

        {(iframeError || !pageUrl) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0d1117] px-6 text-center text-sm text-slate-400">
            <div>{pageUrl ? "页面无法在弹窗中加载" : "未配置 DZWL 页面地址"}</div>
            {pageUrl ? (
              <a
                href={pageUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded border border-sky-400 px-4 py-2 text-xs text-sky-300 transition hover:bg-sky-500/15"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                在新窗口打开
              </a>
            ) : null}
          </div>
        )}
      </div>

      {!isMaximized && (
        <>
          <div className="absolute left-2 right-2 top-0 h-1.5 cursor-n-resize" onMouseDown={(e) => startResize("n", e)} />
          <div className="absolute bottom-0 left-2 right-2 h-1.5 cursor-s-resize" onMouseDown={(e) => startResize("s", e)} />
          <div className="absolute bottom-2 right-0 top-2 w-1.5 cursor-e-resize" onMouseDown={(e) => startResize("e", e)} />
          <div className="absolute bottom-2 left-0 top-2 w-1.5 cursor-w-resize" onMouseDown={(e) => startResize("w", e)} />
          <div className="absolute left-0 top-0 h-3 w-3 cursor-nw-resize" onMouseDown={(e) => startResize("nw", e)} />
          <div className="absolute right-0 top-0 h-3 w-3 cursor-ne-resize" onMouseDown={(e) => startResize("ne", e)} />
          <div className="absolute bottom-0 left-0 h-3 w-3 cursor-sw-resize" onMouseDown={(e) => startResize("sw", e)} />
          <div className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize" onMouseDown={(e) => startResize("se", e)} />
        </>
      )}
    </div>
  );
}

export function DzwlAlarmPopup() {
  const isOpen = useDzwlAlarmStore((s) => s.isOpen);
  const openToken = useDzwlAlarmStore((s) => s.openToken);
  const pageUrl = useDzwlAlarmStore((s) => s.pageUrl);
  const closePopup = useDzwlAlarmStore((s) => s.closePopup);
  const setPageUrl = useDzwlAlarmStore((s) => s.setPageUrl);

  useEffect(() => {
    void useAppConfigStore.getState().ensureLoaded().then(() => {
      const cfg = getDzwlAlarmConfig();
      if (cfg.pageUrl) setPageUrl(cfg.pageUrl);
    });
  }, [setPageUrl]);

  if (typeof window === "undefined" || !isOpen) return null;

  return <PopupWindow key={openToken} pageUrl={pageUrl} onClose={closePopup} />;
}
