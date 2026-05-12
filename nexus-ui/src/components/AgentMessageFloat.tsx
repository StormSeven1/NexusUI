"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useTaskProgressStore, type TaskProgressEntry } from "@/stores/task-progress-store";
import { useTrackAliasStore } from "@/stores/track-alias-store";
import { formatTargetIdForUi } from "@/lib/disposal/normalize-disposal-plans";

interface FloatingPosition {
  x: number;
  y: number;
}

/** 格式化耗时：秒级精度 HH:MM:SS */
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
  /** 最小化前记录的展开位置，恢复时使用 */
  const lastExpandedPosRef = useRef<FloatingPosition | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number; active: boolean }>({ offsetX: 0, offsetY: 0, active: false });

  const entries = useTaskProgressStore((s) => s.entries);
  const aliases = useTrackAliasStore((s) => s.aliases);

  // 每秒刷新计时器（仅当有 executing 条目时）
  useEffect(() => {
    const hasExecuting = entries.some((e) => e.status === "executing");
    if (!hasExecuting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [entries]);

  // 按 targetId 分组，反转顺序（最新的目标在最上面）
  const grouped = useMemo(() => {
    const map = new Map<string, TaskProgressEntry[]>();
    for (const e of entries) {
      let arr = map.get(e.targetId);
      if (!arr) { arr = []; map.set(e.targetId, arr); }
      arr.push(e);
    }
    // 反转：最后插入的 targetId 排最前
    return new Map(Array.from(map.entries()).reverse());
  }, [entries]);

  // 新条目到达时自动滚到顶部（最新在上）
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [entries.length]);

  // ── 最小化：保存当前位置，切到按钮态 ──
  const handleMinimize = useCallback(() => {
    if (containerRef.current) {
      const { left, top } = containerRef.current.getBoundingClientRect();
      lastExpandedPosRef.current = { x: left, y: top };
    } else if (manualPosition) {
      lastExpandedPosRef.current = { ...manualPosition };
    }
    setIsExpanded(false);
  }, [manualPosition]);

  // ── 恢复：回到最小化前的位置 ──
  const handleRestore = useCallback(() => {
    if (lastExpandedPosRef.current) {
      setManualPosition({ ...lastExpandedPosRef.current });
    }
    setIsExpanded(true);
  }, []);

  // 拖动功能：mousemove 直接操作 DOM style，不触发 re-render
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (headerRef.current && headerRef.current.contains(e.target as Node) && containerRef.current) {
        e.preventDefault();
        const { left, top } = containerRef.current.getBoundingClientRect();
        dragRef.current = { offsetX: e.clientX - left, offsetY: e.clientY - top, active: true };
        containerRef.current.style.transition = "none";
      }
    };
    const handleMouseMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d.active || !containerRef.current) return;
      e.preventDefault();
      const x = e.clientX - d.offsetX;
      const y = e.clientY - d.offsetY;
      const s = containerRef.current.style;
      s.left = `${x}px`;
      s.top = `${y}px`;
      s.bottom = "auto";
      s.transform = "none";
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
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const executingCount = entries.filter((e) => e.status === "executing").length;

  // ── 最小化状态：地图左下角小按钮 ──
  if (!isExpanded) {
    return (
      <button
        type="button"
        onClick={handleRestore}
        className="absolute z-50 left-3 bottom-3 rounded-md border border-nexus-border bg-nexus-bg-elevated/90 backdrop-blur-sm px-2.5 py-1.5 text-[11px] font-medium text-nexus-text-secondary hover:text-nexus-text-primary hover:bg-nexus-bg-elevated transition-colors flex items-center gap-1.5 shadow-lg"
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

  // ── 展开状态：可拖动面板 ──
  return (
    <div
      ref={containerRef}
      className="fixed z-50 flex flex-col transition-all duration-200"
      style={
        manualPosition
          ? { left: `${manualPosition.x}px`, top: `${manualPosition.y}px`, transform: 'none' }
          : { left: '50%', bottom: '12px', transform: 'translateX(-50%)' }
      }
    >
      {/* 标题栏（可拖动） */}
      <div
        ref={headerRef}
        className="nexus-glass border border-nexus-border px-3 py-1 cursor-move hover:bg-nexus-bg-elevated transition-colors rounded-t-lg"
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
            className="h-5 w-5 rounded hover:bg-white/10 transition-colors flex items-center justify-center"
            title="最小化"
          >
            <span className="text-sm leading-none text-nexus-text-secondary">−</span>
          </button>
        </div>
      </div>

      {/* 表格区域：固定表头 + 可滚动表体 */}
      <div className="nexus-glass border border-t-0 border-nexus-border rounded-b-lg overflow-hidden">
        <div
          ref={scrollRef}
          className="overflow-y-auto"
          style={{
            maxHeight: '180px',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.18) transparent',
          }}
        >
          <table className="w-full min-w-[560px] text-[11px]">
            <thead className="sticky top-0 z-10 nexus-glass backdrop-blur-md">
              <tr className="border-b border-nexus-border text-nexus-text-secondary">
                <th className="px-2 py-[3px] text-left font-medium w-[130px]">告警目标</th>
                <th className="px-2 py-[3px] text-left font-medium w-[110px]">处置兵力</th>
                <th className="px-2 py-[3px] text-center font-medium w-[70px]">处置时间</th>
                <th className="px-2 py-[3px] text-center font-medium w-[70px]">处置状态</th>
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
                  const alias = aliases[targetId];
                  const displayId = formatTargetIdForUi(targetId, undefined);
                  return rows.map((entry, ri) => (
                    <tr key={entry.id} className="border-b border-nexus-border/30 last:border-b-0 hover:bg-white/[0.02]">
                      {/* 告警目标：rowSpan 跨整组，垂直居中 */}
                      {ri === 0 && (
                        <td className="px-2 py-[2px] align-middle w-[130px]" rowSpan={rows.length}>
                          <div className="leading-tight">
                            <span className="text-[11px] font-bold text-nexus-text-primary">
                              {alias || `目标-${displayId}`}
                            </span>
                            <span className="text-[9px] text-nexus-text-muted ml-1">
                              ID:{displayId}
                            </span>
                          </div>
                        </td>
                      )}
                      {/* 处置兵力 */}
                      <td className="px-2 py-[2px] text-nexus-text-primary">{entry.deviceName}</td>
                      {/* 处置时间 */}
                      <td className="px-2 py-[2px] text-center text-nexus-text-secondary tabular-nums">
                        {formatElapsed(entry.startedAt, entry.status === "executing" ? now : (entry.endedAt ?? now))}
                      </td>
                      {/* 处置状态 */}
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
