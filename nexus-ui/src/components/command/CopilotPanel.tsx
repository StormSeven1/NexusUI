"use client";

import { useState, useRef, useEffect } from "react";
import { useCommandStore } from "@/stores/command-store";
import { cn } from "@/lib/utils";
import { X, Send, Sparkles, Lock, MapPin, GitBranch, Search } from "lucide-react";

const ARTIFACT_META = {
  answer: { icon: MapPin, label: "答复 + 地图定位", color: "#5b9bd5" },
  intent: { icon: GitBranch, label: "指挥意图 → 责任链", color: "#3bb87a" },
  analysis: { icon: Search, label: "分析 → 假设/证据/补证", color: "#d4932a" },
} as const;

const QUICK = ["现在有哪些资产可用？", "群3 为什么判诱饵？", "加强东侧低空、优先确认低慢小", "查清 群4 这个不明群"];

export function CopilotPanel() {
  const open = useCommandStore((s) => s.copilotOpen);
  const setOpen = useCommandStore((s) => s.setCopilotOpen);
  const messages = useCommandStore((s) => s.copilotMessages);
  const send = useCommandStore((s) => s.sendCopilot);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const submit = () => {
    if (!text.trim()) return;
    send(text.trim());
    setText("");
  };

  if (!open) {
    const latest = messages[messages.length - 1];
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute right-2 top-[52px] z-30 flex w-[180px] items-center gap-1.5 rounded-lg border border-[#5b9bd5]/30 bg-nexus-bg-surface/90 px-2 py-1.5 text-left backdrop-blur-md transition-colors hover:bg-nexus-bg-surface"
      >
        <Sparkles size={13} className="shrink-0 text-[#5b9bd5]" />
        <span className="line-clamp-1 text-[9.5px] text-nexus-text-secondary">{latest?.text ?? "AI 副驾 · 召唤式频道"}</span>
      </button>
    );
  }

  return (
    <div className="absolute right-2 top-[52px] bottom-9 z-30 flex w-[300px] flex-col rounded-xl border border-white/[0.08] bg-nexus-bg-surface/95 backdrop-blur-md animate-slide-in-right">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} className="text-[#5b9bd5]" />
          <span className="text-xs font-semibold text-nexus-text-primary">AI 副驾</span>
          <span className="rounded bg-white/[0.06] px-1 font-mono text-[8px] text-nexus-text-muted">影子位 · 够不到权威</span>
        </div>
        <button onClick={() => setOpen(false)} className="text-nexus-text-muted hover:text-nexus-text-primary">
          <X size={14} />
        </button>
      </div>

      {/* 消息流 */}
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map((m) => {
          const isCmd = m.role === "commander";
          const meta = m.artifact ? ARTIFACT_META[m.artifact] : null;
          return (
            <div key={m.id} className={cn("flex flex-col", isCmd ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[88%] rounded-lg px-2.5 py-1.5 text-[11px] leading-snug",
                  isCmd ? "bg-[#5b9bd5]/15 text-nexus-text-primary" : "border border-white/[0.06] bg-white/[0.02] text-nexus-text-secondary",
                )}
              >
                {m.text}
              </div>
              {meta && (
                <div className="mt-0.5 flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[8px]" style={{ color: meta.color }}>
                  <meta.icon size={9} />
                  {meta.label}
                </div>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* 快捷 */}
      <div className="flex flex-wrap gap-1 px-2 pb-1.5">
        {QUICK.map((q) => (
          <button
            key={q}
            onClick={() => send(q)}
            className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[9px] text-nexus-text-muted transition-colors hover:bg-white/[0.04] hover:text-nexus-text-secondary"
          >
            {q}
          </button>
        ))}
      </div>

      {/* 输入 + 护栏 */}
      <div className="border-t border-white/[0.06] p-2">
        <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-nexus-bg-base/60 px-2 py-1.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="了解 / 下发意图 / 分析不明…"
            className="flex-1 bg-transparent text-[11px] text-nexus-text-primary outline-none placeholder:text-nexus-text-muted"
          />
          <button onClick={submit} className="text-[#5b9bd5] hover:text-[#7ab4e6]">
            <Send size={13} />
          </button>
        </div>
        <p className="mt-1 flex items-center gap-1 text-[8px] text-nexus-text-muted">
          <Lock size={9} /> 受工具白名单约束 · 写不进授权 · 高风险走责任链
        </p>
      </div>
    </div>
  );
}
