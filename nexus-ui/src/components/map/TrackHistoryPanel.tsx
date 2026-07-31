"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TRACK_HISTORY_MAX_MINUTES,
  useTrackHistoryStore,
  type TrackHistoryEntry,
} from "@/stores/track-history-store";

function formatMaxLabel(maxMinutes: number): string {
  if (maxMinutes >= TRACK_HISTORY_MAX_MINUTES) return "航迹没断时长/120分钟";
  return `航迹没断时长/${maxMinutes}分钟`;
}

function clampPanelPos(x: number, y: number, w: number, h: number): { left: number; top: number } {
  const pad = 8;
  const left = Math.min(Math.max(pad, x), Math.max(pad, window.innerWidth - w - pad));
  const top = Math.min(Math.max(pad, y), Math.max(pad, window.innerHeight - h - pad));
  return { left, top };
}

function TrackHistoryPanelBody({ entry }: { entry: TrackHistoryEntry }) {
  const setAlwaysShow = useTrackHistoryStore((s) => s.setAlwaysShow);
  const setMinutes = useTrackHistoryStore((s) => s.setMinutes);
  const closePanel = useTrackHistoryStore((s) => s.closePanel);

  const [minutesText, setMinutesText] = useState(String(entry.minutes));
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: entry.anchorX, top: entry.anchorY });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setMinutesText(String(entry.minutes));
  }, [entry.minutes, entry.uniqueId]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos(clampPanelPos(entry.anchorX, entry.anchorY, rect.width || 280, rect.height || 140));
  }, [entry.anchorX, entry.anchorY, entry.uniqueId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closePanel]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const el = panelRef.current;
      const w = el?.offsetWidth || 280;
      const h = el?.offsetHeight || 140;
      setPos(
        clampPanelPos(d.origLeft + (e.clientX - d.startX), d.origTop + (e.clientY - d.startY), w, h),
      );
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      dragRef.current = null;
      setDragging(false);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [dragging]);

  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: pos.left,
      origTop: pos.top,
    };
    setDragging(true);
  };

  const commitMinutes = (raw: string) => {
    const n = Number(raw.trim());
    if (!Number.isFinite(n)) {
      setMinutesText(String(entry.minutes));
      return;
    }
    setMinutes(entry.uniqueId, n);
  };

  const maxM = Math.max(1, Math.min(TRACK_HISTORY_MAX_MINUTES, entry.maxMinutes));

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="目标历史航迹"
      className="fixed z-[460] w-[min(300px,calc(100vw-1.5rem))] rounded-md border border-white/[0.12] bg-[#1a1b1e]/96 shadow-xl backdrop-blur-sm"
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className={cn(
          "flex cursor-grab items-center justify-between gap-2 border-b border-white/[0.08] px-3 py-2 select-none",
          dragging && "cursor-grabbing",
        )}
        onPointerDown={onHeaderPointerDown}
      >
        <h2 className="min-w-0 truncate text-[13px] font-medium text-white">
          {entry.uniqueId}目标历史航迹
        </h2>
        <button
          type="button"
          onClick={() => closePanel()}
          className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-white/50 hover:bg-white/10 hover:text-white"
          aria-label="关闭"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-3 px-3 py-3">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={maxM}
            step={1}
            value={minutesText}
            disabled={entry.loading}
            onChange={(e) => setMinutesText(e.target.value)}
            onBlur={() => commitMinutes(minutesText)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
            className="h-8 w-16 rounded border border-white/20 bg-transparent px-2 text-center text-sm tabular-nums text-white outline-none focus:border-[#7ee8c8]/70"
          />
          <span className="text-sm text-white/80">分钟</span>
          <button
            type="button"
            onClick={() => setAlwaysShow(entry.uniqueId, !entry.alwaysShow)}
            className={cn(
              "ml-auto h-8 rounded border px-3 text-sm transition-colors",
              entry.alwaysShow
                ? "border-[#7ee8c8] text-white"
                : "border-white/25 text-white/75 hover:border-white/40 hover:text-white",
            )}
            aria-pressed={entry.alwaysShow}
          >
            常显
          </button>
        </div>

        <div>
          <input
            type="range"
            min={1}
            max={maxM}
            step={1}
            value={Math.min(entry.minutes, maxM)}
            disabled={entry.loading}
            onChange={(e) => setMinutes(entry.uniqueId, Number(e.target.value))}
            className="w-full accent-[#7ee8c8]"
          />
          <div className="mt-1 flex justify-between text-[11px] text-white/55">
            <span>1分钟</span>
            <span>{formatMaxLabel(maxM)}</span>
          </div>
        </div>

        {entry.loading ? (
          <p className="text-[11px] text-white/45">加载中…</p>
        ) : entry.error ? (
          <p className="text-[11px] text-red-300/90">{entry.error}</p>
        ) : (
          <p className="text-[11px] text-white/45">{entry.points.length} 个历史点</p>
        )}
      </div>
    </div>
  );
}

/** 当前激活的历史航迹控制面板（常显条目关面板后仍由地图图层绘制） */
export function TrackHistoryPanel() {
  const activeUniqueId = useTrackHistoryStore((s) => s.activeUniqueId);
  const entry = useTrackHistoryStore((s) =>
    activeUniqueId ? s.byUniqueId[activeUniqueId] ?? null : null,
  );

  if (!entry?.panelOpen || typeof document === "undefined") return null;

  return createPortal(<TrackHistoryPanelBody entry={entry} />, document.body);
}
