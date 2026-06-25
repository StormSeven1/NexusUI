"use client";

import { useCommandStore } from "@/stores/command-store";
import { EXEC_TASKS, DECISION_PACKETS, type ExecTask } from "@/lib/command-data";
import { cn } from "@/lib/utils";
import { ShieldCheck, Clock, Activity, GitCommitVertical } from "lucide-react";

const EFFECT_COLOR: Record<ExecTask["effect"], string> = {
  ok: "#3bb87a",
  climbing: "#d4932a",
  breach: "#dc2626",
};

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** 置信爬升微曲线 */
function ConfidenceSpark({ points, color }: { points: number[]; color: string }) {
  const w = 80;
  const h = 22;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - p * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <line x1={0} y1={h - 0.85 * h} x2={w} y2={h - 0.85 * h} stroke="rgba(255,255,255,0.12)" strokeDasharray="2 2" />
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={w} cy={h - points[points.length - 1] * h} r={2} fill={color} />
    </svg>
  );
}

function TaskCard({ task }: { task: ExecTask }) {
  const color = EFFECT_COLOR[task.effect];
  const openTaskId = useCommandStore((s) => s.openTaskId);
  const setOpenTaskId = useCommandStore((s) => s.setOpenTaskId);
  const selectObject = useCommandStore((s) => s.selectObject);
  const isOpen = openTaskId === task.id;
  const ttlPct = (task.envelope.ttlSec / task.envelope.ttlTotalSec) * 100;
  const lastConf = task.confidenceCurve[task.confidenceCurve.length - 1];

  return (
    <button
      onClick={() => {
        setOpenTaskId(isOpen ? null : task.id);
        selectObject({ kind: "task", id: task.id });
      }}
      className={cn(
        "w-full rounded-md border bg-white/[0.02] p-2 text-left transition-colors hover:bg-white/[0.04]",
        isOpen ? "border-white/20" : "border-white/[0.06]",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold text-nexus-text-primary">{task.name}</span>
        <span
          className="rounded px-1 py-0.5 font-mono text-[8px] font-bold"
          style={{ background: `${color}22`, color }}
        >
          {task.effect === "breach" ? "越界预警" : task.effect === "climbing" ? "爬升中" : "稳定"}
        </span>
      </div>
      <div className="mt-0.5 font-mono text-[8px] text-nexus-text-muted">{task.authorizationId} · {task.targetId}</div>

      {/* 置信爬升 + 佐证 */}
      <div className="mt-1.5 flex items-center justify-between">
        <ConfidenceSpark points={task.confidenceCurve} color={color} />
        <div className="text-right">
          <div className="font-mono text-sm font-bold" style={{ color }}>{(lastConf * 100).toFixed(0)}</div>
          <div className="font-mono text-[8px] text-nexus-text-muted">{task.corroborationCount} 佐证</div>
        </div>
      </div>

      {/* 授权包络：TTL */}
      <div className="mt-1.5 flex items-center gap-1">
        <Clock size={9} className="text-nexus-text-muted" />
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full"
            style={{ width: `${ttlPct}%`, background: ttlPct < 20 ? "#dc2626" : "#5b9bd5" }}
          />
        </div>
        <span className="font-mono text-[8px]" style={{ color: ttlPct < 20 ? "#dc6a6a" : "#9aa0a8" }}>
          时限 {fmt(task.envelope.ttlSec)}
        </span>
      </div>
    </button>
  );
}

export function RightRail() {
  return (
    <aside className="pointer-events-auto flex h-full w-[244px] flex-col gap-2 overflow-y-auto border-l border-white/[0.06] bg-nexus-bg-base/85 p-2.5 backdrop-blur-md">
      {/* 执行监看 */}
      <div>
        <div className="mb-1.5 flex items-center gap-1.5">
          <Activity size={12} className="text-[#3bb87a]" />
          <h2 className="font-mono text-[10px] font-semibold tracking-wider text-nexus-text-secondary">
            执行监看 · 看包络非看按钮
          </h2>
        </div>
        <div className="space-y-1.5">
          {EXEC_TASKS.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </div>
      </div>

      {/* 决策脊 */}
      <div className="mt-1 border-t border-white/[0.06] pt-2">
        <div className="mb-1.5 flex items-center gap-1.5">
          <GitCommitVertical size={12} className="text-[#5b9bd5]" />
          <h2 className="font-mono text-[10px] font-semibold tracking-wider text-nexus-text-secondary">决策脊 · 可追溯</h2>
        </div>
        <ol className="relative space-y-1.5 pl-3">
          <span className="absolute left-[3px] top-1 bottom-1 w-px bg-white/[0.08]" />
          {DECISION_PACKETS.map((dp) => {
            const dot =
              dp.status === "active" ? "#d4932a" : dp.status === "committed" ? "#3bb87a" : "#5a5f68";
            return (
              <li key={dp.id} className="relative">
                <span
                  className="absolute -left-[10px] top-1 h-1.5 w-1.5 rounded-full"
                  style={{ background: dot, boxShadow: dp.status === "active" ? `0 0 6px ${dot}` : "none" }}
                />
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[9px] text-nexus-text-primary">{dp.title}</span>
                  <span className="font-mono text-[8px] text-nexus-text-muted">{dp.time}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-[8px] text-nexus-text-muted">{dp.id}</span>
                  {dp.coa && (
                    <span className="rounded bg-white/[0.05] px-1 font-mono text-[8px] text-nexus-text-secondary">
                      {dp.coa}
                    </span>
                  )}
                  {dp.status === "committed" && <ShieldCheck size={9} className="text-[#3bb87a]" />}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}
