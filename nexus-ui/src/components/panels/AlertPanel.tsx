"use client";

/**
 * 告警面板 — 消费 alert-store 的实时数据。
 *
 * 【数据流】
 * - 航迹类（两类同源筛选「航迹」）：
 *   1) 目标结构威胁：`useUnifiedWsFeed` → `ws-alert-normalize` → upsert
 *   2) 检测框可疑目标：camServer SystemAlarm gRPC → `useSystemAlarmPoll` → syncSystemAlarms
 * - 其它系统类：`useSystemAlarmPoll`（2s）→ `/api/system-alarms` → syncSystemAlarms
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
  buildAlarmConfirmTrackHint,
} from "@/lib/alarm-confirm-api";
import { resolveAlertFuseType } from "@/lib/alarm-track-match";
import { isHighThreatAlert } from "@/lib/alarm-threat-level";
import { sendSystemAlarmCancelRequest } from "@/lib/system-alarm-cancel-api";
import {
  ALERT_FILTER_OPTIONS,
  ALERT_SEVERITY_FILTER_OPTIONS,
  ALERT_SYSTEM_FILTER_OPTIONS,
  ALL_ALERT_FILTER_KEYS,
  ALL_ALERT_SEVERITY_KEYS,
  ALL_ALERT_SYSTEM_FILTER_KEYS,
  alertMatchesFilters,
  compareAlertForAlarmCenter,
  isCameraDetectTrackAlarm,
  isSystemAlarm,
  type AlertFilterKey,
  type AlertSeverityFilterKey,
  type AlertSystemFilterKey,
} from "@/lib/system-alarm";
import { AlertTriangle, AlertCircle, Info, Plane, ScanSearch, Ship, Trash2, Video, CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { THIRD_PARTY_DETECT_ALERT_TYPE } from "@/lib/third-party-ptz-fov";
import { AlertEvidenceHoverHost } from "@/components/panels/AlertEvidenceHoverCard";
import { alarmEvidenceSummaryText } from "@/lib/alarm-evidence-content";

const ALERT_ACTION_BTN =
  "inline-flex h-6 shrink-0 items-center gap-0.5 rounded border px-1.5 text-[10px] font-medium leading-none transition-colors";

const ALERT_FILTER_STORAGE_KEY = "nexus.alert.selectedFilters";
const ALERT_SEVERITY_STORAGE_KEY = "nexus.alert.selectedSeverities";
const ALERT_SYSTEM_STORAGE_KEY = "nexus.alert.selectedSystems";

function loadPersistedFilterSet<T extends string>(
  storageKey: string,
  validKeys: readonly T[],
  fallback: readonly T[],
): Set<T> {
  if (typeof window === "undefined") return new Set(fallback);
  try {
    const raw = window.localStorage.getItem(storageKey)?.trim();
    if (!raw) return new Set(fallback);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(fallback);
    const valid = new Set(validKeys);
    const next = parsed.filter((x): x is T => typeof x === "string" && valid.has(x as T));
    /**
     * 新增筛选项（如「航迹」）不会出现在旧 localStorage 里；
     * 若仍按旧数组恢复，相机会检测告警被永久滤掉。未在存档中出现过的合法 key 默认勾选。
     */
    for (const k of validKeys) {
      if (!parsed.includes(k)) next.push(k);
    }
    return new Set(next);
  } catch {
    return new Set(fallback);
  }
}

function persistFilterSet(storageKey: string, keys: ReadonlySet<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...keys]));
  } catch {
    /* noop */
  }
}

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

/** 目标结构航迹威胁/告警（有 trackId） */
function isTrackAlarmItem(alert: AlertData): boolean {
  if (isSystemAlarm(alert)) return false;
  return Boolean(alert.trackId?.trim()) && alert.type !== THIRD_PARTY_DETECT_ALERT_TYPE;
}

/** 告警中心「航迹」类：目标结构威胁 ∪ gRPC 检测框告警 */
function isTrackCategoryItem(alert: AlertData): boolean {
  return isTrackAlarmItem(alert) || isCameraDetectTrackAlarm(alert);
}

