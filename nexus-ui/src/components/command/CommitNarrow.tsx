"use client";

import { useCommandStore } from "@/stores/command-store";
import { COAS, type TradeoffAxis } from "@/lib/command-data";
import { X, PenLine, ShieldCheck, Ban } from "lucide-react";

const AXES: { key: TradeoffAxis; label: string }[] = [
  { key: "fast", label: "快" },
  { key: "stable", label: "稳" },
  { key: "stealth", label: "隐" },
];

/** 承诺态认知收窄：物理钉死只剩 4 样 */
export function CommitNarrow() {
  const commitOpen = useCommandStore((s) => s.commitOpen);
  const selectedCoa = useCommandStore((s) => s.selectedCoa);
  const setCommitOpen = useCommandStore((s) => s.setCommitOpen);
  const commit = useCommandStore((s) => s.commit);
  const setPlaying = useCommandStore((s) => s.setPlaying);

  const coa = COAS.find((c) => c.id === selectedCoa);
  if (!commitOpen || !coa) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-nexus-bg-base/70 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md rounded-xl border bg-nexus-bg-surface p-4 shadow-2xl" style={{ borderColor: coa.color }}>
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs tracking-wider text-nexus-text-secondary">承诺态 · 物理收窄至 4 样</span>
          <button onClick={() => setCommitOpen(false)} className="text-nexus-text-muted hover:text-nexus-text-primary">
            <X size={15} />
          </button>
        </div>

        {/* ① 岔路判定一句话 */}
        <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
          <span className="font-mono text-[9px] text-nexus-text-muted">① 岔路判定</span>
          <p className="mt-0.5 text-[13px] font-semibold" style={{ color: coa.color }}>
            选定未来 {coa.label}：{coa.card.outcome}
          </p>
        </div>

        {/* ② 三轴对照尺 */}
        <div className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
          <span className="font-mono text-[9px] text-nexus-text-muted">② 取舍轴对照（非支配性）</span>
          <div className="mt-1 space-y-1">
            {AXES.map((a) => (
              <div key={a.key} className="flex items-center gap-2">
                <span className="w-3 font-mono text-[10px] text-nexus-text-muted">{a.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full" style={{ width: `${coa.card.scores[a.key] * 100}%`, background: coa.color }} />
                </div>
                <span className="w-6 text-right font-mono text-[10px]" style={{ color: coa.color }}>
                  {(coa.card.scores[a.key] * 100).toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ③ 信任赌注 */}
        <div className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
          <span className="font-mono text-[9px] text-nexus-text-muted">③ 信任赌注</span>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-nexus-text-primary">
            <ShieldCheck size={12} className="text-[#3bb87a]" />
            G-A 信任 trusted · 双源（雷达+EO）
          </p>
          <p className="mt-0.5 text-[9.5px] text-[#d4932a]">证据缺口：{coa.card.evidenceGap}</p>
        </div>

        {/* ④ 授权包络 + TTL + 签字闸 */}
        <div className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
          <span className="font-mono text-[9px] text-nexus-text-muted">④ 授权包络（承重墙）+ 签字闸</span>
          <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[10px] text-nexus-text-secondary">
            <span>scope · 拦截单元引导</span>
            <span>TTL · 180s</span>
            <span>区域 · AOR-7 内</span>
            <span>预算 · 频率上限 30</span>
          </div>
          <p className="mt-1 flex items-center gap-1 text-[9.5px] text-nexus-text-muted">
            <Ban size={11} className="text-[#dc2626]" />
            硬杀处置置灰 · 需交战合法性裁决（P1）
          </p>
        </div>

        {/* 签字闸 */}
        <button
          onClick={() => {
            commit();
            setPlaying(true);
          }}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-bold text-nexus-bg-base transition-transform active:scale-[0.98]"
          style={{ background: coa.color }}
        >
          <PenLine size={15} />
          担责签字 · COACommit 责任提交
        </button>
        <p className="mt-1 text-center text-[8.5px] text-nexus-text-muted">
          签字 = 责任起点入责任链 · per-envelope 授权 / per-action 问责
        </p>
      </div>
    </div>
  );
}
