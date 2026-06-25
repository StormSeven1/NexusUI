"use client";

import { useEffect, useRef } from "react";
import { useCommandStore } from "@/stores/command-store";
import { COAS } from "@/lib/command-data";
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

  if (mode !== "highpressure" || !committed) return null;

  const coa = COAS.find((c) => c.id === selectedCoa);
  const tPlus = Math.round(scrubT * 180);
  const interceptT = coa?.intercept.t ?? 0.5;

  return (
    <div className="absolute bottom-16 left-1/2 z-20 w-full max-w-[680px] -translate-x-1/2 px-3">
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
            推演 {coa?.label}
          </span>
          <span className="rounded border border-[#dc2626]/50 bg-[#dc2626]/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#dc2626]">
            推演 T+{tPlus}秒 · 非现实
          </span>
          <span className="ml-auto font-mono text-[9px] text-nexus-text-muted">幽灵反事实方案 极淡常驻</span>
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
        </div>
        <div className="mt-0.5 flex justify-between font-mono text-[8.5px] text-nexus-text-muted">
          <span>T+0</span>
          <span className="text-[#facc15]">拦截 T+{coa?.intercept.countdownSec}秒</span>
          <span>T+180秒</span>
        </div>
      </div>
      <style jsx global>{`
        .cmd-scrub { height: 4px; -webkit-appearance: none; appearance: none; background: rgba(255,255,255,0.08); border-radius: 4px; }
        .cmd-scrub::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: #d4d4d8; cursor: pointer; }
      `}</style>
    </div>
  );
}
