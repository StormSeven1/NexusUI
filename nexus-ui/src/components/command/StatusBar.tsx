"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Radio, SignalLow, History, Clock } from "lucide-react";

export function StatusBar() {
  const [now, setNow] = useState("--:--:--");
  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toLocaleTimeString("zh-CN", { hour12: false })), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <footer className="relative z-30 flex h-[26px] items-center gap-4 border-t border-white/[0.06] bg-nexus-bg-surface/85 px-3 font-mono text-[10px] text-nexus-text-secondary backdrop-blur-md">
      {/* 类型墙盾（降为状态栏小盾） */}
      <div className="flex items-center gap-1 text-[#3bb87a]" title="类型墙：0 进入授权计数 · 三层墙守卫中">
        <ShieldCheck size={12} />
        <span>盾 守卫中</span>
      </div>
      <div className="flex items-center gap-1">
        <Radio size={11} className="text-[#5b9bd5]" />
        <span>链路 OK · 时延 42ms</span>
      </div>
      <div className="flex items-center gap-1 text-[#d4932a]">
        <SignalLow size={11} />
        <span>降级档 · Charlie 衰减</span>
      </div>
      <div className="flex-1" />
      <button className="flex items-center gap-1 text-nexus-text-muted transition-colors hover:text-nexus-text-secondary" title="断链/受控停止/复盘 — P0 占位">
        <History size={11} />
        <span>全链回放</span>
      </button>
      <div className="flex items-center gap-1">
        <Clock size={11} />
        <span>{now} UTC+8</span>
      </div>
    </footer>
  );
}
