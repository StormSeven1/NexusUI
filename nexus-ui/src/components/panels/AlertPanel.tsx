"use client";

/**
 * 告警面板 — 消费 alert-store 的实时数据。
 *
 * 【数据流】`useUnifiedWsFeed`（`alert_batch` / `map_command` alert / `alert`）经 `ws-alert-normalize` 归一化 → `addAlerts` → 本列表。
 */

import { useAppStore } from "@/stores/app-store";
import { useAlertStore, type AlertData } from "@/stores/alert-store";
import { useTrackStore, getRenderCache } from "@/stores/track-store";
import { getTrackIdModeConfig } from "@/lib/map-app-config";
import { cn } from "@/lib/utils";
import { AlertTriangle, AlertCircle, Info, ExternalLink, Zap } from "lucide-react";
import { useCallback, useMemo } from "react";

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

export function AlertPanel() {
  const { selectTrack } = useAppStore();
  const alerts = useAlertStore((s) => s.alerts);
  const shadowTracks = useTrackStore((s) => s.shadowTracks);

  /** 告警 trackId → 航迹 showID（用于 selectTrack） */
  const resolveShowIdFromAlarmTrackId = useCallback(
    (alarmTrackId: string): string | null => {
      if (!getTrackIdModeConfig().distinguishSeaAir) {
        // 18.141：先查渲染层，再查影子层
        for (const [, t] of getRenderCache()) {
          if (t.trackId === alarmTrackId) return t.showID;
        }
        for (const [, t] of shadowTracks) {
          if (t.trackId === alarmTrackId) return t.showID;
        }
        return null;
      }
      // 28.9：对海 trackId 就是 uniqueID/showID，直接用
      // 但也可能是对空的业务 trackId，先直查再遍历
      if (getRenderCache().has(alarmTrackId)) return alarmTrackId;
      if (shadowTracks.has(alarmTrackId)) return alarmTrackId;
      for (const [, t] of getRenderCache()) {
        if (t.trackId === alarmTrackId) return t.showID;
      }
      for (const [, t] of shadowTracks) {
        if (t.trackId === alarmTrackId) return t.showID;
      }
      return null;
    },
    [shadowTracks],
  );

  /** 告警 trackId → 查证图片（从 renderCache 查匹配 trackId 的航迹） */
  const alertImageMap = useMemo(() => {
    const map = new Map<string, string>();
    const cache = getRenderCache();
    for (const [, t] of cache) {
      if (t.trackId && t.verificationImage) {
        map.set(t.trackId, t.verificationImage);
      }
    }
    return map;
  }, [alerts, shadowTracks]); // alerts/shadowTracks 变化时重算

  const allAlerts = alerts.map((a: AlertData) => ({
    ...a,
    severity: (a.severity in SEVERITY_STYLES ? a.severity : "info") as SeverityKey,
    imageUrl: a.trackId ? alertImageMap.get(a.trackId) : undefined,
  }));

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
                    <span className="font-mono text-[10px] text-nexus-text-muted">
                      {alert.timestamp}
                    </span>
                  </div>
                  {alert.title && (
                    <p className="mt-0.5 text-[11px] font-medium text-nexus-text-primary">{alert.title}</p>
                  )}
                  <p className="mt-0.5 text-xs leading-relaxed text-nexus-text-primary">
                    {alert.message}
                  </p>
                  <div className="mt-1 space-y-0.5 text-[10px] text-nexus-text-muted">
                    {alert.trackId && (
                      <div>
                        <span className="text-nexus-text-secondary">目标 ID：</span>
                        {alert.trackId}
                      </div>
                    )}
                    {alert.uniqueID && alert.uniqueID !== alert.trackId && (
                      <div>
                        <span className="text-nexus-text-secondary">uniqueID：</span>
                        {alert.uniqueID}
                      </div>
                    )}
                    {alert.lat != null && alert.lng != null && Number.isFinite(alert.lat) && Number.isFinite(alert.lng) && (
                      <div>
                        <span className="text-nexus-text-secondary">坐标：</span>
                        {alert.lng.toFixed(5)}, {alert.lat.toFixed(5)}
                      </div>
                    )}
                    {alert.areaName && (
                      <div>
                        <span className="text-nexus-text-secondary">区域：</span>
                        {alert.areaName}
                      </div>
                    )}
                    {alert.source && (
                      <div>
                        <span className="text-nexus-text-secondary">来源：</span>
                        {alert.source}
                      </div>
                    )}
                    {alert.alarmLevel != null && Number.isFinite(alert.alarmLevel) && (
                      <div>
                        <span className="text-nexus-text-secondary">等级：</span>
                        {alert.alarmLevel}
                      </div>
                    )}
                    {alert.type && (
                      <div>
                        <span className="text-nexus-text-secondary">类型：</span>
                        {alert.type}
                      </div>
                    )}
                    {alert.detail && (
                      <div className="text-nexus-text-secondary/90">{alert.detail}</div>
                    )}
                  </div>
                  {alert.imageUrl && (
                    <div className="mt-1.5 overflow-hidden rounded border border-white/[0.06]">
                      <img
                        src={alert.imageUrl}
                        alt="查证图片"
                        className="w-full object-cover"
                      />
                    </div>
                  )}
                  {alert.trackId && (
                    <button
                      onClick={() => {
                        const showId = resolveShowIdFromAlarmTrackId(alert.trackId!);
                        if (showId) selectTrack(showId);
                      }}
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
