"use client";

import { useState } from "react";
import { useCommandStore } from "@/stores/command-store";
import { THREAT_GROUPS, CMD_ASSETS, EVIDENCE_CHAINS, type EvidenceNode } from "@/lib/command-data";
import { FORCE_COLORS, FORCE_LABELS } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { X, Repeat, Flag, Plus, ChevronRight } from "lucide-react";

const STAGE_LABEL: Record<EvidenceNode["stage"], string> = {
  observation: "观测",
  fusion: "融合",
  trust: "信任",
  hypothesis: "假设",
};

function EvidenceChain({ groupId }: { groupId: string }) {
  const chain = EVIDENCE_CHAINS[groupId];
  const [open, setOpen] = useState<number | null>(0);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());

  if (!chain) {
    return <p className="px-1 py-3 text-center text-[10px] text-nexus-text-muted">该对象证据链未采集（demo）。</p>;
  }

  return (
    <div className="space-y-1">
      {chain.map((n, i) => {
        const isOpen = open === i;
        const isFlagged = flagged.has(i);
        return (
          <div key={i} className="rounded-md border border-white/[0.06] bg-white/[0.02]">
            <button onClick={() => setOpen(isOpen ? null : i)} className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left">
              <ChevronRight size={11} className={cn("text-nexus-text-muted transition-transform", isOpen && "rotate-90")} />
              <span className="rounded bg-white/[0.06] px-1 font-mono text-[8.5px] text-nexus-text-secondary">{STAGE_LABEL[n.stage]}</span>
              <span className="text-[10.5px] text-nexus-text-primary">{n.title}</span>
              <span className="ml-auto font-mono text-[9px] text-nexus-text-muted">{(n.confidence * 100).toFixed(0)}%</span>
            </button>
            {isOpen && (
              <div className="border-t border-white/[0.06] px-2.5 py-1.5">
                <p className="text-[9.5px] leading-snug text-nexus-text-secondary">{n.detail}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[8.5px] text-nexus-text-muted">
                  <span>源 {n.provenance}</span>
                  <span>{n.time}</span>
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  <button className="flex items-center gap-1 rounded border border-white/[0.08] px-1.5 py-0.5 text-[9px] text-[#5b9bd5] hover:bg-white/[0.04]">
                    <Repeat size={9} /> 复跑 replay
                  </button>
                  <button
                    onClick={() =>
                      setFlagged((s) => {
                        const next = new Set(s);
                        next.has(i) ? next.delete(i) : next.add(i);
                        return next;
                      })
                    }
                    className={cn(
                      "flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px]",
                      isFlagged ? "border-[#dc2626]/50 bg-[#dc2626]/10 text-[#dc2626]" : "border-white/[0.08] text-nexus-text-muted hover:bg-white/[0.04]",
                    )}
                  >
                    <Flag size={9} /> {isFlagged ? "已标错·入评估样本" : "标记判错"}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <p className="px-1 pt-1 text-[8.5px] text-nexus-text-muted">标错 → 落评估样本 → 经阶段门禁喂回学习飞轮，改进下一轮模型。</p>
    </div>
  );
}

export function Placard() {
  const selected = useCommandStore((s) => s.selected);
  const selectObject = useCommandStore((s) => s.selectObject);
  const placardTab = useCommandStore((s) => s.placardTab);
  const setPlacardTab = useCommandStore((s) => s.setPlacardTab);

  if (!selected) return null;

  if (selected.kind === "asset") {
    const a = CMD_ASSETS.find((x) => x.id === selected.id);
    if (!a) return null;
    return (
      <Shell onClose={() => selectObject(null)} title={a.name} sub={`${a.type} · ${a.status}`}>
        <div className="space-y-1 font-mono text-[10px] text-nexus-text-secondary">
          <Row k="状态" v={a.status === "online" ? "在线" : a.status === "degraded" ? "衰减" : "离线"} />
          {a.rangeKm && <Row k="覆盖" v={`${a.rangeKm} km`} />}
          <Row k="坐标" v={`${a.lat.toFixed(3)}, ${a.lng.toFixed(3)}`} />
        </div>
      </Shell>
    );
  }

  const g = THREAT_GROUPS.find((x) => x.id === selected.id);
  if (!g) return null;
  const color = FORCE_COLORS[g.disposition];
  const lowTrust = g.trust !== "trusted";

  return (
    <Shell onClose={() => selectObject(null)} title={g.name} sub={`${FORCE_LABELS[g.disposition]} · ${g.trackCount} 航迹 · 威胁 ${(g.threat * 100).toFixed(0)}`} accent={color}>
      {/* 信任标 */}
      <div className="mb-2 flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 font-mono text-[9px]"
          style={{
            color: lowTrust ? "#d4932a" : "#3bb87a",
            background: lowTrust ? "rgba(212,147,42,0.12)" : "rgba(59,184,122,0.12)",
          }}
        >
          信任 {g.trust === "trusted" ? "trusted" : g.trust === "pending" ? "待补证（禁入授权依据）" : "禁入"}
        </span>
      </div>

      {/* tabs */}
      <div className="mb-2 flex gap-1 border-b border-white/[0.06]">
        {(["info", "source", "evidence"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setPlacardTab(t)}
            className={cn(
              "px-2 py-1 text-[10px] transition-colors",
              placardTab === t ? "border-b-2 text-nexus-text-primary" : "text-nexus-text-muted hover:text-nexus-text-secondary",
            )}
            style={{ borderColor: placardTab === t ? color : "transparent" }}
          >
            {t === "info" ? "信息" : t === "source" ? "信息源" : "证据链"}
          </button>
        ))}
      </div>

      {placardTab === "info" && (
        <div className="space-y-1">
          <p className="text-[10.5px] leading-snug text-nexus-text-secondary">{g.summary}</p>
          {g.decoy && <p className="text-[10px] text-[#d4932a]">机器判为诱饵（可下钻证据链质疑/夺回）。</p>}
        </div>
      )}
      {placardTab === "source" && (
        <div className="space-y-1 font-mono text-[10px] text-nexus-text-secondary">
          <Row k="主源" v={g.trust === "pending" ? "RF-1 单源" : "雷达 Alpha + EO-2"} />
          <Row k="质心" v={`${g.lat.toFixed(3)}, ${g.lng.toFixed(3)}`} />
          <Row k="航迹数" v={`${g.trackCount}`} />
        </div>
      )}
      {placardTab === "evidence" && <EvidenceChain groupId={g.id} />}

      {/* 一键补证 */}
      {lowTrust && (
        <button className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-[#5b9bd5]/40 bg-[#5b9bd5]/10 py-1.5 text-[11px] font-medium text-[#5b9bd5] transition-colors hover:bg-[#5b9bd5]/20">
          <Plus size={12} /> 一键补证 · 调 EO-2 / RF-1 二次确认
        </button>
      )}
    </Shell>
  );
}

function Shell({ onClose, title, sub, accent, children }: { onClose: () => void; title: string; sub: string; accent?: string; children: React.ReactNode }) {
  return (
    <div className="absolute bottom-16 right-[196px] z-30 w-[300px] animate-fade-in rounded-xl border bg-nexus-bg-surface/95 p-3 shadow-2xl backdrop-blur-md" style={{ borderColor: accent ? `${accent}55` : "rgba(255,255,255,0.08)" }}>
      <div className="mb-2 flex items-start justify-between">
        <div>
          <div className="text-[13px] font-semibold" style={{ color: accent ?? "#d4d4d8" }}>{title}</div>
          <div className="font-mono text-[9px] text-nexus-text-muted">{sub}</div>
        </div>
        <button onClick={onClose} className="text-nexus-text-muted hover:text-nexus-text-primary">
          <X size={14} />
        </button>
      </div>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-nexus-text-muted">{k}</span>
      <span className="text-nexus-text-primary">{v}</span>
    </div>
  );
}
