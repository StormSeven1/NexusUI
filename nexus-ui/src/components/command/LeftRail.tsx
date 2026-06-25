"use client";

import { useCommandStore } from "@/stores/command-store";
import { THREAT_GROUPS, EXEC_TASKS, type ExecTask } from "@/lib/command-data";
import { FORCE_COLORS, FORCE_LABELS } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { AlertTriangle, ShieldQuestion, Crosshair } from "lucide-react";

/* 迷你置信曲线 */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 48;
  const h = 14;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - v * h}`).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.2} />
      <circle cx={w} cy={h - data[data.length - 1] * h} r={1.6} fill={color} />
    </svg>
  );
}

function ThreatRail() {
  const mode = useCommandStore((s) => s.mode);
  const selected = useCommandStore((s) => s.selected);
  const selectObject = useCommandStore((s) => s.selectObject);
  const sorted = [...THREAT_GROUPS].sort((a, b) => b.threat - a.threat);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <span className="font-mono text-[10px] font-semibold tracking-wider text-nexus-text-secondary">威胁度栏 · 待裁</span>
        <span className="font-mono text-[9px] text-nexus-text-muted">{THREAT_GROUPS.reduce((a, g) => a + g.trackCount, 0)} 迹 → {THREAT_GROUPS.length} 群</span>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-1.5 pb-2">
        {sorted.map((g) => {
          const color = FORCE_COLORS[g.disposition];
          const isSel = selected?.kind === "group" && selected.id === g.id;
          const dim = mode === "highpressure" && !g.primary;
          return (
            <button
              key={g.id}
              onClick={() => selectObject({ kind: "group", id: g.id })}
              className={cn(
                "w-full rounded-md border px-2 py-1.5 text-left transition-all",
                isSel ? "border-white/20 bg-white/[0.05]" : "border-white/[0.05] hover:bg-white/[0.03]",
                dim && "opacity-45",
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
                <span className="font-mono text-[11px] font-bold" style={{ color }}>{g.id}</span>
                {g.primary && <AlertTriangle size={11} className="text-[#dc2626]" />}
                {g.trust === "pending" && <ShieldQuestion size={11} className="text-[#d4932a]" />}
                <span className="ml-auto font-mono text-[10px] text-nexus-text-secondary">{(g.threat * 100).toFixed(0)}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.05]">
                <div className="h-full rounded-full" style={{ width: `${g.threat * 100}%`, background: color }} />
              </div>
              <p className="mt-1 line-clamp-1 text-[9.5px] leading-tight text-nexus-text-muted">
                {FORCE_LABELS[g.disposition]} · {g.summary}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ExecRow({ task }: { task: ExecTask }) {
  const openTaskId = useCommandStore((s) => s.openTaskId);
  const setOpenTaskId = useCommandStore((s) => s.setOpenTaskId);
  const isOpen = openTaskId === task.id;
  const ttlPct = (task.envelope.ttlSec / task.envelope.ttlTotalSec) * 100;
  const effectColor = task.effect === "breach" ? "#dc2626" : task.effect === "climbing" ? "#3bb87a" : "#5b9bd5";

  return (
    <button
      onClick={() => setOpenTaskId(isOpen ? null : task.id)}
      className={cn(
        "w-full rounded-md border px-2 py-1.5 text-left transition-all",
        isOpen ? "border-white/20 bg-white/[0.05]" : "border-white/[0.05] hover:bg-white/[0.03]",
      )}
    >
      <div className="flex items-center gap-1.5">
        <Crosshair size={11} style={{ color: effectColor }} />
        <span className="text-[11px] text-nexus-text-primary">{task.name}</span>
        {task.effect === "breach" && <span className="ml-auto rounded bg-[#dc2626]/15 px-1 font-mono text-[8px] text-[#dc2626]">越界</span>}
      </div>
      <div className="mt-1 flex items-center gap-2">
        {/* TTL 环（条） */}
        <div className="flex flex-1 items-center gap-1">
          <span className="font-mono text-[8px] text-nexus-text-muted">TTL</span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
            <div className="h-full rounded-full" style={{ width: `${ttlPct}%`, background: ttlPct < 20 ? "#dc2626" : "#5b9bd5" }} />
          </div>
        </div>
        <Sparkline data={task.confidenceCurve} color={effectColor} />
      </div>
      <div className="mt-0.5 font-mono text-[8.5px] text-nexus-text-muted">
        第 {task.corroborationCount} 次补证 · 识别 {(task.confidenceCurve[task.confidenceCurve.length - 1] * 100).toFixed(0)}%
      </div>
    </button>
  );
}

function ExecMonitorRail() {
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-white/[0.06]">
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <span className="font-mono text-[10px] font-semibold tracking-wider text-nexus-text-secondary">执行监看栏 · 在盯</span>
        <span className="font-mono text-[9px] text-nexus-text-muted">{EXEC_TASKS.length} 任务线</span>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-1.5 pb-2">
        {EXEC_TASKS.map((t) => (
          <ExecRow key={t.id} task={t} />
        ))}
      </div>
    </div>
  );
}

export function LeftRail() {
  return (
    <aside className="z-20 flex h-full w-[208px] flex-col bg-nexus-bg-surface/85 backdrop-blur-md">
      <ThreatRail />
      <ExecMonitorRail />
    </aside>
  );
}
