"use client";

/**
 * 告警面板 — 消费 alert-store 的实时数据。
 *
 * 【数据流】`useUnifiedWsFeed`（`alert_batch` / `map_command` alert / `alert`）经 `ws-alert-normalize` 归一化 → `addAlerts` → 本列表。
 */

import { useAppStore } from "@/stores/app-store";
import { useAlertStore, type AlertData } from "@/stores/alert-store";
import { useTrackStore, getRenderCache } from "@/stores/track-store";
import { cn } from "@/lib/utils";
import { buildAlertSummaryParts } from "@/lib/format-alert-summary";
import {
  resolveShowIdFromAlarmTrackId,
  resolveTrackFromAlarmTrackId,
  runGisTrackVerification,
} from "@/lib/run-gis-track-verification";
import {
  fuseTypeFromTrackKind,
  sendAlarmTrackFilterRequest,
  type AlarmFilterFuseType,
} from "@/lib/alarm-filter-api";
import { resolveAlertFuseType } from "@/lib/alarm-track-match";
import { AlertTriangle, AlertCircle, Info, Plane, ScanSearch, Ship, Trash2, Video } from "lucide-react";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { THIRD_PARTY_DETECT_ALERT_TYPE } from "@/lib/third-party-ptz-fov";

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

const THIRD_PARTY_CAMERA_ALERT_STYLE = {
  icon: Video,
  border: "border-l-fuchsia-500",
  bg: "bg-fuchsia-500/8",
  iconColor: "text-fuchsia-400",
  label: "相机",
  labelColor: "text-fuchsia-400",
};

type SeverityKey = keyof typeof SEVERITY_STYLES;

function resolveAlertVisualStyle(alert: AlertData) {
  if (alert.type === THIRD_PARTY_DETECT_ALERT_TYPE) return THIRD_PARTY_CAMERA_ALERT_STYLE;
  const severity = (alert.severity in SEVERITY_STYLES ? alert.severity : "info") as SeverityKey;
  return SEVERITY_STYLES[severity];
}

function isTrackAlarmItem(alert: AlertData): boolean {
  return Boolean(alert.trackId?.trim()) && alert.type !== THIRD_PARTY_DETECT_ALERT_TYPE;
}

/** 航迹告警目标 ID 前的对海/对空小标（与目标档案面板一致） */
function AlertTrackFuseIcon({ fuseType }: { fuseType: 0 | 1 }) {
  const cls = "inline size-[11px] shrink-0 align-[-1px] opacity-95";
  if (fuseType === 1) {
    return (
      <span title="对空" className="inline-flex shrink-0">
        <Plane className={cn(cls, "text-sky-300")} strokeWidth={2} aria-hidden />
      </span>
    );
  }
  return (
    <span title="对海" className="inline-flex shrink-0">
      <Ship className={cn(cls, "text-teal-300")} strokeWidth={2} aria-hidden />
    </span>
  );
}

