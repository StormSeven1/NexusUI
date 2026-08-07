/**
 * alert-store — 实时告警列表（对齐 V2 appState.js 逻辑）
 *
 * 【数据流】
 *   WS 推送（alert_batch / map_command alert / alert / threat）
 *   → ws-alert-normalize 归一化 → upsertAlarm / upsertThreat / addAlerts
 *   → AlertPanel UI 展示
 *
 * 【去重策略】
 *   - 优先按业务 trackId 去重（同一 trackId 只维护最新一条）
 *   - 无 trackId 时按 id 去重
 *
 * 【处置过滤】
 *   - upsertAlarm / upsertThreat / addAlerts 入口检查 disposedStore
 *   - 已处置 trackId 的告警直接跳过，不入库
 *   - removeAlarmItemsByTrackId：消灭按钮调用，从列表中移除指定 trackId 的告警
 *
 * 【版本号机制】
 *   - alarmTrackRevision：仅在 alarmTrackIds Set **真正变化**时递增
 *   - 航迹层订阅此数字变化来触发 syncWithAlarms（提升/降级渲染层航迹）
 *
 * 【过期清理】
 *   - removeStaleAlarms：超过 ALARM_STALE_MS（25s）未更新的告警移除
 *   - MAX_ALERTS：最多保留 200 条告警
 */

import { create } from "zustand";
import type { AlarmFilterFuseType } from "@/lib/alarm-filter-api";
import { buildAlarmMatchKeysFromAlerts } from "@/lib/alarm-track-match";
import { isSuspiciousAlarmMarker } from "@/lib/suspicious-alarm-marker";
import { useDisposedStore } from "@/stores/disposed-store";

export interface AlertData {
  /** 告警唯一 ID（由前端生成或后端提供） */
  id: string;
  /** 严重级别 */
  severity: "critical" | "warning" | "info";
  /** 告警消息内容 */
  message: string;
  /** 告警时间戳 */
  timestamp: string;
  /** 业务航迹 trackId（告警匹配用，用于关联航迹和处置） */
  trackId?: string;
  /** 告警目标纬度 */
  lat?: number;
  /** 告警目标经度 */
  lng?: number;
  /** 告警类型（如「入侵」「异常」） */
  type?: string;
  /** 告警/威胁类型标记 */
  alarmType?: "alert" | "threat";
  /** 首次发现时间（ms 时间戳） */
  firstSeenTime?: number;
  /** 最后更新时间（ms 时间戳） */
  lastUpdateTime?: number;
  /** 标题（与 message 分离展示） */
  title?: string;
  /** 告警来源（如「雷达」「光电」） */
  source?: string;
  /** 告警等级（数值；AlarmSys DDS 中常与 threatScore 同源） */
  alarmLevel?: number;
  /** 威胁度（优先用于 Top5 排序；缺省回退 alarmLevel） */
  threatScore?: number;
  /** 区域名称 */
  areaName?: string;
  /** 区域判断（进入/离开/靠近/区域内，对齐 Qt area_judge） */
  areaJudge?: string;
  /** 详细描述 */
  detail?: string;
  /** 证据链 / 告警原因（NewTrackStruct TargetAlarmItem.content） */
  content?: string;
  /** uniqueID（与 track-store showID 对应） */
  uniqueID?: string;
  /** 0=对海融合，1=对空融合（AlarmSys 规则 / DDS track.trackType） */
  fuseType?: AlarmFilterFuseType;
  /** 查证图片 URL */
  imageUrl?: string;
  /** 相对本舰/参考点距离（海里），WS 或航迹补齐 */
  distanceNm?: number;
  /** 方位角（度，0–360），WS 或航迹补齐 */
  bearingDeg?: number;
  /** 系统告警类型码（GetActiveAlarms / SystemAlarm） */
  systemAlarmKind?:
    | "EQUIPMENT"
    | "DATA_COMM"
    | "TASK"
    | "ENVIRONMENT"
    | "COMPREHENSIVE"
    | "SYSTEM_AUTH";
  /** 上报方系统 ID，如 sys-005 */
  systemId?: string;
  /** 系统告警关联实体 */
  entityId?: string;
  /**
   * 系统告警扩展字段（GetActiveAlarms / SystemAlarm）。
   * 例：相机检测可疑目标 `reserved3=track`，见 `system-alarm.ts`。
   */
  reserved3?: string;
}

