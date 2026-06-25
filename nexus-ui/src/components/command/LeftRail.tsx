"use client";

import React from "react";
import { useCommandStore } from "@/stores/command-store";
import {
  THREAT_GROUPS,
  EXEC_TASKS,
  CMD_ASSETS,
  ASSET_TYPE_LABEL,
  ASSET_STATUS_LABEL,
  type ExecTask,
} from "@/lib/command-data";
import { FORCE_COLORS, FORCE_LABELS } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { AlertTriangle, ShieldQuestion, Crosshair, Radar, Rocket, Plane, Building2 } from "lucide-react";

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

function ThreatItem({ g, mode, isSel, onSelect }: {
  g: import("@/lib/command-data").ThreatGroup;
  mode: string;
  isSel: boolean;
  onSelect: () => void;
}) {
  const color = FORCE_COLORS[g.disposition];
  const dim = mode === "highpressure" && !g.primary;
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full rounded-md border px-2 py-1.5 text-left transition-all",
        isSel ? "border-white/20 bg-white/[0.05]" : "border-white/[0.05] hover:bg-white/[0.03]",
        dim && "opacity-45",
      )}
    >
      <div className="flex items-center gap-1.5">
        {/* 群用方块，单体用菱形 */}
        {g.isGroup
          ? <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: color }} />
          : <span className="inline-block h-2 w-2 shrink-0 rotate-45 border" style={{ borderColor: color }} />
        }
        <span className="truncate font-mono text-[10.5px] font-bold" style={{ color }}>{g.name}</span>
        {g.primary && <AlertTriangle size={10} className="shrink-0 text-[#dc2626]" />}
        {g.trust === "pending" && <ShieldQuestion size={10} className="shrink-0 text-[#d4932a]" />}
        <span className="ml-auto shrink-0 font-mono text-[10px] text-nexus-text-secondary">
          T{(g.threat * 100).toFixed(0)}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.05]">
        <div className="h-full rounded-full" style={{ width: `${g.threat * 100}%`, background: color }} />
      </div>
      <p className="mt-0.5 font-mono text-[8px] text-nexus-text-muted">
        {g.isGroup ? `${g.trackCount} 迹` : "单体"} · {g.summary.slice(0, 30)}{g.summary.length > 30 ? "…" : ""}
      </p>
    </button>
  );
}

function ThreatRail() {
  const mode = useCommandStore((s) => s.mode);
  const selected = useCommandStore((s) => s.selected);
  const selectObject = useCommandStore((s) => s.selectObject);

  const groups = [...THREAT_GROUPS].filter((g) => g.isGroup).sort((a, b) => b.threat - a.threat);
  const singles = [...THREAT_GROUPS].filter((g) => !g.isGroup).sort((a, b) => b.threat - a.threat);
  const totalTracks = groups.reduce((a, g) => a + g.trackCount, 0);

  return (
    <div className="flex min-h-0 flex-[1.2] flex-col">
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <span className="font-mono text-[10px] font-semibold tracking-wider text-nexus-text-secondary">威胁度栏</span>
        <span className="font-mono text-[9px] text-nexus-text-muted">
          {totalTracks} 迹 · {groups.length} 群 · {singles.length} 单体
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {/* 群目标分组 */}
        {groups.length > 0 && (
          <>
            <div className="mb-1 flex items-center gap-1 px-1">
              <span className="h-1.5 w-1.5 rounded-sm bg-[#e8724a]/60" />
              <span className="font-mono text-[8px] text-nexus-text-muted tracking-wider">群目标</span>
            </div>
            <div className="space-y-1">
              {groups.map((g) => (
                <ThreatItem
                  key={g.id} g={g} mode={mode}
                  isSel={selected?.kind === "group" && selected.id === g.id}
                  onSelect={() => selectObject({ kind: "group", id: g.id })}
                />
              ))}
            </div>
          </>
        )}
        {/* 单体目标分组 */}
        {singles.length > 0 && (
          <>
            <div className="mb-1 mt-2 flex items-center gap-1 px-1">
              <span className="inline-block h-1.5 w-1.5 rotate-45 border border-[#5b9bd5]/60" />
              <span className="font-mono text-[8px] text-nexus-text-muted tracking-wider">单体目标</span>
            </div>
            <div className="space-y-1">
              {singles.map((g) => (
                <ThreatItem
                  key={g.id} g={g} mode={mode}
                  isSel={selected?.kind === "group" && selected.id === g.id}
                  onSelect={() => selectObject({ kind: "group", id: g.id })}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const ASSET_ICON: Record<string, React.ElementType> = {
  radar: Radar,
  interceptor: Rocket,
  drone: Plane,
  tdoa: Radar,
  "key-area": Building2,
};

const ASSET_STATUS_COLOR = {
  online: "#3bb87a",
  degraded: "#d4932a",
  offline: "#dc2626",
} as const;

function AssetRail() {
  const selected = useCommandStore((s) => s.selected);
  const selectObject = useCommandStore((s) => s.selectObject);
  const online = CMD_ASSETS.filter((a) => a.status === "online").length;

  return (
    <div className="flex min-h-0 flex-[0.9] flex-col border-t border-white/[0.06]">
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <span className="font-mono text-[10px] font-semibold tracking-wider text-nexus-text-secondary">我方资产 · 可用</span>
        <span className="font-mono text-[9px] text-nexus-text-muted">{online}/{CMD_ASSETS.length} 在线</span>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-1.5 pb-2">
        {CMD_ASSETS.map((a) => {
          const Icon = ASSET_ICON[a.type];
          const statusColor = ASSET_STATUS_COLOR[a.status];
          const isSel = selected?.kind === "asset" && selected.id === a.id;
          return (
            <button
              key={a.id}
              onClick={() => selectObject({ kind: "asset", id: a.id })}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition-all",
                isSel ? "border-white/20 bg-white/[0.05]" : "border-white/[0.05] hover:bg-white/[0.03]",
              )}
            >
              <Icon size={13} className="shrink-0 text-[#5b9bd5]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="truncate text-[11px] text-nexus-text-primary">{a.name}</span>
                  <span className="font-mono text-[8px] text-nexus-text-muted">{ASSET_TYPE_LABEL[a.type]}</span>
                </div>
                {a.rangeKm && <div className="font-mono text-[8px] text-nexus-text-muted">覆盖 {a.rangeKm} 公里</div>}
              </div>
              <span className="flex items-center gap-1 font-mono text-[9px]" style={{ color: statusColor }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />
                {ASSET_STATUS_LABEL[a.status]}
              </span>
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
        {/* 时限（条） */}
        <div className="flex flex-1 items-center gap-1">
          <span className="font-mono text-[8px] text-nexus-text-muted">时限</span>
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
    <aside className="pointer-events-auto z-20 flex h-full w-[208px] flex-col border-r border-white/[0.06] bg-nexus-bg-surface/85 backdrop-blur-md">
      <ThreatRail />
      <AssetRail />
      <ExecMonitorRail />
    </aside>
  );
}
