"use client";

import { MOCK_TRACKS, MOCK_ASSETS, MOCK_ALERTS } from "@/lib/mock-data";
import { FORCE_LABELS, type ForceDisposition } from "@/lib/colors";
import { cn } from "@/lib/utils";
import {
  Plane,
  Ship,
  Anchor,
  AlertTriangle,
  AlertCircle,
  Info,
  Activity,
  Shield,
  Radio,
  Wifi,
} from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import {
  NxPanelHeader,
  NxSectionHeader,
  NxStatCard,
  NxCard,
  NxProgress,
  NxStatusDot,
} from "@/components/nexus";

const DISPOSITION_DOT: Record<ForceDisposition, string> = {
  hostile: "bg-orange-400",
  friendly: "bg-sky-400",
  neutral: "bg-zinc-400",
};

const TYPE_ICONS = {
  air: Plane,
  sea: Ship,
  underwater: Anchor,
} as const;

export function SituationOverview() {
  const { selectTrack } = useAppStore();

  const dispositionCounts = MOCK_TRACKS.reduce(
    (acc, t) => {
      acc[t.disposition] = (acc[t.disposition] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const typeCounts = MOCK_TRACKS.reduce(
    (acc, t) => {
      acc[t.type] = (acc[t.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const onlineAssets = MOCK_ASSETS.filter((a) => a.status === "online").length;
  const degradedAssets = MOCK_ASSETS.filter((a) => a.status === "degraded").length;
  const criticalAlerts = MOCK_ALERTS.filter((a) => a.severity === "critical").length;
  const warningAlerts = MOCK_ALERTS.filter((a) => a.severity === "warning").length;

  return (
    <div className="flex h-full flex-col">
      <NxPanelHeader title="态势概览" />

      <div className="flex-1 overflow-y-auto">
        {/* 摘要卡片 */}
        <div className="border-b border-white/[0.06] p-4">
          <NxSectionHeader className="mb-3">态势摘要</NxSectionHeader>
          <div className="grid grid-cols-2 gap-2">
            <NxStatCard
              icon={<Activity size={12} />}
              label="监控航迹"
              value={MOCK_TRACKS.length}
              sub={`${MOCK_TRACKS.filter((t) => t.starred).length} 重点关注`}
            />
            <NxStatCard
              icon={<Shield size={12} />}
              label="威胁目标"
              value={dispositionCounts["hostile"] || 0}
              sub="敌方目标"
              highlight
            />
            <NxStatCard
              icon={<Radio size={12} />}
              label="传感器资产"
              value={MOCK_ASSETS.length}
              sub={`${onlineAssets} 在线${degradedAssets ? ` · ${degradedAssets} 降级` : ""}`}
            />
            <NxStatCard
              icon={<AlertTriangle size={12} />}
              label="活动告警"
              value={MOCK_ALERTS.length}
              sub={`${criticalAlerts} 严重 · ${warningAlerts} 警告`}
              highlight={criticalAlerts > 0}
            />
          </div>
        </div>

        {/* 航迹分布 */}
        <div className="border-b border-white/[0.06] p-4">
          <NxSectionHeader className="mb-3">航迹分布</NxSectionHeader>
          <div className="mb-3 space-y-1.5">
            {(
              ["hostile", "friendly", "neutral"] as ForceDisposition[]
            ).map((d) => {
              const count = dispositionCounts[d] || 0;
              if (count === 0) return null;
              const pct = (count / MOCK_TRACKS.length) * 100;
              return (
                <div key={d} className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", DISPOSITION_DOT[d])} />
                  <span className="w-16 text-[10px] text-nexus-text-secondary">{FORCE_LABELS[d]}</span>
                  <div className="flex-1">
                    <NxProgress value={pct} color={cn(DISPOSITION_DOT[d], "opacity-60")} />
                  </div>
                  <span className="w-5 text-right font-mono text-[10px] text-nexus-text-primary">{count}</span>
                </div>
              );
            })}
          </div>

          <NxCard padding="sm">
            <div className="flex items-center gap-3">
              {(["air", "sea", "underwater"] as const).map((type) => {
                const Icon = TYPE_ICONS[type];
                const count = typeCounts[type] || 0;
                const labels = { air: "空中", sea: "水面", underwater: "水下" };
                return (
                  <div key={type} className="flex items-center gap-1.5">
                    <Icon size={12} className="text-nexus-text-muted" />
                    <span className="text-[10px] text-nexus-text-secondary">{labels[type]}</span>
                    <span className="font-mono text-[10px] font-semibold text-nexus-text-primary">{count}</span>
                  </div>
                );
              })}
            </div>
          </NxCard>
        </div>

        {/* 实时告警 */}
        <div className="border-b border-white/[0.06] p-4">
          <NxSectionHeader className="mb-3">最新告警</NxSectionHeader>
          <div className="space-y-2">
            {MOCK_ALERTS.slice(0, 4).map((alert) => {
              const severity = {
                critical: { icon: AlertTriangle, color: "text-red-400" },
                warning: { icon: AlertCircle, color: "text-amber-400" },
                info: { icon: Info, color: "text-zinc-400" },
              }[alert.severity];
              const SevIcon = severity.icon;

              return (
                <NxCard
                  key={alert.id}
                  padding="sm"
                  hover
                  onClick={() => alert.trackId && selectTrack(alert.trackId)}
                >
                  <div className="flex items-start gap-2">
                    <SevIcon size={12} className={cn("mt-0.5 shrink-0", severity.color)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] leading-snug text-nexus-text-primary">{alert.message}</p>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="font-mono text-[10px] text-nexus-text-muted">{alert.timestamp}</span>
                        {alert.trackId && (
                          <span className="font-mono text-[10px] text-nexus-text-muted">→ {alert.trackId}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </NxCard>
              );
            })}
          </div>
        </div>

        {/* 系统状态 */}
        <div className="p-4">
          <NxSectionHeader className="mb-3">系统状态</NxSectionHeader>
          <div className="space-y-2">
            {[
              { label: "数据链路", ok: true },
              { label: "指挥网络", ok: true },
              { label: "雷达 Charlie", ok: false },
              { label: "GPS 信号", ok: true },
              { label: "加密通道", ok: true },
            ].map((s) => (
              <div key={s.label} className="flex items-center justify-between rounded border border-white/[0.04] bg-white/[0.02] px-2.5 py-1.5">
                <div className="flex items-center gap-2">
                  <Wifi size={10} className="text-nexus-text-muted" />
                  <span className="text-[11px] text-nexus-text-secondary">{s.label}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <NxStatusDot status={s.ok ? "online" : "warning"} animate={!s.ok} />
                  <span className={cn("text-[10px] font-medium", s.ok ? "text-emerald-400" : "text-amber-400")}>
                    {s.ok ? "正常" : "降级"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
