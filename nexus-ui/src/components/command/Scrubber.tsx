"use client";

import { useEffect, useRef } from "react";
import { useCommandStore } from "@/stores/command-store";
import { COAS, COA_ACTION_LABEL } from "@/lib/command-data";
import { Play, Pause, RotateCcw } from "lucide-react";

export function Scrubber() {
  const mode = useCommandStore((s) => s.mode);
  const committed = useCommandStore((s) => s.committed);
  const selectedCoa = useCommandStore((s) => s.selectedCoa);
  const scrubT = useCommandStore((s) => s.scrubT);
  const setScrubT = useCommandStore((s) => s.setScrubT);
  const playing = useCommandStore((s) => s.playing);
  const setPlaying = useCommandStore((s) => s.setPlaying);
  const rafRef = useRef<number>(0);
  const lastRef = useRef<number>(0);

  useEffect(() => {
    if (!playing) return;
    lastRef.current = performance.now();
    const step = (now: number) => {
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      const next = useCommandStore.getState().scrubT + dt / 6; // 6s 播完 180s
      if (next >= 1) {
        setScrubT(1);
        setPlaying(false);
        return;
      }
      setScrubT(next);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, setScrubT, setPlaying]);

  if (mode !== "highpressure" || !selectedCoa) return null;

  const coa = COAS.find((c) => c.id === selectedCoa);
  const tPlus = Math.round(scrubT * 180);
  const interceptT = coa?.intercept.t ?? 0.5;

  return (
    <div className="absolute left-[44px] right-[248px] top-[47px] z-20 px-3">
      <div className="rounded-lg border border-white/[0.06] bg-nexus-bg-surface/92 p-2.5 backdrop-blur-md">
        <div className="mb-1.5 flex items-center gap-2">
          <button
            onClick={() => setPlaying(!playing)}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.1] text-nexus-text-primary transition-colors hover:bg-white/[0.05]"
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button
            onClick={() => {
              setPlaying(false);
              setScrubT(0);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.1] text-nexus-text-muted transition-colors hover:bg-white/[0.05]"
          >
            <RotateCcw size={12} />
          </button>
          <span className="font-mono text-xs" style={{ color: coa?.color }}>
            {committed ? "执行推演" : "签订前预演"} {coa?.label}
          </span>
          <span className="rounded border border-[#dc2626]/50 bg-[#dc2626]/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#dc2626]">
            推演 T+{tPlus}秒 · 非现实
          </span>
          <span className="ml-auto font-mono text-[9px] text-nexus-text-muted">
            {committed ? "已签订 · 按授权包络执行" : "拖拽预演结局 → 满意后签订执行"}
          </span>
        </div>

        {/* 时间轴 */}
        <div className="relative">
          <input
            type="range"
            min={0}
            max={1000}
            value={scrubT * 1000}
            onChange={(e) => {
              setPlaying(false);
              setScrubT(Number(e.target.value) / 1000);
            }}
            className="cmd-scrub w-full"
            style={{ accentColor: coa?.color }}
          />
          {/* 拦截窗标记 */}
          <div
            className="pointer-events-none absolute -top-0.5 h-3 w-0.5 bg-[#facc15]"
            style={{ left: `${interceptT * 100}%` }}
            title="拦截窗"
          />
          {/* 我方资产处置事件标记 */}
          {coa?.tasks.map((t) => {
            const acted = scrubT >= t.actAtT;
            return (
              <div
                key={t.assetId}
                className="pointer-events-none absolute -bottom-1 h-2 w-0.5 rounded-full"
                style={{ left: `${t.actAtT * 100}%`, background: acted ? coa.color : "rgba(255,255,255,0.25)" }}
                title={`${t.assetName} · ${COA_ACTION_LABEL[t.action]} · T+${Math.round(t.actAtT * 180)}秒`}
              />
            );
          })}
        </div>
        <div className="mt-0.5 flex justify-between font-mono text-[8.5px] text-nexus-text-muted">
          <span>T+0</span>
          <span className="text-[#facc15]">拦截 T+{coa?.intercept.countdownSec}秒</span>
          <span>T+180秒</span>
        </div>

        {/* 当前处置编排（按时间推进逐项点亮） */}
        <div className="mt-1.5 flex flex-wrap gap-1 border-t border-white/[0.06] pt-1.5">
          {coa?.tasks.map((t) => {
            const acted = scrubT >= t.actAtT;
            return (
              <span
                key={t.assetId}
                className="rounded px-1.5 py-0.5 font-mono text-[8.5px] transition-colors"
                style={{
                  background: acted ? `${coa.color}1f` : "rgba(255,255,255,0.04)",
                  color: acted ? coa.color : "var(--nexus-text-muted, #6b7280)",
                  border: `1px solid ${acted ? coa.color + "66" : "transparent"}`,
                }}
                title={t.note}
              >
                T+{Math.round(t.actAtT * 180)}s · {t.assetName} · {t.role} · {t.cost}
              </span>
            );
          })}
        </div>
      </div>
      <style jsx global>{`
        .cmd-scrub { height: 4px; -webkit-appearance: none; appearance: none; background: rgba(255,255,255,0.08); border-radius: 4px; }
        .cmd-scrub::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: #d4d4d8; cursor: pointer; }
      `}</style>
    </div>
  );
}
