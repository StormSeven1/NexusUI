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
  /** 告警等级（数值） */
  alarmLevel?: number;
  /** 区域名称 */
  areaName?: string;
  /** 详细描述 */
  detail?: string;
  /** uniqueID（与 track-store showID 对应） */
  uniqueID?: string;
  /** 查证图片 URL */
  imageUrl?: string;
}

/** 告警过期时间（对齐 V2 ALARM_STALE_MS = 25s） */
const ALARM_STALE_MS = 25_000;
const MAX_ALERTS = 200;

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
  /** 当前有效告警的 trackId 集合（航迹匹配用） */
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
            ...existing,
            ...alarm,
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
          next[idx] = { ...s.alerts[idx], ...alarm, alarmType: "alert", lastUpdateTime: now };
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
            ...existing,
            ...threat,
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

  /** 移除过期告警（超过 ALARM_STALE_MS 未更新） */
  removeStaleAlarms: () =>
    set((s) => {
      const now = Date.now();
      const next = s.alerts.filter((item) => {
        const raw = item.lastUpdateTime ?? new Date(item.timestamp).getTime();
        const lastUpdate = typeof raw === "number" ? raw : 0;
        return now - lastUpdate < ALARM_STALE_MS;
      });
      if (next.length === s.alerts.length) return s;
      return applyRevision({ ...s, alerts: next, alarmFlashing: next.length > 0 });
    }),

  /** 按 trackId 移除告警条目 */
  removeAlarmItemsByTrackId: (trackId) =>
    set((s) => {
      const needle = String(trackId).trim();
      const next = s.alerts.filter((a) => {
        const tid = getAlarmTrackId(a);
        return !(tid != null && tid === needle);
      });
      if (next.length === s.alerts.length) return s;
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
 */
function applyRevision<T extends { alerts: AlertData[]; alarmTrackIds: Set<string>; alarmTrackRevision: number }>(
  state: T,
): T {
  const newIds = new Set<string>();
  for (const a of state.alerts) {
    const tid = getAlarmTrackId(a);
    if (tid) newIds.add(tid);
  }
  if (setsEqual(newIds, state.alarmTrackIds)) return state;
  return { ...state, alarmTrackIds: newIds, alarmTrackRevision: state.alarmTrackRevision + 1 };
}
