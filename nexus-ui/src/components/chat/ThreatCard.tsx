"use client";

import { NxCard } from "@/components/nexus";
import { cn } from "@/lib/utils";
import { ShieldAlert, AlertTriangle, AlertCircle, Shield } from "lucide-react";

interface ThreatItem {
  trackId: string;
  name: string;
  typeLabel: string;
  dispositionLabel: string;
  score: number;
  level: string;
  levelLabel: string;
  reasons: string[];
  speed: number;
  nearestZone?: string;
  nearestZoneDist?: number | null;
}

interface ThreatCardProps {
  threats: ThreatItem[];
  totalAssessed: number;
  summary: Record<string, number>;
}

const LEVEL_STYLES: Record<string, { color: string; bg: string; Icon: typeof ShieldAlert }> = {
  critical: { color: "text-red-400", bg: "bg-red-500/10", Icon: ShieldAlert },
  high:     { color: "text-orange-400", bg: "bg-orange-500/10", Icon: AlertTriangle },
  medium:   { color: "text-amber-400", bg: "bg-amber-500/10", Icon: AlertCircle },
  low:      { color: "text-zinc-400", bg: "bg-zinc-500/10", Icon: Shield },
};

export function ThreatCard({ threats, totalAssessed, summary }: ThreatCardProps) {
  return (
    <NxCard padding="sm" className="my-1.5">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded bg-red-500/10">
          <ShieldAlert size={11} className="text-red-400" />
        </div>
        <span className="text-[10px] font-semibold tracking-wider text-nexus-text-secondary uppercase">
          威胁评估
        </span>
        <span className="ml-auto text-[10px] text-nexus-text-muted">
          共评估 {totalAssessed} 个目标
        </span>
      </div>

      {/* 摘要统计 */}
      <div className="mb-2 flex gap-2">
        {(["critical", "high", "medium", "low"] as const).map((level) => {
          const count = summary[level] ?? 0;
          if (count === 0) return null;
          const style = LEVEL_STYLES[level];
          return (
            <div key={level} className={cn("flex items-center gap-1 rounded px-1.5 py-0.5", style.bg)}>
              <span className={cn("text-[10px] font-bold", style.color)}>{count}</span>
              <span className="text-[9px] text-nexus-text-muted">
                {level === "critical" ? "极高" : level === "high" ? "高" : level === "medium" ? "中" : "低"}
              </span>
            </div>
          );
        })}
      </div>

      {/* 威胁列表 */}
      <div className="space-y-1.5">
        {threats.map((t) => {
          const style = LEVEL_STYLES[t.level] ?? LEVEL_STYLES.low;
          const Icon = style.Icon;
          return (
            <div
              key={t.trackId}
              className={cn(
                "flex items-start gap-2 rounded-md border border-white/[0.04] px-2 py-1.5",
                style.bg,
              )}
            >
              <Icon size={13} className={cn("mt-0.5 shrink-0", style.color)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-nexus-text-primary">{t.name}</span>
                  <span className="font-mono text-[10px] text-nexus-text-muted">{t.trackId}</span>
                  <span className={cn("ml-auto rounded px-1 py-0.5 text-[9px] font-bold", style.color, style.bg)}>
                    {t.levelLabel} {t.score}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10px] text-nexus-text-secondary">
                  <span>{t.typeLabel} · {t.dispositionLabel}</span>
                  <span>速度 {t.speed}km/h</span>
                </div>
                {t.reasons.length > 0 && (
                  <p className="mt-0.5 text-[10px] leading-relaxed text-nexus-text-muted">
                    {t.reasons.join("；")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </NxCard>
  );
}
