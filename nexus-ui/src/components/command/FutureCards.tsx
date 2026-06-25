"use client";

import { useCommandStore } from "@/stores/command-store";
import { COAS, type TradeoffAxis } from "@/lib/command-data";
import { cn } from "@/lib/utils";
import { Check, GitFork } from "lucide-react";

const AXES: { key: TradeoffAxis; label: string }[] = [
  { key: "fast", label: "快" },
  { key: "stable", label: "稳" },
  { key: "stealth", label: "隐" },
];

/** 共享取舍标尺：一眼读非支配性 */
function TradeoffRuler({ scores, color }: { scores: Record<TradeoffAxis, number>; color: string }) {
  return (
    <div className="space-y-1">
      {AXES.map((a) => (
        <div key={a.key} className="flex items-center gap-1.5">
          <span className="w-3 font-mono text-[9px] text-nexus-text-muted">{a.label}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full" style={{ width: `${scores[a.key] * 100}%`, background: color }} />
          </div>
          <span className="w-5 text-right font-mono text-[9px]" style={{ color }}>{(scores[a.key] * 100).toFixed(0)}</span>
        </div>
      ))}
    </div>
  );
}

export function FutureCards() {
  const mode = useCommandStore((s) => s.mode);
  const selectedCoa = useCommandStore((s) => s.selectedCoa);
  const selectCoa = useCommandStore((s) => s.selectCoa);
  const committed = useCommandStore((s) => s.committed);
  const setCommitOpen = useCommandStore((s) => s.setCommitOpen);

  if (mode !== "highpressure" || committed) return null;

  return (
    <div className="pointer-events-none absolute bottom-16 left-1/2 z-20 w-full max-w-[760px] -translate-x-1/2 px-3">
      <div className="mb-1.5 flex items-center justify-center gap-1.5">
        <GitFork size={12} className="text-[#e8724a]" />
        <span className="font-mono text-[10px] tracking-wider text-nexus-text-secondary">
          G-A 主攻群分叉 · 3 条合格未来 · 取舍轴 = 地形上可量的距离/角度/面积
        </span>
      </div>
      <div className="pointer-events-auto grid grid-cols-3 gap-2">
        {COAS.map((coa) => {
          const isSel = selectedCoa === coa.id;
          return (
            <div
              key={coa.id}
              onClick={() => selectCoa(coa.id)}
              className={cn(
                "cursor-pointer rounded-lg border bg-nexus-bg-surface/92 p-2.5 backdrop-blur-md transition-all",
                isSel ? "scale-[1.02] shadow-lg" : "hover:bg-nexus-bg-surface",
              )}
              style={{ borderColor: isSel ? coa.color : "rgba(255,255,255,0.06)" }}
            >
              {/* 头 */}
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold" style={{ color: coa.color }}>{coa.label}</span>
                {isSel && <Check size={13} style={{ color: coa.color }} />}
              </div>

              {/* ① 预测结局 */}
              <p className="mt-1 text-[10px] leading-snug text-nexus-text-primary">{coa.card.outcome}</p>
              <p className="mt-0.5 font-mono text-[9px]" style={{ color: coa.color }}>{coa.card.keyFigure}</p>

              {/* ② 共享取舍尺 */}
              <div className="mt-1.5 border-t border-white/[0.06] pt-1.5">
                <TradeoffRuler scores={coa.card.scores} color={coa.color} />
              </div>

              {/* ③ 反事实常驻灰字 */}
              <p className="mt-1.5 text-[8.5px] leading-tight text-nexus-text-muted">
                <span className="text-nexus-text-secondary">反事实 </span>{coa.card.counterfactual}
              </p>

              {/* ④ 失败后果红字 + 证据缺口 */}
              <p className="mt-1 text-[8.5px] leading-tight text-[#dc6a6a]">
                失败：{coa.card.failure}
              </p>
              <p className="mt-0.5 text-[8px] leading-tight text-[#d4932a]">
                缺口：{coa.card.evidenceGap}
              </p>

              {isSel && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setCommitOpen(true);
                  }}
                  className="mt-2 w-full rounded-md py-1 text-[10px] font-semibold text-nexus-bg-base"
                  style={{ background: coa.color }}
                >
                  以此未来裁决 →
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
