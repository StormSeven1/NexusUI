"use client";

import { MOCK_ALERTS } from "@/lib/mock-data";
import { useAppStore } from "@/stores/app-store";
import { useAlertStore, type AlertData } from "@/stores/alert-store";
import { cn } from "@/lib/utils";
import { AlertTriangle, AlertCircle, Info, ExternalLink, Zap } from "lucide-react";

const SEVERITY_STYLES = {
  critical: {
    icon: AlertTriangle,
    border: "border-l-red-500",
    bg: "bg-red-500/5",
    iconColor: "text-red-400",
    label: "严重",
    labelColor: "text-red-400",
  },
  warning: {
    icon: AlertCircle,
    border: "border-l-amber-500",
    bg: "bg-amber-500/5",
    iconColor: "text-amber-400",
    label: "警告",
    labelColor: "text-amber-400",
  },
  info: {
    icon: Info,
    border: "border-l-zinc-500",
    bg: "bg-zinc-500/5",
    iconColor: "text-zinc-400",
    label: "信息",
    labelColor: "text-zinc-400",
  },
};

type SeverityKey = keyof typeof SEVERITY_STYLES;

interface UnifiedAlert {
  id: string;
  severity: SeverityKey;
  message: string;
  timestamp: string;
  trackId?: string;
  isRealtime?: boolean;
}

export function AlertPanel() {
  const { selectTrack } = useAppStore();
  const realtimeAlerts = useAlertStore((s) => s.alerts);

  const allAlerts: UnifiedAlert[] = [
    ...realtimeAlerts.map((a: AlertData) => ({
      ...a,
      severity: (a.severity in SEVERITY_STYLES ? a.severity : "info") as SeverityKey,
      isRealtime: true,
    })),
    ...MOCK_ALERTS.map((a) => ({ ...a, isRealtime: false })),
  ];

  const criticalCount = allAlerts.filter((a) => a.severity === "critical").length;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/[0.06] p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">
            告警中心
          </span>
          <span className="text-[10px] font-medium text-red-400">
            {criticalCount} 条严重
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {allAlerts.map((alert) => {
          const style = SEVERITY_STYLES[alert.severity];
          const Icon = style.icon;

          return (
            <div
              key={alert.id}
              className={cn(
                "border-b border-white/[0.03] border-l-2 px-3 py-3",
                style.border,
                style.bg
              )}
            >
              <div className="flex items-start gap-2">
                <Icon size={14} className={cn("mt-0.5 shrink-0", style.iconColor)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("text-[10px] font-bold", style.labelColor)}>
                      {style.label}
                    </span>
                    {alert.isRealtime && (
                      <Zap size={9} className="text-amber-400" />
                    )}
                    <span className="font-mono text-[10px] text-nexus-text-muted">
                      {alert.timestamp}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-nexus-text-primary">
                    {alert.message}
                  </p>
                  {alert.trackId && (
                    <button
                      onClick={() => selectTrack(alert.trackId!)}
                      className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-nexus-text-secondary hover:text-nexus-text-primary hover:underline"
                    >
                      <ExternalLink size={10} />
                      查看航迹 {alert.trackId}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