function isVerifiedAlarmItem(alert: AlertData): boolean {
  return alert.alarmType !== "threat";
}

function alarmKindLabel(alert: AlertData): string {
  if (isCameraDetectTrackAlarm(alert)) return "航迹";
  if (isSystemAlarm(alert)) return alert.title || alert.type || "系统";
  return isVerifiedAlarmItem(alert) ? "告警" : "威胁";
}

/** 列表时间：航迹类锁首次发现；系统告警用最新 timestamp（gRPC timestamp_ms） */
function formatAlertDisplayTime(alert: AlertData): string {
  const ms =
    alert.source === "SystemAlarm"
      ? (() => {
          // timestamp 已是可读串时优先解析；否则 firstSeenTime（已对齐 timestamp_ms）
          const raw = alert.timestamp?.trim() ?? "";
          if (raw.includes("-") || raw.includes("T")) {
            const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
            if (!Number.isNaN(d.getTime())) return d.getTime();
          }
          return alert.firstSeenTime ?? alert.lastUpdateTime ?? 0;
        })()
      : alert.firstSeenTime;
  if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) {
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
  }
  const raw = alert.timestamp?.trim() ?? "";
  if (!raw) return "";
  if (raw.includes("T")) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
  }
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
  const removeAlarmById = useAlertStore((s) => s.removeAlarmById);
  const upsertAlarm = useAlertStore((s) => s.upsertAlarm);
  const shadowTracks = useTrackStore((s) => s.shadowTracks);
  /** 多选过滤；默认全选，刷新后从 localStorage 恢复 */
  const [selectedFilters, setSelectedFilters] = useState<Set<AlertFilterKey>>(() =>
    loadPersistedFilterSet(ALERT_FILTER_STORAGE_KEY, ALL_ALERT_FILTER_KEYS, ALL_ALERT_FILTER_KEYS),
  );
  const [selectedSeverities, setSelectedSeverities] = useState<Set<AlertSeverityFilterKey>>(() =>
    loadPersistedFilterSet(
      ALERT_SEVERITY_STORAGE_KEY,
      ALL_ALERT_SEVERITY_KEYS,
      ALL_ALERT_SEVERITY_KEYS,
    ),
  );
  const [selectedSystems, setSelectedSystems] = useState<Set<AlertSystemFilterKey>>(() =>
    loadPersistedFilterSet(
      ALERT_SYSTEM_STORAGE_KEY,
      ALL_ALERT_SYSTEM_FILTER_KEYS,
      ALL_ALERT_SYSTEM_FILTER_KEYS,
    ),
  );

  useEffect(() => {
    persistFilterSet(ALERT_FILTER_STORAGE_KEY, selectedFilters);
  }, [selectedFilters]);

  useEffect(() => {
    persistFilterSet(ALERT_SEVERITY_STORAGE_KEY, selectedSeverities);
  }, [selectedSeverities]);

  useEffect(() => {
    persistFilterSet(ALERT_SYSTEM_STORAGE_KEY, selectedSystems);
  }, [selectedSystems]);

  const allSelected = selectedFilters.size === ALL_ALERT_FILTER_KEYS.length;
  const allSeveritySelected = selectedSeverities.size === ALL_ALERT_SEVERITY_KEYS.length;
  const allSystemSelected = selectedSystems.size === ALL_ALERT_SYSTEM_FILTER_KEYS.length;

  const toggleFilter = useCallback((key: AlertFilterKey) => {
    setSelectedFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAllFilters = useCallback(() => {
    setSelectedFilters((prev) => {
      if (prev.size === ALL_ALERT_FILTER_KEYS.length) return new Set();
      return new Set(ALL_ALERT_FILTER_KEYS);
    });
  }, []);

  const toggleSeverity = useCallback((key: AlertSeverityFilterKey) => {
    setSelectedSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAllSeverities = useCallback(() => {
    setSelectedSeverities((prev) => {
      if (prev.size === ALL_ALERT_SEVERITY_KEYS.length) return new Set();
      return new Set(ALL_ALERT_SEVERITY_KEYS);
    });
  }, []);

  const toggleSystem = useCallback((key: AlertSystemFilterKey) => {
    setSelectedSystems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAllSystems = useCallback(() => {
    setSelectedSystems((prev) => {
      if (prev.size === ALL_ALERT_SYSTEM_FILTER_KEYS.length) return new Set();
      return new Set(ALL_ALERT_SYSTEM_FILTER_KEYS);
    });
  }, []);

  const resolveShowId = useCallback(
    (alarmTrackId: string) => resolveShowIdFromAlarmTrackId(alarmTrackId, shadowTracks),
    [shadowTracks],
  );

  const allAlerts = useMemo(() => {
    return alerts
      // 航迹威胁：仅 ThreatLevel HIGH；系统告警（装备/通信/任务…）按自身级别进列表，
      // 由下方「级别」筛选控制。否则 GetActiveAlarms 多为 MEDIUM 时告警中心只剩航迹 HIGH。
      .filter((a) => isSystemAlarm(a) || isHighThreatAlert(a))
      .filter((a) =>
        alertMatchesFilters(a, selectedFilters, selectedSeverities, selectedSystems),
      )
      .map((a: AlertData) => ({
        ...a,
        severity: (a.severity in SEVERITY_STYLES ? a.severity : "info") as SeverityKey,
      }))
      .sort(compareAlertForAlarmCenter);
  }, [alerts, selectedFilters, selectedSeverities, selectedSystems]);

  const criticalCount = allAlerts.filter((a) => a.severity === "critical").length;

  const handleDelete = useCallback(
    async (e: React.MouseEvent, alert: (typeof allAlerts)[number]) => {
      e.stopPropagation();

      if (isSystemAlarm(alert)) {
        const alarmId = alert.id?.trim();
        const systemId = alert.systemId?.trim();
        if (!alarmId || !systemId) {
          toast.error("无法删除：系统告警缺少 id 或 systemId");
          return;
        }
        try {
          const result = await sendSystemAlarmCancelRequest({ alarmId, systemId });
          if (!result.ok) {
            toast.error("删除系统告警失败", {
              description: result.error ?? result.message ?? "告警服务无响应",
            });
            return;
          }
          removeAlarmById(alarmId);
          toast.success("已取消系统告警");
        } catch (err) {
          console.error("[AlertPanel] 取消系统告警失败:", err);
          toast.error(`删除失败: ${err instanceof Error ? err.message : "未知错误"}`);
        }
        return;
      }

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
    [shadowTracks, removeAlarmItemsByTrackId, removeAlarmById],
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
        const track =
          resolveTrackFromAlarmTrackId(alert.trackId?.trim() || String(uniqueId), shadowTracks, alert) ??
          getRenderCache().get(String(uniqueId)) ??
          null;
        const hint = track ? buildAlarmConfirmTrackHint(track) : null;
        const result = await sendAlarmConfirmRequest(uniqueId, hint);
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
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">
            告警中心
          </span>
          <span className="shrink-0 text-[10px] font-medium text-red-400">
            {criticalCount} 条严重 · {allAlerts.length} 条
          </span>
        </div>
        <div className="mt-2 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="shrink-0 text-[10px] text-nexus-text-muted">类型</span>
            <label
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                allSelected
                  ? "border-sky-500/50 bg-sky-500/15 text-sky-300"
                  : "border-white/[0.08] bg-white/[0.03] text-nexus-text-muted hover:border-white/[0.14]",
              )}
            >
              <input
                type="checkbox"
                className="size-3 accent-sky-400"
                checked={allSelected}
                ref={(el) => {
                  if (el) {
                    el.indeterminate =
                      selectedFilters.size > 0 && selectedFilters.size < ALL_ALERT_FILTER_KEYS.length;
                  }
                }}
                onChange={toggleAllFilters}
              />
              全部
            </label>
            {ALERT_FILTER_OPTIONS.map((opt) => {
              const active = selectedFilters.has(opt.key);
              return (
                <label
                  key={opt.key}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                    active
                      ? "border-sky-500/50 bg-sky-500/15 text-sky-300"
                      : "border-white/[0.08] bg-white/[0.03] text-nexus-text-muted hover:border-white/[0.14] hover:text-nexus-text-secondary",
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-3 accent-sky-400"
                    checked={active}
                    onChange={() => toggleFilter(opt.key)}
                  />
                  {opt.label}
                </label>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="shrink-0 text-[10px] text-nexus-text-muted">级别</span>
            <label
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                allSeveritySelected
                  ? "border-sky-500/50 bg-sky-500/15 text-sky-300"
                  : "border-white/[0.08] bg-white/[0.03] text-nexus-text-muted hover:border-white/[0.14]",
              )}
            >
              <input
                type="checkbox"
                className="size-3 accent-sky-400"
                checked={allSeveritySelected}
                ref={(el) => {
                  if (el) {
                    el.indeterminate =
                      selectedSeverities.size > 0 &&
                      selectedSeverities.size < ALL_ALERT_SEVERITY_KEYS.length;
                  }
                }}
                onChange={toggleAllSeverities}
              />
              全部
            </label>
            {ALERT_SEVERITY_FILTER_OPTIONS.map((opt) => {
              const active = selectedSeverities.has(opt.key);
              const accent =
                opt.key === "critical"
                  ? active
                    ? "border-red-500/50 bg-red-500/15 text-red-300"
                    : "border-white/[0.08] bg-white/[0.03] text-nexus-text-muted hover:border-white/[0.14]"
                  : opt.key === "warning"
                    ? active
                      ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
                      : "border-white/[0.08] bg-white/[0.03] text-nexus-text-muted hover:border-white/[0.14]"
                    : active
                      ? "border-zinc-400/50 bg-zinc-500/15 text-zinc-300"
                      : "border-white/[0.08] bg-white/[0.03] text-nexus-text-muted hover:border-white/[0.14]";
              return (
                <label
                  key={opt.key}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                    accent,
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-3 accent-sky-400"
                    checked={active}
                    onChange={() => toggleSeverity(opt.key)}
                  />
                  {opt.label}
                </label>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="shrink-0 text-[10px] text-nexus-text-muted">系统</span>
            <label
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                allSystemSelected
                  ? "border-sky-500/50 bg-sky-500/15 text-sky-300"
                  : "border-white/[0.08] bg-white/[0.03] text-nexus-text-muted hover:border-white/[0.14]",
              )}
            >
              <input
                type="checkbox"
                className="size-3 accent-sky-400"
                checked={allSystemSelected}
                ref={(el) => {
                  if (el) {
                    el.indeterminate =
                      selectedSystems.size > 0 &&
                      selectedSystems.size < ALL_ALERT_SYSTEM_FILTER_KEYS.length;
                  }
                }}
                onChange={toggleAllSystems}
              />
              全部
            </label>
            {ALERT_SYSTEM_FILTER_OPTIONS.map((opt) => {
              const active = selectedSystems.has(opt.key);
              return (
                <label
                  key={opt.key}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                    active
                      ? "border-sky-500/50 bg-sky-500/15 text-sky-300"
                      : "border-white/[0.08] bg-white/[0.03] text-nexus-text-muted hover:border-white/[0.14] hover:text-nexus-text-secondary",
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-3 accent-sky-400"
                    checked={active}
                    onChange={() => toggleSystem(opt.key)}
                  />
                  {opt.label}
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {allAlerts.length === 0 ? (
          <p className="px-3 py-6 text-center text-[10px] text-nexus-text-muted">暂无告警</p>
        ) : null}
        {allAlerts.map((alert) => {
          const style = resolveAlertVisualStyle(alert);
          const Icon = style.icon;
          const summary = buildAlertSummaryParts(alert, shadowTracks);
          const fuseType = isTrackAlarmItem(alert)
            ? resolveAlertFuseType(alert, shadowTracks)
            : undefined;
          const detectTrack = isCameraDetectTrackAlarm(alert);
          const kindLabel = alarmKindLabel(alert);
          const kindColor = detectTrack
            ? "text-nexus-text-primary"
            : isSystemAlarm(alert)
              ? "text-violet-300"
              : style.labelColor;
          const targetNo =
            (summary.target && summary.target !== "-"
              ? summary.target
              : alert.trackId?.trim() || alert.uniqueID?.trim() || "") || "-";

          return (
            <AlertEvidenceHoverHost key={alert.id} content={alert.content}>
            <div
              className={cn(
                "cursor-pointer border-b border-white/[0.03] border-l-2 px-2.5 py-2 transition-colors hover:bg-white/[0.03]",
                style.border,
                style.bg,
              )}
              onClick={() => {
                if (detectTrack || isSystemAlarm(alert)) return;
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
                {alert.severity === "critical" &&
                alert.type !== THIRD_PARTY_DETECT_ALERT_TYPE ? (
                  <span className="alert-critical-icon-breathe mt-0.5 inline-flex shrink-0 items-center justify-center">
                    <Icon size={14} className="relative z-[1] text-[#ff3b3b]" aria-hidden />
                  </span>
                ) : (
                  <Icon
                    size={13}
                    className={cn("mt-0.5 shrink-0", style.iconColor)}
                    aria-hidden
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {isTrackAlarmItem(alert) ? (
                        <span className="shrink-0 text-[10px] font-bold text-nexus-text-primary">
                          目标
                        </span>
                      ) : detectTrack ? (
                        <span className="shrink-0 text-[10px] font-bold text-nexus-text-primary">
                          航迹
                        </span>
                      ) : (
                        <span className={cn("shrink-0 text-[10px] font-bold", kindColor)}>
                          {kindLabel}
                        </span>
                      )}
                      <span className={cn("shrink-0 text-[10px] font-medium", style.labelColor)}>
                        {style.label}
                      </span>
                      <span className="truncate font-mono text-[10px] text-nexus-text-muted">
                        {formatAlertDisplayTime(alert)}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {isTrackAlarmItem(alert) && !isVerifiedAlarmItem(alert) && (
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
                      {(isTrackCategoryItem(alert) || isSystemAlarm(alert)) && (
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
                      )}
                      {isTrackAlarmItem(alert) && (
                        <>
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
                        </>
                      )}
                    </div>
                  </div>

                  {detectTrack || isSystemAlarm(alert) ? (
                    <>
                      <p
                        className="mt-0.5 break-words text-[10px] leading-snug text-nexus-text-primary"
                        title={alert.message}
                      >
                        {alert.message}
                      </p>
                      {alert.detail ? (
                        <p
                          className="mt-0.5 truncate text-[10px] text-nexus-text-secondary/80"
                          title={alert.detail}
                        >
                          {alert.detail}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <p
                        className="mt-0.5 break-words text-[10px] leading-snug text-nexus-text-primary"
                        title={`目标编号：${targetNo}, 位置：${summary.position}, 区域：${summary.area}`}
                      >
                        <span className="inline-flex flex-wrap items-center gap-0.5">
                          目标编号：
                          {fuseType === 0 || fuseType === 1 ? (
                            <AlertTrackFuseIcon fuseType={fuseType} />
                          ) : null}
                          <span className="font-mono">{targetNo}</span>
                        </span>
                        , 位置：{summary.position}, 区域：{summary.area}
                      </p>

                      {isTrackAlarmItem(alert) && alert.content?.trim() ? (
                        <p
                          className="mt-0.5 break-words text-[10px] leading-snug text-nexus-text-secondary/90"
                          title={alarmEvidenceSummaryText(alert.content) || alert.content}
                        >
                          证据链：{alarmEvidenceSummaryText(alert.content) || alert.content}
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
                    </>
                  )}
                </div>
              </div>
            </div>
            </AlertEvidenceHoverHost>
          );
        })}
      </div>
    </div>
  );
}
