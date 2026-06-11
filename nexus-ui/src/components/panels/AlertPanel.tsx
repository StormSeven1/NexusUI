"use client";

import Image from "next/image";

import { useAppStore } from "@/stores/app-store";
import { type Track } from "@/lib/map-entity-model";
import { useTrackStore, getRenderCache } from "@/stores/track-store";
import { useDisposedStore } from "@/stores/disposed-store";
import { useDisposalPlanStore } from "@/stores/disposal-plan-store";
import { useTaskProgressStore } from "@/stores/task-progress-store";
import { useTrackAliasStore, resolveAliasKey } from "@/stores/track-alias-store";
import { cn } from "@/lib/utils";
import { runAlertDestroyHttp } from "@/lib/disposal/alert-destroy";
import { AlertTriangle, AlertCircle, Info, X, ArrowUpDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type PanelAlertItem = {
  id: string;
  severity: SeverityKey;
  timestamp: string;
  trackId?: string;
  uniqueID?: string;
  lat?: number;
  lng?: number;
  type?: string;
  alarmLevel?: number;
  areaName?: string;
  detail?: string;
  imageUrl?: string;
  suppressDestroy?: boolean;
};

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
    label: "告警",
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
const SEVERITY_SCORE: Record<SeverityKey, number> = { critical: 3, warning: 2, info: 1 };

type SortMode = "name" | "time" | "level" | "severity";
const SORT_OPTIONS: { id: SortMode; label: string }[] = [
  { id: "name", label: "名称" },
  { id: "time", label: "时间" },
  { id: "level", label: "等级" },
  { id: "severity", label: "严重度" },
];

function naturalNameCompare(a: string, b: string): number {
  return a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" });
}

export function AlertPanel() {
  const { selectTrack, selectedTrackId, requestFlyTo } = useAppStore();
  const tracks = useTrackStore((s) => s.tracks);
  const addDisposedTrack = useDisposedStore((s) => s.addDisposedTrack);
  const cleanupEffectsForMissingTargets = useDisposalPlanStore((s) => s.cleanupEffectsForMissingTargets);
  const aliases = useTrackAliasStore((s) => s.aliases);
  const [sortMode, setSortMode] = useState<SortMode>("name");

  useEffect(() => {
    const aliasStore = useTrackAliasStore.getState();
    for (const track of tracks) {
      if (!track.trackId) continue;
      const k = resolveAliasKey({
        trackId: track.trackId,
        uniqueID: track.uniqueID ?? track.trackId,
        isAirTrack: track.isAirTrack,
      });
      if (k) aliasStore.getOrCreate(k);
    }
  }, [tracks]);

  const resolveShowIdFromAlarmTrackId = useCallback((alarmTrackId: string): string | null => {
    for (const [, t] of getRenderCache()) {
      if (t.trackId === alarmTrackId) return t.showID;
    }
    return null;
  }, []);

  /** 告警 trackId 对应的核验图片从 renderCache 里读取。 */
  const alertImageMap = useMemo(() => {
    const map = new Map<string, string>();
    const cache = getRenderCache();
    for (const [, t] of cache) {
      if (t.trackId && t.verificationImage) {
        map.set(t.trackId, t.verificationImage);
      }
    }
    return map;
  }, [tracks]);

  const allAlerts = useMemo(() => {
    const mapped: PanelAlertItem[] = tracks
      .map((track: Track) => {
        const alarm =
          Array.isArray(track.alarms) && track.alarms.length > 0
            ? (track.alarms[0] as Record<string, unknown>)
            : null;
        if (!alarm) return null;

        const levelRaw = alarm.level;
        const alarmLevel = levelRaw != null && Number.isFinite(Number(levelRaw)) ? Number(levelRaw) : undefined;
        const severity: SeverityKey =
          alarmLevel != null && alarmLevel >= 2 ? "critical" : alarmLevel === 1 ? "warning" : "info";
        const area = alarm.area && typeof alarm.area === "object" ? (alarm.area as Record<string, unknown>) : null;
        const detail = typeof alarm.content === "string" ? alarm.content : undefined;

        return {
          id: `${track.showID}:${String(alarm.alarm_id)}`,
          severity,
          timestamp: track.lastUpdate,
          trackId: track.trackId,
          uniqueID: track.uniqueID,
          lat: track.lat,
          lng: track.lng,
          type: Array.isArray(alarm.categories) ? String(alarm.categories.join(",")) : undefined,
          alarmLevel,
          areaName: area ? String(area.name ?? area.area_name ?? "") || undefined : undefined,
          detail,
          imageUrl: track.trackId ? alertImageMap.get(track.trackId) : undefined,
        } as PanelAlertItem;
      })
      .filter((item): item is PanelAlertItem => item != null);

    if (sortMode === "name") {
      mapped.sort((a, b) => {
        const aliasA = (() => {
          if (!a.trackId) return "";
          const k = resolveAliasKey({ trackId: a.trackId, uniqueID: a.uniqueID ?? a.trackId, isAirTrack: undefined });
          return k ? (aliases[k] ?? a.trackId) : a.trackId;
        })();
        const aliasB = (() => {
          if (!b.trackId) return "";
          const k = resolveAliasKey({ trackId: b.trackId, uniqueID: b.uniqueID ?? b.trackId, isAirTrack: undefined });
          return k ? (aliases[k] ?? b.trackId) : b.trackId;
        })();
        return naturalNameCompare(aliasA, aliasB);
      });
    } else if (sortMode === "level") {
      mapped.sort((a, b) => (b.alarmLevel ?? 0) - (a.alarmLevel ?? 0));
    } else if (sortMode === "severity") {
      mapped.sort((a, b) => SEVERITY_SCORE[b.severity] - SEVERITY_SCORE[a.severity]);
    }

    return mapped;
  }, [tracks, alertImageMap, aliases, sortMode]);

  const criticalCount = allAlerts.filter((a) => a.severity === "critical").length;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-1.5 border-b border-white/[0.06] p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">
            告警中心
          </span>
          <span className="text-[10px] font-medium text-red-400">
            {criticalCount} 条严重
          </span>
        </div>
        <div className="flex items-center gap-1">
          <ArrowUpDown size={10} className="shrink-0 text-nexus-text-muted" />
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setSortMode(opt.id)}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                sortMode === opt.id
                  ? "bg-white/[0.08] text-nexus-text-primary"
                  : "text-nexus-text-muted hover:text-nexus-text-secondary",
              )}
            >
              {opt.label}
            </button>
          ))}
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
                "cursor-pointer border-b border-l-2 border-white/[0.03] px-3 py-3 transition-colors hover:bg-white/[0.03]",
                style.border,
                style.bg,
              )}
              onClick={() => {
                if (!alert.trackId) return;
                const showId = resolveShowIdFromAlarmTrackId(alert.trackId);
                if (!showId) return;
                selectTrack(showId);
                // 从渲染缓存获取航迹坐标并飞过去。
                const t = getRenderCache().get(showId);
                if (t) requestFlyTo(t.lat, t.lng, 14);
              }}
            >
              <div className="flex items-start gap-2">
                <Icon size={14} className={cn("mt-0.5 shrink-0", style.iconColor)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("text-[10px] font-bold", style.labelColor)}>{style.label}</span>
                    <span className="font-mono text-[10px] text-nexus-text-muted">{alert.timestamp}</span>
                  </div>
                  {alert.trackId && (
                    <p className="mt-0.5 text-[12px] font-bold text-nexus-text-primary">
                      {(() => {
                        const k = resolveAliasKey({
                          trackId: alert.trackId,
                          uniqueID: alert.uniqueID ?? alert.trackId,
                          isAirTrack: undefined,
                        });
                        return k && aliases[k] ? aliases[k] : alert.trackId;
                      })()}
                    </p>
                  )}
                  <div className="mt-1 space-y-0.5 text-[10px] text-nexus-text-muted">
                    {alert.lat != null && alert.lng != null && Number.isFinite(alert.lat) && Number.isFinite(alert.lng) && (
                      <div>
                        <span className="text-nexus-text-secondary">坐标：</span>
                        {alert.lng.toFixed(4)}, {alert.lat.toFixed(4)}
                      </div>
                    )}
                    {alert.areaName && (
                      <div>
                        <span className="text-nexus-text-secondary">区域：</span>
                        {alert.areaName}
                      </div>
                    )}
                  </div>
                  {alert.imageUrl && (
                    <div className="mt-1.5 overflow-hidden rounded border border-white/[0.06]">
                      <Image
                        src={alert.imageUrl}
                        alt="核验图片"
                        width={640}
                        height={360}
                        className="h-auto w-full object-cover"
                        unoptimized
                      />
                    </div>
                  )}
                  <div className="mt-1.5 flex items-center gap-2">
                    {alert.trackId && !alert.suppressDestroy && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const trackId = alert.trackId!;
                          const uniqueId = alert.uniqueID;

                          try {
                            const http = await runAlertDestroyHttp(trackId, uniqueId);
                            const publishOk = http.publishOk;

                            // 标记已处置，后续同目标的航迹点和告警都会被过滤。
                            const showId = alert.uniqueID;
                            addDisposedTrack(showId ?? undefined, trackId);
                            useTrackStore.getState().removeDisposedTracks(showId ?? undefined, trackId);

                            // 如果当前选中的就是该航迹，则取消选中和高亮。
                            if (selectedTrackId && selectedTrackId === showId) {
                              selectTrack(null);
                            }

                            // 清理处置方案连线以及相关地图效果。
                            cleanupEffectsForMissingTargets();

                            // 结束该目标的执行中任务进度。
                            useTaskProgressStore.getState().endByTarget(trackId);

                            const devHint =
                              http.deviceEntityIds.length > 0
                                ? `设备 ${http.deviceEntityIds.join(",")}`
                                : "无执行中处置设备";
                            const grpcHint = `gRPC 客户端 ${http.connectedClients} 个`;
                            toast.success(
                              publishOk
                                ? `已消灭目标 ${trackId}，${devHint}；${grpcHint}`
                                : `已消灭目标 ${trackId}，但后端发布可能未成功；${devHint}；${grpcHint}`,
                            );
                          } catch (err) {
                            console.error("[AlertPanel] 消灭操作失败:", err);
                            toast.error(`消灭失败: ${err instanceof Error ? err.message : "未知错误"}`);
                          }
                        }}
                        className="flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 transition-colors hover:border-emerald-500/60 hover:bg-emerald-500/20"
                      >
                        <X size={10} />
                        消灭
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
