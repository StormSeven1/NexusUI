import type { AlertData } from "@/stores/alert-store";
import type { Track } from "@/lib/map-entity-model";
import { getRenderCache } from "@/stores/track-store";
import { resolveShowIdFromAlarm } from "@/lib/alarm-track-match";
import { isHighThreatAlert } from "@/lib/alarm-threat-level";
import { THIRD_PARTY_DETECT_ALERT_TYPE } from "@/lib/third-party-ptz-fov";

/** 告警 WS 中 `alarmLevel` 在 AlarmSys 侧实为 `threatScore`（威胁度） */
export function getThreatScoreFromAlert(alert: AlertData): number {
  if (alert.threatScore != null && Number.isFinite(alert.threatScore)) {
    return alert.threatScore;
  }
  if (alert.alarmLevel != null && Number.isFinite(alert.alarmLevel)) {
    return alert.alarmLevel;
  }
  return 0;
}

function resolveShowIdForAlarm(
  alert: AlertData,
  shadowTracks: ReadonlyMap<string, Track>,
): string | null {
  return resolveShowIdFromAlarm(alert, shadowTracks);
}

/**
 * 告警航迹按威胁度降序取 Top5，返回 showID → 地图序号（1=最高威胁）。
 * 与 AlarmSys `customconfig` 按 threatScore 排序逻辑一致。
 */
export function computeTopThreatRankByShowId(
  alerts: readonly AlertData[],
  shadowTracks: ReadonlyMap<string, Track>,
): Map<string, number> {
  const best = new Map<string, { score: number; trackId: string }>();

  for (const a of alerts) {
    if (!isHighThreatAlert(a)) continue;
    if (!a.trackId?.trim()) continue;
    if (a.type === THIRD_PARTY_DETECT_ALERT_TYPE) continue;
    const showId = resolveShowIdForAlarm(a, shadowTracks);
    if (!showId) continue;
    /** 仅地图渲染层（告警关联航迹）参与排序与标号 */
    if (!getRenderCache().has(showId)) continue;

    const score = getThreatScoreFromAlert(a);
    const trackId = a.trackId.trim();
    const prev = best.get(showId);
    if (!prev || score > prev.score) {
      best.set(showId, { score, trackId });
    }
  }

  const sorted = [...best.entries()].sort((a, b) => {
    if (b[1].score !== a[1].score) return b[1].score - a[1].score;
    return a[1].trackId.localeCompare(b[1].trackId);
  });

  const out = new Map<string, number>();
  for (let i = 0; i < Math.min(5, sorted.length); i++) {
    out.set(sorted[i][0], i + 1);
  }
  return out;
}

/** 指纹用：稳定序列化 rank 表 */
export function threatRankSignature(rankByShowId: ReadonlyMap<string, number>): string {
  if (rankByShowId.size === 0) return "";
  return [...rankByShowId.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join("|");
}
