"use client";

/**
 * WorkflowStatusOverlay — 快捷工作流执行状态浮层
 *
 * 【位置】地图上方居中，absolute 定位
 * 【动画】
 *   - 出现：scale-0 opacity-0 → scale-100 opacity-100（500ms）
 *   - 成功：自动淡出消失（3s 后）
 *   - 失败：先放大（scale-110）+ 红色脉冲边框 2s，再淡出消失
 */

import { useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import { Loader2, CheckCircle2, XCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useWorkflowStatusStore,
  type WorkflowStatusEntry,
  type WorkflowStatus,
} from "@/stores/workflow-status-store";

const STATUS_STYLES: Record<WorkflowStatus, { icon: React.ElementType; color: string; label: string }> = {
  starting: { icon: Loader2, color: "text-sky-400", label: "启动中" },
  completed: { icon: CheckCircle2, color: "text-emerald-400", label: "已完成" },
  failed: { icon: XCircle, color: "text-red-400", label: "执行失败" },
  interrupted: { icon: XCircle, color: "text-amber-400", label: "已中断" },
  cancelled: { icon: XCircle, color: "text-amber-400", label: "已取消" },
};

// ── 失败脉冲外部 store（避免 render 中 setState / ref 访问） ──
const pulseMap = new Map<string, boolean>();
const pulseListeners = new Set<() => void>();
function emitPulseChange() { pulseListeners.forEach((l) => l()); }
function activatePulse(id: string) { pulseMap.set(id, true); emitPulseChange(); }
function deactivatePulse(id: string) { pulseMap.set(id, false); emitPulseChange(); }
function subscribePulse(listener: () => void) { pulseListeners.add(listener); return () => pulseListeners.delete(listener); }
function getPulseSnapshot(id: string) { return pulseMap.get(id) ?? false; }

function usePulseActive(id: string): boolean {
  return useSyncExternalStore(
    subscribePulse,
    () => getPulseSnapshot(id),
  );
}

function StatusRow({ entry, onRemove }: { entry: WorkflowStatusEntry; onRemove: (id: string) => void }) {
  const style = STATUS_STYLES[entry.status];
  const Icon = style.icon;
  const isStarting = entry.status === "starting";
  const isCompleted = entry.status === "completed";
  const isFailed = entry.status === "failed";
  const isInterrupted = entry.status === "interrupted";
  const isCancelled = entry.status === "cancelled";
  const isError = isFailed || isInterrupted || isCancelled;

  // 失败/中断红脉冲：外部 store 驱动
  const failurePulse = usePulseActive(entry.threadId);
  useEffect(() => {
    if (isError && entry.completedAt) {
      activatePulse(entry.threadId);
      const t = setTimeout(() => deactivatePulse(entry.threadId), 2000);
      return () => clearTimeout(t);
    }
  }, [isError, entry.completedAt, entry.threadId]);

  // completed：直接关闭
  useEffect(() => {
    if (isCompleted && entry.completedAt) {
      const t = setTimeout(() => onRemove(entry.threadId), 100);
      return () => clearTimeout(t);
    }
  }, [isCompleted, entry.completedAt, entry.threadId, onRemove]);

  // 失败/中断：3s 后关闭
  useEffect(() => {
    if (isError && entry.completedAt) {
      const t = setTimeout(() => onRemove(entry.threadId), 3000);
      return () => clearTimeout(t);
    }
  }, [isError, entry.completedAt, entry.threadId, onRemove]);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-4 py-3 transition-all duration-500",
        failurePulse
          ? "scale-110 border-red-500/80 bg-red-500/10 shadow-[0_0_20px_rgba(239,68,68,0.3)] animate-[pulse-red_0.6s_ease-in-out_infinite]"
          : isFailed
            ? "border-red-500/40 bg-red-500/5"
            : isInterrupted || isCancelled
              ? "border-amber-500/40 bg-amber-500/5"
              : isCompleted
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-white/[0.08] bg-white/[0.03]",
      )}
    >
      <Icon size={18} className={cn(style.color, isStarting && "animate-spin")} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-nexus-text-primary">{entry.name}</span>
          <span className={cn("text-[10px] font-semibold", style.color)}>{style.label}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-nexus-text-muted truncate">{entry.message}</div>
      </div>
      <button onClick={() => onRemove(entry.threadId)} className="shrink-0 rounded p-1 text-nexus-text-muted hover:bg-white/10 hover:text-nexus-text-primary">
        <X size={14} />
      </button>
    </div>
  );
}

export function WorkflowStatusOverlay() {
  const entries = useWorkflowStatusStore((s) => s.entries);
  const removeWorkflow = useWorkflowStatusStore((s) => s.removeWorkflow);
  const closeAndDisconnect = useWorkflowStatusStore((s) => s.closeAndDisconnect);
  const hasEntries = entries.length > 0;

  // 用 DOM ref + CSS class 控制动画，避免 React state 级联渲染
  const containerRef = useRef<HTMLDivElement>(null);
  const prevHasEntriesRef = useRef(hasEntries);
  const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 通过 DOM 操作控制动画类，避免 setState 级联
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const becameNonEmpty = hasEntries && !prevHasEntriesRef.current;
    const becameEmpty = !hasEntries && prevHasEntriesRef.current;
    prevHasEntriesRef.current = hasEntries;

    if (becameNonEmpty) {
      el.style.display = "";
      el.classList.remove("opacity-0", "scale-75");
      el.classList.add("opacity-0", "scale-75");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.classList.remove("opacity-0", "scale-75");
          el.classList.add("opacity-100", "scale-100");
        });
      });
    }

    if (becameEmpty) {
      el.classList.remove("opacity-100", "scale-100");
      el.classList.add("opacity-0", "scale-75");
      if (unmountTimerRef.current) clearTimeout(unmountTimerRef.current);
      unmountTimerRef.current = setTimeout(() => {
        el.style.display = "none";
      }, 500);
    }

    return () => {
      if (unmountTimerRef.current) clearTimeout(unmountTimerRef.current);
    };
  }, [hasEntries]);

  const handleRemove = useCallback(
    (threadId: string) => removeWorkflow(threadId),
    [removeWorkflow],
  );

  const handleClose = useCallback(() => closeAndDisconnect(), [closeAndDisconnect]);

  return (
    <div
      ref={containerRef}
      style={{ display: "none" }}
      className="absolute top-4 left-1/2 z-30 -translate-x-1/2 w-[340px] space-y-2 rounded-xl border border-white/[0.08] bg-[#1a1a2e]/95 px-4 py-3 shadow-2xl backdrop-blur-md transition-all duration-500 ease-out opacity-0 scale-75"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">工作流状态</span>
        <button onClick={handleClose} className="rounded p-0.5 text-nexus-text-muted hover:bg-white/10 hover:text-nexus-text-primary" title="关闭并断开连接">
          <X size={14} />
        </button>
      </div>
      {entries.map((entry) => (
        <StatusRow key={entry.threadId} entry={entry} onRemove={handleRemove} />
      ))}

      <style>{`
        @keyframes pulse-red {
          0%, 100% { box-shadow: 0 0 8px rgba(239,68,68,0.3); border-color: rgba(239,68,68,0.8); }
          50% { box-shadow: 0 0 24px rgba(239,68,68,0.6); border-color: rgba(239,68,68,1); }
        }
      `}</style>
    </div>
  );
}