export function AlertPanel() {
  const { selectTrack, requestFlyTo } = useAppStore();
  const alerts = useAlertStore((s) => s.alerts);
  const removeAlarmItemsByTrackId = useAlertStore((s) => s.removeAlarmItemsByTrackId);
  const shadowTracks = useTrackStore((s) => s.shadowTracks);

  const resolveShowId = useCallback(
    (alarmTrackId: string) => resolveShowIdFromAlarmTrackId(alarmTrackId, shadowTracks),
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
  }, [alerts, shadowTracks]);

  const allAlerts = alerts.map((a: AlertData) => ({
    ...a,
    severity: (a.severity in SEVERITY_STYLES ? a.severity : "info") as SeverityKey,
    imageUrl: a.trackId ? alertImageMap.get(a.trackId) : undefined,
  }));

  const criticalCount = allAlerts.filter((a) => a.severity === "critical").length;

  const handleDelete = useCallback(
    async (e: React.MouseEvent, alert: (typeof allAlerts)[number]) => {
      e.stopPropagation();
      const trackId = alert.trackId?.trim();
      if (!trackId) {
        toast.error("无法删除：告警缺少 track_id");
        return;
      }

      let fuseType: AlarmFilterFuseType | undefined = alert.fuseType;
      if (fuseType !== 0 && fuseType !== 1) {
        let isAirTrack = false;
        for (const [, t] of getRenderCache()) {
          if (t.trackId === trackId) {
            isAirTrack = t.isAirTrack === true;
            break;
          }
        }
        if (!isAirTrack) {
          const shadow = resolveTrackFromAlarmTrackId(trackId, shadowTracks, alert);
          if (shadow) isAirTrack = shadow.isAirTrack === true;
        }
        fuseType = fuseTypeFromTrackKind(isAirTrack);
      }

      try {
        const result = await sendAlarmTrackFilterRequest(trackId, fuseType);
        if (!result.ok) {
          toast.error("删除告警失败", { description: result.message ?? "告警服务无响应" });
          return;
        }
        removeAlarmItemsByTrackId(trackId);
        toast.success(`已删除航迹告警 ${trackId}`);
      } catch (err) {
        console.error("[AlertPanel] 删除告警失败:", err);
        toast.error(`删除失败: ${err instanceof Error ? err.message : "未知错误"}`);
      }
    },
    [shadowTracks, removeAlarmItemsByTrackId],
  );

  const handleVerify = useCallback(
    async (e: React.MouseEvent, alert: (typeof allAlerts)[number]) => {
      e.stopPropagation();
      if (!alert.trackId) {
        toast.error("无法查证：告警缺少目标 ID");
        return;
      }
      const track = resolveTrackFromAlarmTrackId(alert.trackId, shadowTracks);
      if (!track) {
        toast.error("无法查证：未找到对应航迹");
        return;
      }
      try {
        await runGisTrackVerification(track);
        toast.message("已发起查证", { description: `目标 ${alert.trackId}` });
      } catch (err) {
        console.error("[AlertPanel] 查证失败:", err);
        toast.error(`查证失败: ${err instanceof Error ? err.message : "未知错误"}`);
      }
    },
    [shadowTracks],
  );

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
          const style = resolveAlertVisualStyle(alert);
          const Icon = style.icon;
          const summary = buildAlertSummaryParts(alert, shadowTracks);
          const fuseType = isTrackAlarmItem(alert)
            ? resolveAlertFuseType(alert, shadowTracks)
            : undefined;
          const summaryLine = `目标：${summary.target}, 位置：${summary.position}, 区域：${summary.area}, 等级：${summary.level}`;

          return (
            <div
              key={alert.id}
              className={cn(
                "cursor-pointer border-b border-white/[0.03] border-l-2 px-2.5 py-2 transition-colors hover:bg-white/[0.03]",
                style.border,
                style.bg,
              )}
              onClick={() => {
                if (alert.type === THIRD_PARTY_DETECT_ALERT_TYPE && alert.lat != null && alert.lng != null) {
                  requestFlyTo(alert.lat, alert.lng, 14);
                  return;
                }
                if (!alert.trackId) return;
                const showId = resolveShowId(alert.trackId);
                if (!showId) return;
                selectTrack(showId);
                const t = getRenderCache().get(showId);
                if (t) requestFlyTo(t.lat, t.lng, 11);
              }}
            >
              <div className="flex items-start gap-1.5">
                <Icon size={13} className={cn("mt-0.5 shrink-0", style.iconColor)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className={cn("shrink-0 text-[10px] font-bold", style.labelColor)}>
                        {style.label}
                      </span>
                      <span className="truncate font-mono text-[10px] text-nexus-text-muted">
                        {alert.timestamp}
                      </span>
                    </div>
                    {isTrackAlarmItem(alert) && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => void handleDelete(e, alert)}
                          className="flex items-center gap-0.5 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-400 transition-colors hover:border-rose-500/60 hover:bg-rose-500/20"
                        >
                          <Trash2 size={10} />
                          删除
                        </button>
                        <button
                          type="button"
                          onClick={(e) => void handleVerify(e, alert)}
                          className="flex items-center gap-0.5 rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-400 transition-colors hover:border-sky-500/60 hover:bg-sky-500/20"
                        >
                          <ScanSearch size={10} />
                          查证
                        </button>
                      </div>
                    )}
                  </div>

                  <p
                    className="mt-0.5 break-words text-[10px] leading-snug text-nexus-text-primary"
                    title={summaryLine}
                  >
                    <span className="inline-flex flex-wrap items-center gap-0.5">
                      目标：
                      {fuseType === 0 || fuseType === 1 ? (
                        <AlertTrackFuseIcon fuseType={fuseType} />
                      ) : null}
                      <span>{summary.target}</span>
                    </span>
                    , 位置：{summary.position}, 区域：{summary.area}, 等级：{summary.level}
                  </p>

                  {alert.detail && (
                    <p
                      className="mt-0.5 truncate text-[10px] text-nexus-text-secondary/80"
                      title={alert.detail}
                    >
                      {alert.detail}
                    </p>
                  )}

                  {alert.imageUrl && (
                    <div className="mt-1 overflow-hidden rounded border border-white/[0.06]">
                      <img
                        src={alert.imageUrl}
                        alt="查证图片"
                        className="max-h-16 w-full object-cover"
                      />
                    </div>
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
