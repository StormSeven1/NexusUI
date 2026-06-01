"use client";

/**
 * 告警面板 — 消费 alert-store 的实时数据。
 *
 * 【数据流】`useUnifiedWsFeed`（`alert_batch` / `map_command` alert / `alert`）经 `ws-alert-normalize` 归一化 → `addAlerts` → 本列表。
 */

import { useAppStore } from "@/stores/app-store";
import { useAlertStore, type AlertData } from "@/stores/alert-store";
import { useTrackStore, getRenderCache } from "@/stores/track-store";
import { useDisposedStore } from "@/stores/disposed-store";
import { useDisposalPlanStore } from "@/stores/disposal-plan-store";
import { useTaskProgressStore } from "@/stores/task-progress-store";
import { useTrackAliasStore, resolveAliasKey } from "@/stores/track-alias-store";
import { getTrackIdModeConfig } from "@/lib/map-app-config";
import { cn } from "@/lib/utils";
import { runAlertDestroyHttp } from "@/lib/disposal/alert-destroy";
import { AlertTriangle, AlertCircle, Info, X, ArrowUpDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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

/**
 * 告警面板 — 消费 alert-store 的实时数据。
 *
 * 【数据流】`useUnifiedWsFeed`（`alert_batch` / `map_command` alert / `alert`）经 `ws-alert-normalize` 归一化 → `addAlerts` → 本列表。
 *
 * 【消灭按钮逻辑】
 * 1. runAlertDestroyHttp：按本条告警 trackId 严格匹配正在执行的方案 → POST（entityId 逗号拼接，可为空）→ 仅有飞弹时 DELETE 飞弹
 * 2. 标记已处置、清告警、清选中、清处置连线等（本地）
 */
export function AlertPanel() {
  const { selectTrack, selectedTrackId, requestFlyTo } = useAppStore();
  const alerts = useAlertStore((s) => s.alerts);
  const removeAlarmItemsByTrackId = useAlertStore((s) => s.removeAlarmItemsByTrackId);
  const shadowTracks = useTrackStore((s) => s.shadowTracks);
  const addDisposedTrack = useDisposedStore((s) => s.addDisposedTrack);
  const cleanupEffectsForMissingTargets = useDisposalPlanStore((s) => s.cleanupEffectsForMissingTargets);
  const aliases = useTrackAliasStore((s) => s.aliases);
  const [sortMode, setSortMode] = useState<SortMode>("name");

  useEffect(() => {
    const aliasStore = useTrackAliasStore.getState();
    for (const alert of alerts) {
      if (!alert.trackId) continue;
      const k = resolveAliasKey({ trackId: alert.trackId, uniqueID: alert.uniqueID ?? alert.trackId, isAirTrack: undefined });
      if (k) aliasStore.getOrCreate(k);
    }
  }, [alerts]);

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

  const allAlerts = useMemo(() => {
    const mapped = alerts.map((a: AlertData) => ({
      ...a,
      severity: (a.severity in SEVERITY_STYLES ? a.severity : "info") as SeverityKey,
      imageUrl: a.trackId ? alertImageMap.get(a.trackId) : undefined,
    }));
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
  }, [alerts, alertImageMap, aliases, sortMode]);

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
                "border-b border-white/[0.03] border-l-2 px-3 py-3 cursor-pointer transition-colors hover:bg-white/[0.03]",
                style.border,
                style.bg
              )}
              onClick={() => {
                if (!alert.trackId) return;
                const showId = resolveShowIdFromAlarmTrackId(alert.trackId);
                if (!showId) return;
                selectTrack(showId);
                /* 从渲染缓存获取航迹坐标，飞过去 */
                const t = getRenderCache().get(showId);
                if (t) requestFlyTo(t.lat, t.lng, 14);
              }}
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
                  {/* {alert.title && (
                    <p className="mt-0.5 text-[11px] font-medium text-nexus-text-primary">{alert.title}</p>
                  )} */}
                  {/* <p className="mt-0.5 text-xs leading-relaxed text-nexus-text-primary">
                    {alert.message}
                  </p> */}
                  {alert.trackId && (
                    <p className="mt-0.5 text-[12px] font-bold text-nexus-text-primary">
                      {(() => {
                        const k = resolveAliasKey({ trackId: alert.trackId, uniqueID: alert.uniqueID ?? alert.trackId, isAirTrack: undefined });
                        return (k && aliases[k]) ? aliases[k] : alert.trackId;
                      })()}
                    </p>
                  )}
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
                        {alert.lng.toFixed(4)}, {alert.lat.toFixed(4)}
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
                  <div className="mt-1.5 flex items-center gap-2">
                    {alert.trackId && !alert.suppressDestroy && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const trackId = alert.trackId!;

                          try {
                            const http = await runAlertDestroyHttp(trackId);
                            const adjudicationOk = http.adjudicationOk;

                            // 标记已处置（后续 WS 推送的该航迹点和告警都会被过滤）
                            const showId = resolveShowIdFromAlarmTrackId(trackId);
                            addDisposedTrack(showId ?? undefined, trackId);

                            // 4. 清除告警列表中该 trackId 的条目
                            removeAlarmItemsByTrackId(trackId);

                            // 5. 若当前选中的是该航迹，取消选中/高亮
                            if (selectedTrackId && selectedTrackId === showId) {
                              selectTrack(null);
                            }

                            // 6. 清除处置方案连接线与激光/TDOA 激活状态
                            cleanupEffectsForMissingTargets();

                            // 7. 任务进展：该目标所有执行中条目 → 处置结束
                            useTaskProgressStore.getState().endByTarget(trackId);

                            const devHint =
                              http.deviceEntityIds.length > 0
                                ? `设备 ${http.deviceEntityIds.join(",")}`
                                : "无执行中处置设备";
                            const munHint =
                              http.munitionEntityIds.length > 0
                                ? `；已处理巡飞弹 ${http.munitionEntityIds.join(",")}`
                                : "";
                            toast.success(
                              adjudicationOk
                                ? `已消灭目标 ${trackId}（${devHint}${munHint}）`
                                : `已消灭目标 ${trackId}（处置结束可能未全部成功；${devHint}${munHint}）`,
                            );
                          } catch (err) {
                            console.error("[AlertPanel] 消灭操作失败:", err);
                            toast.error(`消灭失败: ${err instanceof Error ? err.message : "未知错误"}`);
                          }
                        }}
                        className="flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20 hover:border-emerald-500/60"
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