/**
 * 告警过期时间：60s。
 * AlarmSys 的 gRPC 快照推送与 processAlarms 同线程；processAlarms 受轨迹量影响偶尔耗时
 * 超过 20s，导致快照中断。60s 窗口可容忍更长的处理延迟，避免告警误判过期后闪烁消失。
 */
const ALARM_STALE_MS = 60_000;
const MAX_ALERTS = 200;

/** 合并同航迹告警：NewTrackStruct 主要带证据链；严重度只升不降，避免 Top5 排名跳变导致严重↔信息闪烁 */
const SEVERITY_RANK: Record<AlertData["severity"], number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

function stickierSeverity(
  a: AlertData["severity"],
  b: AlertData["severity"],
): AlertData["severity"] {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** alarmLevel：取较大值，避免 Top5 排名 0 覆盖威胁分/高等级 */
function stickyAlarmLevel(
  existing: number | undefined,
  incoming: number | undefined,
): number | undefined {
  if (existing == null) return incoming;
  if (incoming == null) return existing;
  return Math.max(existing, incoming);
}

function mergeAlertFields(existing: AlertData, incoming: AlertData): AlertData {
  const incomingFromNewTrack = incoming.source === "NewTrackStruct";
  const existingFromAlarmEvent = existing.source !== "NewTrackStruct";

  let merged: AlertData;
  if (incomingFromNewTrack && existingFromAlarmEvent) {
    merged = {
      ...existing,
      ...incoming,
      severity: stickierSeverity(existing.severity, incoming.severity),
      alarmLevel: stickyAlarmLevel(existing.alarmLevel, incoming.alarmLevel),
      threatScore:
        existing.threatScore != null && incoming.threatScore != null
          ? Math.max(existing.threatScore, incoming.threatScore)
          : (existing.threatScore ?? incoming.threatScore),
      message: existing.message || incoming.message,
      source: existing.source,
      content: incoming.content?.trim() ? incoming.content : existing.content,
    };
  } else if (!incomingFromNewTrack && existing.source === "NewTrackStruct") {
    merged = {
      ...existing,
      ...incoming,
      severity: stickierSeverity(existing.severity, incoming.severity),
      alarmLevel: stickyAlarmLevel(existing.alarmLevel, incoming.alarmLevel),
      threatScore:
        existing.threatScore != null && incoming.threatScore != null
          ? Math.max(existing.threatScore, incoming.threatScore)
          : (existing.threatScore ?? incoming.threatScore),
      content: existing.content?.trim() ? existing.content : incoming.content,
    };
  } else {
    merged = {
      ...existing,
      ...incoming,
      severity: stickierSeverity(existing.severity, incoming.severity),
      threatScore:
        existing.threatScore != null && incoming.threatScore != null
          ? Math.max(existing.threatScore, incoming.threatScore)
          : (existing.threatScore ?? incoming.threatScore),
      alarmLevel: stickyAlarmLevel(existing.alarmLevel, incoming.alarmLevel),
    };
  }

  // 列表展示时间锁定首次出现，避免每秒 updateTime / 双源格式切换导致跳动
  merged.timestamp = existing.timestamp || incoming.timestamp;
  merged.firstSeenTime = existing.firstSeenTime ?? incoming.firstSeenTime;
  return merged;
}

/** 从告警条目提取业务 trackId */
function getAlarmTrackId(item: AlertData): string | null {
  const raw = item.trackId;
  if (raw != null && raw.trim() !== "") return raw.trim();
  return null;
}

/** 去重键：按业务 trackId */
function alarmDedupeKey(item: AlertData): string | null {
  return getAlarmTrackId(item);
}

/** 判断两个 Set<string> 内容是否相同 */
function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

interface AlertState {
  alerts: AlertData[];
  /**
   * 告警匹配键集合（航迹提升/着色用）。
   * 见 `alarm-track-match.ts`（`u:` / `t:0:` / `t:1:` / `t:*:` 前缀，非裸 trackId）。
   */
  alarmTrackIds: Set<string>;
  /** 仅在 alarmTrackIds Set 真正变化时递增 */
  alarmTrackRevision: number;
  /** 告警闪烁标记（有告警时为 true） */
  alarmFlashing: boolean;

  upsertAlarm: (alarm: AlertData) => void;
  upsertThreat: (threat: AlertData) => void;
  addAlerts: (newAlerts: AlertData[]) => void;
  removeStaleAlarms: () => void;
  removeAlarmItemsByTrackId: (trackId: string) => void;
  /** 按告警 id 移除（第三方相机检测等无 trackId 告警） */
  removeAlarmById: (id: string) => void;
  /**
   * 用 GetActiveAlarms 全量快照替换系统告警（source=SystemAlarm）。
   * 航迹/其它来源告警保留；取消后的系统告警本轮不再出现即移除。
   */
  syncSystemAlarms: (systemAlerts: AlertData[]) => void;
  clearAlarmFlashing: () => void;
  clearAlerts: () => void;
}

export const useAlertStore = create<AlertState>((set, get) => ({
  alerts: [],
  alarmTrackIds: new Set<string>(),
  alarmTrackRevision: 0,
  alarmFlashing: false,

  /** 加入或更新告警：同一 trackId 只维护一条 */
  upsertAlarm: (alarm) =>
    set((s) => {
      // 已处置的 trackId 的告警跳过
      if (alarm.trackId && useDisposedStore.getState().isBusinessTrackDisposed(alarm.trackId)) return s;
      const now = Date.now();
      const k = alarmDedupeKey(alarm);
      let next: AlertData[];
      if (k) {
        const idx = s.alerts.findIndex((a) => alarmDedupeKey(a) === k);
        if (idx !== -1) {
          const existing = s.alerts[idx];
          next = [...s.alerts];
          next[idx] = {
            ...mergeAlertFields(existing, alarm),
            alarmType: "alert",
            firstSeenTime: existing.firstSeenTime ?? now,
            lastUpdateTime: now,
          };
        } else {
          next = [{ ...alarm, alarmType: "alert", firstSeenTime: now, lastUpdateTime: now }, ...s.alerts];
        }
      } else {
        const idx = s.alerts.findIndex((a) => a.id === alarm.id);
        if (idx !== -1) {
          next = [...s.alerts];
          next[idx] = {
            ...mergeAlertFields(s.alerts[idx], alarm),
            alarmType: "alert",
            lastUpdateTime: now,
          };
        } else {
          next = [{ ...alarm, alarmType: "alert", firstSeenTime: now, lastUpdateTime: now }, ...s.alerts];
        }
      }
      next = next.slice(0, MAX_ALERTS);
      return applyRevision({ ...s, alerts: next, alarmFlashing: next.length > 0 });
    }),

  /** 威胁数据：同一 trackId 只维护一条 */
  upsertThreat: (threat) =>
    set((s) => {
      if (threat.trackId && useDisposedStore.getState().isBusinessTrackDisposed(threat.trackId)) return s;
      const now = Date.now();
      const k = alarmDedupeKey(threat);
      let next: AlertData[];
      if (k) {
        const idx = s.alerts.findIndex((a) => alarmDedupeKey(a) === k);
        if (idx !== -1) {
          const existing = s.alerts[idx];
          next = [...s.alerts];
          next[idx] = {
            ...mergeAlertFields(existing, threat),
            alarmType: existing.alarmType,
            firstSeenTime: existing.firstSeenTime ?? now,
            lastUpdateTime: now,
          };
        } else {
          next = [{ ...threat, alarmType: "threat", firstSeenTime: now, lastUpdateTime: now }, ...s.alerts];
        }
      } else {
        next = [{ ...threat, alarmType: "threat", firstSeenTime: now, lastUpdateTime: now }, ...s.alerts];
      }
      next = next.slice(0, MAX_ALERTS);
      return applyRevision({ ...s, alerts: next, alarmFlashing: next.length > 0 });
    }),

  /** 批量添加告警 */
  addAlerts: (newAlerts) => {
    const s = get();
    for (const a of newAlerts) {
      s.upsertAlarm(a);
    }
  },

  /** 移除过期告警（超过 ALARM_STALE_MS 未更新）；系统告警由 2s 快照同步，不参与过期清理 */
  removeStaleAlarms: () =>
    set((s) => {
      const now = Date.now();
      const next = s.alerts.filter((item) => {
        if (isSuspiciousAlarmMarker(item as unknown as Record<string, unknown>)) return false;
        if (item.source === "SystemAlarm") return true;
        const raw = item.lastUpdateTime ?? new Date(item.timestamp).getTime();
        const lastUpdate = typeof raw === "number" ? raw : 0;
        return now - lastUpdate < ALARM_STALE_MS;
      });
      if (next.length === s.alerts.length) return s;
      return applyRevision({ ...s, alerts: next, alarmFlashing: next.length > 0 });
    }),

  /** 按 trackId / uniqueID 移除告警条目（与 AlarmSys unique_id 对齐） */
  removeAlarmItemsByTrackId: (trackId) =>
    set((s) => {
      const needle = String(trackId).trim();
      if (!needle) return s;
      const next = s.alerts.filter((a) => {
        const tid = getAlarmTrackId(a);
        if (tid != null && tid === needle) return false;
        const uid = a.uniqueID?.trim();
        if (uid && uid === needle) return false;
        return true;
      });
      if (next.length === s.alerts.length) return s;
      return applyRevision({ ...s, alerts: next, alarmFlashing: next.length > 0 });
    }),

  removeAlarmById: (id) =>
    set((s) => {
      const needle = String(id).trim();
      if (!needle) return s;
      const next = s.alerts.filter((a) => a.id !== needle);
      if (next.length === s.alerts.length) return s;
      return applyRevision({ ...s, alerts: next, alarmFlashing: next.length > 0 });
    }),

  syncSystemAlarms: (systemAlerts) =>
    set((s) => {
      const keep = s.alerts.filter((a) => a.source !== "SystemAlarm");
      const now = Date.now();
      // 全量替换系统告警，保留上报方最新 timestamp / 描述 / 级别（勿锁死首次时间）
      const incoming = systemAlerts.map((a) => ({
        ...a,
        source: "SystemAlarm" as const,
        alarmType: "alert" as const,
        firstSeenTime: a.firstSeenTime ?? now,
        lastUpdateTime: now,
      }));
      const next = [...incoming, ...keep].slice(0, MAX_ALERTS);
      return applyRevision({ ...s, alerts: next, alarmFlashing: next.length > 0 });
    }),

  clearAlarmFlashing: () => set({ alarmFlashing: false }),

  clearAlerts: () =>
    set((s) => {
      if (s.alerts.length === 0 && s.alarmTrackIds.size === 0) return s;
      return { alerts: [], alarmTrackIds: new Set<string>(), alarmTrackRevision: s.alarmTrackRevision + 1, alarmFlashing: false };
    }),
}));

/**
 * 重算 alarmTrackIds Set，仅在 Set 真正变化时递增 alarmTrackRevision。
 * 同时剔除误入的可疑标记；仅 HIGH 写入 alarmTrackIds（态势蓝）。
 */
function applyRevision<T extends { alerts: AlertData[]; alarmTrackIds: Set<string>; alarmTrackRevision: number }>(
  state: T,
): T {
  const alerts = state.alerts.filter(
    (a) => !isSuspiciousAlarmMarker(a as unknown as Record<string, unknown>),
  );
  const newIds = buildAlarmMatchKeysFromAlerts(alerts);
  const alertsChanged = alerts.length !== state.alerts.length;
  if (!alertsChanged && setsEqual(newIds, state.alarmTrackIds)) return state;
  return {
    ...state,
    alerts,
    alarmTrackIds: newIds,
    alarmTrackRevision: state.alarmTrackRevision + 1,
  };
}
