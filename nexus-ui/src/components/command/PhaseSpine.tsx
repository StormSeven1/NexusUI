"use client";

import { useCommandStore } from "@/stores/command-store";
import { PHASES, DECISION_PACKETS } from "@/lib/command-data";
import { cn } from "@/lib/utils";

/** 最左相位脊（44px）：观研比承执评 + 决策脊状态点 */
export function PhaseSpine() {
  const mode = useCommandStore((s) => s.mode);
  const selectedCoa = useCommandStore((s) => s.selectedCoa);
  const committed = useCommandStore((s) => s.committed);

  // 当前相位：监视态停在 研，高压态滑到 比/承
  const activeIdx = mode === "monitor" ? 1 : committed ? 4 : selectedCoa ? 3 : 2;

  const statusColor: Record<string, string> = {
    active: "#d4932a",
    committed: "#5b9bd5",
    closed: "#52525b",
    queued: "#8b8b93",
  };

  return (
    <div className="pointer-events-auto flex h-full w-11 flex-col items-center border-r border-white/[0.06] bg-nexus-bg-surface/85 py-3 backdrop-blur-md">
      <span className="mb-2 font-mono text-[7px] leading-tight tracking-widest text-nexus-text-muted [writing-mode:vertical-rl]">
        决策相位
      </span>
      {/* 相位 */}
      <div className="flex flex-col items-center gap-2">
        {PHASES.map((p, i) => {
          const active = i === activeIdx;
          const passed = i < activeIdx;
          return (
            <div key={p.id} className="flex flex-col items-center">
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold transition-all",
                  active
                    ? "border-[#5b9bd5] bg-[#5b9bd5]/15 text-[#5b9bd5] animate-pulse-glow"
                    : passed
                      ? "border-white/[0.08] bg-white/[0.03] text-nexus-text-secondary"
                      : "border-white/[0.05] text-nexus-text-muted",
                )}
              >
                {p.label}
              </div>
              {i < PHASES.length - 1 && <div className={cn("h-2 w-px", passed ? "bg-[#5b9bd5]/40" : "bg-white/[0.06]")} />}
            </div>
          );
        })}
      </div>

      <div className="my-3 h-px w-5 bg-white/[0.06]" />

      {/* 决策脊 */}
      <div className="flex flex-1 flex-col items-center gap-1.5 overflow-hidden">
        <span className="font-mono text-[8px] tracking-widest text-nexus-text-muted">决策脊</span>
        {DECISION_PACKETS.map((d) => (
          <div
            key={d.id}
            title={`${d.id} ${d.title} · ${d.status}`}
            className="h-2 w-2 rounded-full"
            style={{
              background: statusColor[d.status],
              boxShadow: d.status === "active" ? `0 0 6px ${statusColor[d.status]}` : undefined,
            }}
          />
        ))}
      </div>
    </div>
  );
}
