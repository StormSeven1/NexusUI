"use client";

import { useCommandStore } from "@/stores/command-store";
import { EXEC_TASKS } from "@/lib/command-data";
import { X, Repeat, StopCircle, Undo2, AlertOctagon } from "lucide-react";

export function TaskDetailPanel() {
  const openTaskId = useCommandStore((s) => s.openTaskId);
  const setOpenTaskId = useCommandStore((s) => s.setOpenTaskId);
  const task = EXEC_TASKS.find((t) => t.id === openTaskId);
  if (!task) return null;

  const env = task.envelope;
  const ttlPct = (env.ttlSec / env.ttlTotalSec) * 100;
  const budgetPct = (env.budgetUsed / env.budgetTotal) * 100;
  const conf = task.confidenceCurve;

  return (
    <div className="absolute bottom-9 left-[256px] z-30 w-[316px] animate-slide-in-right rounded-xl border border-white/[0.08] bg-nexus-bg-surface/95 p-3 shadow-2xl backdrop-blur-md">
      <div className="mb-2 flex items-start justify-between">
        <div>
          <div className="text-[13px] font-semibold text-nexus-text-primary">{task.name}</div>
          <div className="font-mono text-[9px] text-nexus-text-muted">{task.authorizationId} · 按包络授权 / 按动作问责</div>
        </div>
        <button onClick={() => setOpenTaskId(null)} className="text-nexus-text-muted hover:text-nexus-text-primary">
          <X size={14} />
        </button>
      </div>

      {/* 授权包络 */}
      <section className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
        <span className="font-mono text-[9px] text-nexus-text-muted">授权包络（承重墙）</span>
        <p className="mt-0.5 text-[10px] text-nexus-text-secondary">{env.scope}</p>
        <div className="mt-1.5 space-y-1">
          <Bar label="时限" pct={ttlPct} text={`${env.ttlSec}秒 / ${env.ttlTotalSec}秒`} color={ttlPct < 20 ? "#dc2626" : "#5b9bd5"} />
          <Bar label="预算" pct={budgetPct} text={`${env.budgetUsed} / ${env.budgetTotal}`} color={budgetPct > 85 ? "#d4932a" : "#3bb87a"} />
        </div>
        <p className="mt-1 flex items-center gap-1 text-[9px] text-nexus-text-muted">
          <AlertOctagon size={10} className="text-[#dc2626]" /> 失效即止：{env.failClosed}
        </p>
      </section>

      {/* 效果评估 */}
      <section className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
        <span className="font-mono text-[9px] text-nexus-text-muted">效果评估（回执 ≠ 效果）</span>
        <div className="mt-1 flex items-end gap-2">
          <ConfCurve data={conf} />
          <div className="text-[10px] leading-tight">
            <div className="text-nexus-text-primary">识别 {(conf[0] * 100).toFixed(0)}% → {(conf[conf.length - 1] * 100).toFixed(0)}%</div>
            <div className="text-nexus-text-muted">第 {task.corroborationCount} 次补证</div>
          </div>
        </div>
      </section>

      {/* 包络内动作流 */}
      <section className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
        <span className="font-mono text-[9px] text-nexus-text-muted">包络内动作流</span>
        <div className="mt-1 max-h-24 space-y-0.5 overflow-y-auto">
          {task.actions.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5 font-mono text-[9px]">
              <span className="text-nexus-text-muted">{a.time}</span>
              <span className="text-[#5b9bd5]">{a.actor}</span>
              <span className="text-nexus-text-secondary">{a.result}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 控制 */}
      <div className="mt-2 flex gap-1.5">
        <button className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[#d4932a]/40 py-1.5 text-[10px] text-[#d4932a] hover:bg-[#d4932a]/10">
          <StopCircle size={12} /> 中止
        </button>
        <button className="flex flex-1 items-center justify-center gap-1 rounded-md border border-white/[0.1] py-1.5 text-[10px] text-nexus-text-secondary hover:bg-white/[0.04]">
          <Undo2 size={12} /> 收回
        </button>
        <button className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[#5b9bd5]/40 py-1.5 text-[10px] text-[#5b9bd5] hover:bg-[#5b9bd5]/10">
          <Repeat size={12} /> 回放
        </button>
      </div>
    </div>
  );
}

function Bar({ label, pct, text, color }: { label: string; pct: number; text: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-7 font-mono text-[9px] text-nexus-text-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-16 text-right font-mono text-[9px] text-nexus-text-secondary">{text}</span>
    </div>
  );
}

function ConfCurve({ data }: { data: number[] }) {
  const w = 90;
  const h = 34;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - v * h}`).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke="#3bb87a" strokeWidth={1.4} />
      {data.map((v, i) => (
        <circle key={i} cx={(i / (data.length - 1)) * w} cy={h - v * h} r={1.4} fill="#3bb87a" />
      ))}
    </svg>
  );
}
