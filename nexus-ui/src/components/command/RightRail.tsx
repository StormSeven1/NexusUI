"use client";

import { useCommandStore } from "@/stores/command-store";
import { THREAT_GROUPS, EXEC_TASKS, COAS, DECISION_PACKETS, type ExecTask } from "@/lib/command-data";
import { FORCE_COLORS } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { ShieldCheck, Clock, Activity, GitCommitVertical, Target, Crosshair } from "lucide-react";

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** 微型置信爬升曲线 */
function ConfidenceSpark({ points, color }: { points: number[]; color: string }) {
  const w = 60;
  const h = 18;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - p * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <line x1={0} y1={h * 0.15} x2={w} y2={h * 0.15} stroke="rgba(255,255,255,0.1)" strokeDasharray="2 2" />
      <path d={path} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={w} cy={h - points[points.length - 1] * h} r={2} fill={color} />
    </svg>
  );
}

/** 处置进度条（0 待命 → 1 完成） */
function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct * 100}%`, background: color }} />
    </div>
  );
}

/** 单条目标-处置卡 */
function GroupTaskCard({ task }: { task: ExecTask }) {
  const scrubT = useCommandStore((s) => s.scrubT);
  const selectedCoa = useCommandStore((s) => s.selectedCoa);
  const selected = useCommandStore((s) => s.selected);
  const selectObject = useCommandStore((s) => s.selectObject);

  // 找到关联的威胁群
  const group = THREAT_GROUPS.find((g) => g.id === task.targetId);
  const groupColor = group ? FORCE_COLORS[group.disposition] : "#5b9bd5";

  // 当前裁决方案下的资产编排（对应该群）
  const coa = COAS.find((c) => c.id === selectedCoa);
  const coaTasks = coa?.tasks ?? [];

  const effectColor =
    task.effect === "breach" ? "#dc2626" : task.effect === "climbing" ? "#d4932a" : "#3bb87a";
  const effectLabel =
    task.effect === "breach" ? "越界预警" : task.effect === "climbing" ? "处置中" : "稳定";

  const lastConf = task.confidenceCurve[task.confidenceCurve.length - 1];
  const ttlPct = task.envelope.ttlSec / task.envelope.ttlTotalSec;
  const isSel = selected?.kind === "group" && selected.id === task.targetId;

  // 推演进度：用 scrubT 代表处置进度百分比
  const dispatchPct = Math.min(scrubT, 1);

  return (
    <button
      onClick={() => selectObject({ kind: "group", id: task.targetId })}
      className={cn(
        "w-full rounded-md border p-2 text-left transition-all",
        isSel ? "border-white/20 bg-white/[0.05]" : "border-white/[0.05] hover:bg-white/[0.03]",
      )}
    >
      {/* 头：群名 + 处置状态 */}
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: groupColor }} />
        <Target size={10} style={{ color: groupColor }} />
        <span className="font-mono text-[10.5px] font-semibold" style={{ color: groupColor }}>
          {group ? group.name : task.targetId}
        </span>
        {group && (
          <span className="font-mono text-[8px] text-nexus-text-muted">
            {group.isGroup ? `${group.trackCount} 迹` : "单体"}
          </span>
        )}
        <span
          className="ml-auto rounded px-1 py-0.5 font-mono text-[8px] font-bold"
          style={{ background: `${effectColor}22`, color: effectColor }}
        >
          {effectLabel}
        </span>
      </div>

      {/* 任务名 + 授权号 */}
      <div className="mt-0.5 flex items-center gap-1 font-mono text-[8px] text-nexus-text-muted">
        <Crosshair size={9} />
        <span className="truncate">{task.name}</span>
        <span className="ml-auto shrink-0">{task.authorizationId}</span>
      </div>

      {/* 置信曲线 + 置信值 */}
      <div className="mt-1.5 flex items-center gap-2">
        <ConfidenceSpark points={task.confidenceCurve} color={effectColor} />
        <div className="text-right">
          <div className="font-mono text-sm font-bold leading-none" style={{ color: effectColor }}>
            {(lastConf * 100).toFixed(0)}
            <span className="text-[9px] font-normal text-nexus-text-muted">%</span>
          </div>
          <div className="font-mono text-[8px] text-nexus-text-muted">{task.corroborationCount} 佐证</div>
        </div>
      </div>

      {/* 处置进度（推演中动态填充） */}
      {selectedCoa && (
        <div className="mt-1.5">
          <div className="mb-0.5 flex justify-between font-mono text-[8px] text-nexus-text-muted">
            <span>处置进度</span>
            <span>{(dispatchPct * 100).toFixed(0)}%</span>
          </div>
          <ProgressBar pct={dispatchPct} color={effectColor} />
        </div>
      )}

      {/* 方案下调用的资产（最多显示3条） */}
      {coaTasks.length > 0 && (
        <div className="mt-1.5 space-y-0.5 border-t border-white/[0.05] pt-1">
          {coaTasks.slice(0, 3).map((ct) => {
            const acted = scrubT >= ct.actAtT;
            return (
              <div key={ct.assetId} className="flex items-center gap-1 font-mono text-[8px]">
                <span
                  className="h-1 w-1 shrink-0 rounded-full"
                  style={{ background: acted ? "#3bb87a" : "rgba(255,255,255,0.2)" }}
                />
                <span className={cn("truncate", acted ? "text-nexus-text-secondary" : "text-nexus-text-muted")}>
                  {ct.assetName}
                </span>
                <span className="ml-auto shrink-0" style={{ color: acted ? "#3bb87a" : "#6b7280" }}>
                  {acted ? "已处置" : `T+${Math.round(ct.actAtT * 180)}s`}
                </span>
              </div>
            );
          })}
          {coaTasks.length > 3 && (
            <div className="font-mono text-[7.5px] text-nexus-text-muted">+{coaTasks.length - 3} 更多资产…</div>
          )}
        </div>
      )}

      {/* 时限条 */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <Clock size={9} className="shrink-0 text-nexus-text-muted" />
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full"
            style={{ width: `${ttlPct * 100}%`, background: ttlPct < 0.2 ? "#dc2626" : "#5b9bd5" }}
          />
        </div>
        <span className="font-mono text-[8px]" style={{ color: ttlPct < 0.2 ? "#dc6a6a" : "#9aa0a8" }}>
          {fmt(task.envelope.ttlSec)}
        </span>
      </div>
    </button>
  );
}

export function RightRail() {
  return (
    <aside className="pointer-events-auto flex h-full w-[248px] flex-col gap-2 overflow-y-auto border-l border-white/[0.06] bg-nexus-bg-base/85 p-2.5 backdrop-blur-md">

      {/* 执行监看：群目标 × 处置进度 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Activity size={12} className="text-[#3bb87a]" />
          <h2 className="font-mono text-[10px] font-semibold tracking-wider text-nexus-text-secondary">
            执行监看
          </h2>
          <span className="ml-auto font-mono text-[9px] text-nexus-text-muted">
            群目标 → 处置资产 → 进度
          </span>
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {EXEC_TASKS.map((t) => (
            <GroupTaskCard key={t.id} task={t} />
          ))}
        </div>
      </div>

      {/* 决策脊 */}
      <div className="border-t border-white/[0.06] pt-2">
        <div className="mb-1.5 flex items-center gap-1.5">
          <GitCommitVertical size={12} className="text-[#5b9bd5]" />
          <h2 className="font-mono text-[10px] font-semibold tracking-wider text-nexus-text-secondary">
            决策脊 · 可追溯
          </h2>
        </div>
        <ol className="relative space-y-1.5 pl-3">
          <span className="absolute bottom-1 left-[3px] top-1 w-px bg-white/[0.08]" />
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
