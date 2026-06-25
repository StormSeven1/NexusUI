"use client";

import { useEffect, useState } from "react";
import { useCommandStore } from "@/stores/command-store";
import { cn } from "@/lib/utils";
import { MessageSquare, Send, Activity, AlertTriangle } from "lucide-react";

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TopBar() {
  const mode = useCommandStore((s) => s.mode);
  const windowSec = useCommandStore((s) => s.windowSec);
  const tickWindow = useCommandStore((s) => s.tickWindow);
  const enterHighPressure = useCommandStore((s) => s.enterHighPressure);
  const exitHighPressure = useCommandStore((s) => s.exitHighPressure);
  const copilotOpen = useCommandStore((s) => s.copilotOpen);
  const setCopilotOpen = useCommandStore((s) => s.setCopilotOpen);

  const high = mode === "highpressure";
  const urgent = high && windowSec <= 60;

  useEffect(() => {
    if (!high) return;
    const id = setInterval(tickWindow, 1000);
    return () => clearInterval(id);
  }, [high, tickWindow]);

  return (
    <header className="pointer-events-auto relative z-30 flex h-[46px] items-center gap-3 border-b border-white/[0.06] bg-nexus-bg-surface/85 px-3 backdrop-blur-md">
      <span className="text-sm font-semibold text-nexus-text-primary">指挥员作战屏</span>
      <span className="text-xs text-nexus-text-muted">要地一号 · 七号责任区</span>

      {/* 窗口倒计时 */}
      <div
        className={cn(
          "flex items-center gap-1.5 rounded px-2 py-1 font-mono text-xs transition-all",
          high
            ? urgent
              ? "scale-105 border border-[#dc2626] bg-[#dc2626]/20 text-[#dc2626] animate-pulse-glow"
              : "border border-[#d4932a]/50 bg-[#d4932a]/10 text-[#d4932a]"
            : "border border-white/[0.06] text-nexus-text-muted",
        )}
      >
        {high ? <AlertTriangle size={12} /> : <Activity size={12} />}
        {high ? `裁决窗口 ${fmt(windowSec)}` : "节奏 · 监视态"}
      </div>

      <div className="flex-1" />

      {/* 优势环快慢相位 */}
      <div className="hidden items-center gap-1.5 lg:flex">
        <span className="text-[10px] text-nexus-text-muted">优势环</span>
        <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-[#5b9bd5]">快环 · 研判</span>
        <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-nexus-text-secondary">慢环 · 学习飞轮</span>
      </div>

      {/* 指挥员 */}
      <div className="hidden items-center gap-2 border-l border-white/[0.06] pl-3 md:flex">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#3bb87a]/15 font-mono text-[10px] font-bold text-[#3bb87a]">指</div>
        <div className="leading-tight">
          <div className="text-[11px] text-nexus-text-primary">值班指挥员 · 上校 周</div>
          <div className="text-[9px] text-nexus-text-muted">裁决权威 · 三级</div>
        </div>
      </div>

      {/* 意图条入口 */}
      <button
        onClick={() => setCopilotOpen(!copilotOpen)}
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
          copilotOpen
            ? "border-[#5b9bd5]/50 bg-[#5b9bd5]/10 text-[#5b9bd5]"
            : "border-white/[0.08] text-nexus-text-secondary hover:bg-white/[0.04]",
        )}
      >
        <MessageSquare size={13} />
        <span className="hidden sm:inline">向 AI 副驾下发意图…</span>
        <Send size={11} className="opacity-60" />
      </button>

      {/* 演示：两态切换 */}
      <button
        onClick={high ? exitHighPressure : enterHighPressure}
        title={high ? "退出蜂群高压裁决态，回到日常监视态" : "演示入口：进入蜂群高压裁决态，主攻群将分叉出 3 条可裁决未来"}
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all",
          high
            ? "border-white/[0.12] text-nexus-text-secondary hover:bg-white/[0.04]"
            : "border-[#dc2626] bg-[#dc2626]/15 text-[#dc2626] hover:bg-[#dc2626]/25 animate-pulse-glow",
        )}
      >
        {high ? <Activity size={13} /> : <AlertTriangle size={13} />}
        {high ? "退出高压态" : "进入蜂群高压态"}
      </button>
    </header>
  );
}
