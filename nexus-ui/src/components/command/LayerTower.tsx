"use client";

import { useCommandStore, type CommandLayers, type Conservatism } from "@/stores/command-store";
import { THREAT_GROUPS } from "@/lib/command-data";
import { cn } from "@/lib/utils";
import { Layers, Eye, EyeOff, ChevronDown, Gauge } from "lucide-react";

const LAYER_DEFS: { key: keyof CommandLayers; label: string }[] = [
  { key: "tracks", label: "原始航迹" },
  { key: "groups", label: "威胁群" },
  { key: "assets", label: "我方资产" },
  { key: "geo", label: "地理约束" },
  { key: "prediction", label: "预测几何" },
];

const CONS_DEFS: { key: Conservatism; label: string }[] = [
  { key: "aggressive", label: "灵敏" },
  { key: "balanced", label: "均衡" },
  { key: "conservative", label: "保守" },
];

export function LayerTower() {
  const layers = useCommandStore((s) => s.layers);
  const toggleLayer = useCommandStore((s) => s.toggleLayer);
  const conservatism = useCommandStore((s) => s.conservatism);
  const setConservatism = useCommandStore((s) => s.setConservatism);
  const expanded = useCommandStore((s) => s.compressionExpanded);
  const setExpanded = useCommandStore((s) => s.setCompressionExpanded);

  const totalTracks = THREAT_GROUPS.reduce((a, g) => a + g.trackCount, 0);

  return (
    <aside className="z-20 flex w-[180px] flex-col gap-2 p-2">
      {/* 图层塔 */}
      <div className="rounded-lg border border-white/[0.06] bg-nexus-bg-surface/85 p-2 backdrop-blur-md">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Layers size={12} className="text-nexus-text-secondary" />
          <span className="font-mono text-[10px] font-semibold tracking-wider text-nexus-text-secondary">图层塔</span>
        </div>
        <div className="space-y-0.5">
          {LAYER_DEFS.map((l) => (
            <button
              key={l.key}
              onClick={() => toggleLayer(l.key)}
              className="flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-white/[0.04]"
            >
              <span className={layers[l.key] ? "text-nexus-text-primary" : "text-nexus-text-muted"}>{l.label}</span>
              {layers[l.key] ? <Eye size={12} className="text-[#5b9bd5]" /> : <EyeOff size={12} className="text-nexus-text-muted" />}
            </button>
          ))}
        </div>
      </div>

      {/* 保守度档位 */}
      <div className="rounded-lg border border-white/[0.06] bg-nexus-bg-surface/85 p-2 backdrop-blur-md">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Gauge size={12} className="text-nexus-text-secondary" />
          <span className="font-mono text-[10px] font-semibold tracking-wider text-nexus-text-secondary">保守度档位</span>
        </div>
        <div className="flex overflow-hidden rounded-md border border-white/[0.06]">
          {CONS_DEFS.map((c) => (
            <button
              key={c.key}
              onClick={() => setConservatism(c.key)}
              className={cn(
                "flex-1 py-1 text-[10px] transition-colors",
                conservatism === c.key ? "bg-[#5b9bd5]/15 text-[#5b9bd5]" : "text-nexus-text-muted hover:bg-white/[0.04]",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[8.5px] leading-tight text-nexus-text-muted">岔路判定灵敏度 · 显式委托</p>
      </div>

      {/* 压缩比尺 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="rounded-lg border border-white/[0.06] bg-nexus-bg-surface/85 p-2 text-left backdrop-blur-md transition-colors hover:bg-white/[0.04]"
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] font-semibold tracking-wider text-nexus-text-secondary">压缩比尺</span>
          <ChevronDown size={12} className={cn("text-nexus-text-muted transition-transform", expanded && "rotate-180")} />
        </div>
        <div className="mt-1 flex items-center gap-1 font-mono text-[11px]">
          <span className="text-nexus-text-primary">{totalTracks}</span>
          <span className="text-nexus-text-muted">→</span>
          <span className="text-nexus-text-primary">{THREAT_GROUPS.length}</span>
          <span className="text-nexus-text-muted">→</span>
          <span className="text-[#5b9bd5]">3</span>
          <span className="ml-1 text-[8.5px] text-nexus-text-muted">迹/群/COA</span>
        </div>
        {expanded && (
          <div className="mt-1.5 space-y-0.5 border-t border-white/[0.06] pt-1.5 text-[9px] text-nexus-text-muted">
            <div>· {totalTracks} 原始航迹 → 融合</div>
            <div>· {THREAT_GROUPS.length} 威胁群 → 研判排序</div>
            <div>· 3 COA 合格未来 → 待裁</div>
            <div className="text-[#5b9bd5]">点群/卡可逐层下钻原始量</div>
          </div>
        )}
      </button>
    </aside>
  );
}
