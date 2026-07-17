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
import { dismissAlarmByTargetId, dismissAlarmForTrack } from "@/lib/dismiss-alarm-for-track";
import {
  resolveUniqueIdForAlert,
  sendAlarmConfirmRequest,
} from "@/lib/alarm-confirm-api";
import { resolveAlertFuseType } from "@/lib/alarm-track-match";
import { AlertTriangle, AlertCircle, Info, Plane, ScanSearch, Ship, Trash2, Video, CheckCircle2 } from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";
import { THIRD_PARTY_DETECT_ALERT_TYPE } from "@/lib/third-party-ptz-fov";
import { AlertScreenshotThumb } from "@/components/panels/AlertScreenshotThumb";

const ALERT_ACTION_BTN =
  "inline-flex h-6 shrink-0 items-center gap-0.5 rounded border px-1.5 text-[10px] font-medium leading-none transition-colors";

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

function isVerifiedAlarmItem(alert: AlertData): boolean {
  return alert.alarmType !== "threat";
}

function alarmKindLabel(alert: AlertData): "威胁" | "告警" {
  return isVerifiedAlarmItem(alert) ? "告警" : "威胁";
}

/** 列表时间：优先首次发现，避免 updateTime 每秒刷新跳动 */
function formatAlertDisplayTime(alert: AlertData): string {
  const ms = alert.firstSeenTime;
  if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) {
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
  }
  const raw = alert.timestamp?.trim() ?? "";
  if (!raw) return "";
  // ISO → 本地可读
  if (raw.includes("T")) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
  }
  // 已是 "yyyy-MM-dd hh:mm:ss(.zzz)" 则去掉毫秒，减少视觉抖动观感
  return raw.replace(/\.\d{1,3}$/, "");
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
  const upsertAlarm = useAlertStore((s) => s.upsertAlarm);
  const shadowTracks = useTrackStore((s) => s.shadowTracks);

  const resolveShowId = useCallback(
    (alarmTrackId: string) => resolveShowIdFromAlarmTrackId(alarmTrackId, shadowTracks),
    [shadowTracks],
  );

  const allAlerts = alerts.map((a: AlertData) => ({
    ...a,
    severity: (a.severity in SEVERITY_STYLES ? a.severity : "info") as SeverityKey,
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

      try {
        const track = resolveTrackFromAlarmTrackId(trackId, shadowTracks, alert);
        const result = track
          ? await dismissAlarmForTrack(track, { clearManualAffiliation: true })
          : await dismissAlarmByTargetId(trackId);
        if (!result.ok) {
          toast.error("删除告警失败", { description: result.message ?? "告警服务无响应" });
          return;
        }
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

  const handleConfirmAlarm = useCallback(
    async (e: React.MouseEvent, alert: (typeof allAlerts)[number]) => {
      e.stopPropagation();
      const uniqueId = resolveUniqueIdForAlert(alert, shadowTracks);
      if (uniqueId == null) {
        toast.error("无法确认：缺少 uniqueId");
        return;
      }
      try {
        const result = await sendAlarmConfirmRequest(uniqueId);
        if (!result.ok) {
          toast.error("确认告警失败", { description: result.message ?? "告警服务无响应" });
          return;
        }
        upsertAlarm({
          ...alert,
          alarmType: "alert",
          uniqueID: String(uniqueId),
        });
        toast.success("已确认告警", { description: `uniqueId ${uniqueId}` });
      } catch (err) {
        console.error("[AlertPanel] 确认告警失败:", err);
        toast.error(`确认失败: ${err instanceof Error ? err.message : "未知错误"}`);
      }
    },
    [shadowTracks, upsertAlarm],
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
          const kindLabel = isTrackAlarmItem(alert) ? alarmKindLabel(alert) : style.label;
          const kindColor =
            kindLabel === "威胁"
              ? "text-amber-400"
              : kindLabel === "告警"
                ? "text-emerald-400"
                : style.labelColor;
          const summaryLine = `目标：${summary.target}, 位置：${summary.position}, 区域：${summary.area}, 等级：${summary.level}`;
          const alarmTrackId = isTrackAlarmItem(alert) ? alert.trackId?.trim() ?? null : null;

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
                  requestFlyTo(alert.lat, alert.lng);
                  return;
                }
                if (!alert.trackId) return;
                const showId = resolveShowId(alert.trackId);
                if (!showId) return;
                selectTrack(showId);
                const t = getRenderCache().get(showId);
                if (t) requestFlyTo(t.lat, t.lng);
              }}
            >
              <div className="flex items-start gap-1.5">
                <Icon size={13} className={cn("mt-0.5 shrink-0", style.iconColor)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className={cn("shrink-0 text-[10px] font-bold", kindColor)}>
                        {kindLabel}
                      </span>
                      {isTrackAlarmItem(alert) && kindLabel !== style.label && (
                        <span className={cn("shrink-0 text-[10px] font-medium opacity-70", style.labelColor)}>
                          {style.label}
                        </span>
                      )}
                      <span className="truncate font-mono text-[10px] text-nexus-text-muted">
                        {formatAlertDisplayTime(alert)}
                      </span>
                    </div>
                    {isTrackAlarmItem(alert) && (
                      <div className="flex shrink-0 items-center gap-1">
                        {!isVerifiedAlarmItem(alert) && (
                          <button
                            type="button"
                            onClick={(e) => void handleConfirmAlarm(e, alert)}
                            className={cn(
                              ALERT_ACTION_BTN,
                              "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:border-emerald-500/60 hover:bg-emerald-500/20",
                            )}
                          >
                            <CheckCircle2 size={10} />
                            确认告警
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => void handleDelete(e, alert)}
                          className={cn(
                            ALERT_ACTION_BTN,
                            "border-rose-500/40 bg-rose-500/10 text-rose-400 hover:border-rose-500/60 hover:bg-rose-500/20",
                          )}
                        >
                          <Trash2 size={10} />
                          删除
                        </button>
                        <button
                          type="button"
                          onClick={(e) => void handleVerify(e, alert)}
                          className={cn(
                            ALERT_ACTION_BTN,
                            "border-sky-500/40 bg-sky-500/10 text-sky-400 hover:border-sky-500/60 hover:bg-sky-500/20",
                          )}
                        >
                          <ScanSearch size={10} />
                          查证
                        </button>
                        {alarmTrackId ? (
                          <AlertScreenshotThumb
                            key={alarmTrackId}
                            trackId={alarmTrackId}
                            preferredUniqueId={alert.uniqueID}
                          />
                        ) : null}
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

                  {isTrackAlarmItem(alert) && alert.content?.trim() ? (
                    <p
                      className="mt-0.5 break-words text-[10px] leading-snug text-nexus-text-secondary/90"
                      title={alert.content}
                    >
                      证据链：{alert.content}
                    </p>
                  ) : null}

                  {alert.detail && (
                    <p
                      className="mt-0.5 truncate text-[10px] text-nexus-text-secondary/80"
                      title={alert.detail}
                    >
                      {alert.detail}
                    </p>
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
