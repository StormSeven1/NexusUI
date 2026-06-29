"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { useTaskProgressStore, type TaskProgressEntry } from "@/stores/task-progress-store";
import { resolveAliasByTargetId } from "@/stores/track-alias-store";

interface FloatingPosition {
  x: number;
  y: number;
}

function formatElapsed(startedAt: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const STATUS_LABEL: Record<TaskProgressEntry["status"], string> = {
  executing: "正在执行",
  ended: "处置结束",
  terminated: "终止",
};

const STATUS_COLOR: Record<TaskProgressEntry["status"], string> = {
  executing: "text-sky-400",
  ended: "text-emerald-400",
  terminated: "text-amber-400",
};

export function AgentMessageFloat() {
  const [isExpanded, setIsExpanded] = useState(true);
  const [manualPosition, setManualPosition] = useState<FloatingPosition | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const lastExpandedPosRef = useRef<FloatingPosition | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ offsetX: 0, offsetY: 0, active: false });

  const entries = useTaskProgressStore((s) => s.entries);

  useEffect(() => {
    const hasExecuting = entries.some((e) => e.status === "executing");
    if (!hasExecuting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [entries]);

  const grouped = useMemo(() => {
    const map = new Map<string, TaskProgressEntry[]>();
    for (const entry of entries) {
      let rows = map.get(entry.targetId);
      if (!rows) {
        rows = [];
        map.set(entry.targetId, rows);
      }
      rows.push(entry);
    }
    return new Map(Array.from(map.entries()).reverse());
  }, [entries]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [entries.length]);

  const handleMinimize = useCallback(() => {
    if (containerRef.current) {
      const { left, top } = containerRef.current.getBoundingClientRect();
      lastExpandedPosRef.current = { x: left, y: top };
    } else if (manualPosition) {
      lastExpandedPosRef.current = { ...manualPosition };
    }
    setIsExpanded(false);
  }, [manualPosition]);

  const handleRestore = useCallback(() => {
    if (lastExpandedPosRef.current) {
      setManualPosition({ ...lastExpandedPosRef.current });
    }
    setIsExpanded(true);
  }, []);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (headerRef.current && headerRef.current.contains(e.target as Node) && containerRef.current) {
        e.preventDefault();
        const { left, top } = containerRef.current.getBoundingClientRect();
        dragRef.current = {
          offsetX: e.clientX - left,
          offsetY: e.clientY - top,
          active: true,
        };
        containerRef.current.style.transition = "none";
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current.active || !containerRef.current) return;
      e.preventDefault();
      const x = e.clientX - dragRef.current.offsetX;
      const y = e.clientY - dragRef.current.offsetY;
      const style = containerRef.current.style;
      style.left = `${x}px`;
      style.top = `${y}px`;
      style.bottom = "auto";
      style.transform = "none";
    };

    const handleMouseUp = () => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      if (containerRef.current) {
        containerRef.current.style.transition = "";
        const { left, top } = containerRef.current.getBoundingClientRect();
        setManualPosition({ x: left, y: top });
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const executingCount = entries.filter((e) => e.status === "executing").length;

  if (!isExpanded) {
    return (
      <button
        type="button"
        onClick={handleRestore}
        className="absolute z-50 left-3 bottom-3 flex items-center gap-1.5 rounded-md border border-nexus-border bg-nexus-bg-elevated/90 px-2.5 py-1.5 text-[11px] font-medium text-nexus-text-secondary shadow-lg backdrop-blur-sm transition-colors hover:bg-nexus-bg-elevated hover:text-nexus-text-primary"
      >
        <span>任务进展</span>
        {executingCount > 0 && (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-[9px] font-bold text-white">
            {executingCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-50 flex flex-col transition-all duration-200"
      style={
        manualPosition
          ? { left: `${manualPosition.x}px`, top: `${manualPosition.y}px`, transform: "none" }
          : { left: "50%", bottom: "12px", transform: "translateX(-50%)" }
      }
    >
      <div
        ref={headerRef}
        className="nexus-glass cursor-move rounded-t-lg border border-nexus-border px-3 py-1 transition-colors hover:bg-nexus-bg-elevated"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-[11px] font-semibold text-nexus-text-primary">任务进展</h3>
            {executingCount > 0 && (
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-sky-500 text-[8px] font-bold text-white">
                {executingCount}
              </span>
            )}
          </div>
          <button
            onClick={handleMinimize}
            className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-white/10"
            title="最小化"
          >
            <span className="text-sm leading-none text-nexus-text-secondary">-</span>
          </button>
        </div>
      </div>

      <div className="nexus-glass overflow-hidden rounded-b-lg border border-t-0 border-nexus-border">
        <div
          ref={scrollRef}
          className="overflow-y-auto"
          style={{
            maxHeight: "180px",
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(255,255,255,0.18) transparent",
          }}
        >
          <table className="w-full min-w-[560px] text-[11px]">
            <thead className="nexus-glass sticky top-0 z-10 backdrop-blur-md">
              <tr className="border-b border-nexus-border text-nexus-text-secondary">
                <th className="w-[130px] px-2 py-[3px] text-left font-medium">告警目标</th>
                <th className="w-[110px] px-2 py-[3px] text-left font-medium">处置兵力</th>
                <th className="w-[70px] px-2 py-[3px] text-center font-medium">处置时间</th>
                <th className="w-[70px] px-2 py-[3px] text-center font-medium">处置状态</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-1.5 text-center text-nexus-text-muted">
                    暂无任务进展
                  </td>
                </tr>
              ) : (
                Array.from(grouped.entries()).map(([targetId, rows]) => {
                  const alias = rows[0]?.targetAlias || resolveAliasByTargetId(targetId);
                  return rows.map((entry, rowIndex) => (
                    <tr
                      key={entry.id}
                      className="border-b border-nexus-border/30 hover:bg-white/[0.02] last:border-b-0"
                    >
                      {rowIndex === 0 && (
                        <td className="w-[130px] px-2 py-[2px] align-middle" rowSpan={rows.length}>
                          <div className="leading-tight">
                            <span className="text-[11px] font-bold text-nexus-text-primary">
                              {alias || (targetId ? `目标 ${targetId}` : "目标")}
                            </span>
                          </div>
                        </td>
                      )}
                      <td className="px-2 py-[2px] text-nexus-text-primary">{entry.deviceName}</td>
                      <td className="px-2 py-[2px] text-center tabular-nums text-nexus-text-secondary">
                        {formatElapsed(
                          entry.startedAt,
                          entry.status === "executing" ? now : (entry.endedAt ?? now),
                        )}
                      </td>
                      <td className={cn("px-2 py-[2px] text-center font-medium", STATUS_COLOR[entry.status])}>
                        {STATUS_LABEL[entry.status]}
                      </td>
                    </tr>
                  ));
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
