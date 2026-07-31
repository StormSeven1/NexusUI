import type { AlertData } from "@/stores/alert-store";
import type { Track } from "@/lib/map-entity-model";
import { getRenderCache } from "@/stores/track-store";
import { resolveTrackFromAlarmTrackId } from "@/lib/run-gis-track-verification";

const SEVERITY_LEVEL_LABEL: Record<AlertData["severity"], string> = {
  critical: "高",
  warning: "中",
  info: "低",
};

function pickTargetId(alert: AlertData, track: Track | null): string {
  const candidates = [
    alert.trackId,
    alert.uniqueID,
    track?.trackId,
    track?.showID,
    track?.uniqueID,
  ];
  for (const c of candidates) {
    const s = c != null ? String(c).trim() : "";
    if (s && s !== "0") return s;
  }
  return "-";
}

/** 位置：优先区域动作（进入/离开），其次距离方位，再次经纬度 */
function pickPosition(alert: AlertData, track: Track | null): string {
  if (alert.areaJudge?.trim()) return alert.areaJudge.trim();

  const dist = alert.distanceNm;
  const bearing = alert.bearingDeg;
  if (dist != null && Number.isFinite(dist)) {
    const distStr = `${dist.toFixed(1)}海里`;
    if (bearing != null && Number.isFinite(bearing)) {
      return `${distStr}/${Math.round(bearing)}°`;
    }
    return distStr;
  }

  const lat = alert.lat ?? track?.lat;
  const lng = alert.lng ?? track?.lng;
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${lng.toFixed(4)},${lat.toFixed(4)}`;
  }
  return "-";
}

function pickArea(alert: AlertData): string {
  return alert.areaName?.trim() || "-";
}

function pickLevel(alert: AlertData): string {
  // 威胁度优先用稳定的 threatScore；勿用 AlarmSys Top5 排名写入的 alarmLevel(0↔5) 导致 0/25 闪烁
  if (alert.threatScore != null && Number.isFinite(alert.threatScore) && alert.threatScore > 0) {
    return String(Math.round(alert.threatScore));
  }
  if (alert.alarmLevel != null && Number.isFinite(alert.alarmLevel) && alert.alarmLevel > 5) {
    // 少数链路把威胁分写在 alarmLevel，且明显不是 0~5 排名
    return String(Math.round(alert.alarmLevel));
  }
  return SEVERITY_LEVEL_LABEL[alert.severity] ?? "-";
}

export type AlertSummaryParts = {
  target: string;
  position: string;
  area: string;
  level: string;
};

function resolveAlertTrack(
  alert: AlertData,
  shadowTracks: ReadonlyMap<string, Track>,
): Track | null {
  return (
    (alert.trackId ? resolveTrackFromAlarmTrackId(alert.trackId, shadowTracks, alert) : null) ??
    (alert.uniqueID
      ? getRenderCache().get(alert.uniqueID) ?? shadowTracks.get(alert.uniqueID) ?? null
      : null)
  );
}

/** 告警摘要各字段（供列表带海/空图标渲染） */
export function buildAlertSummaryParts(
  alert: AlertData,
  shadowTracks: ReadonlyMap<string, Track>,
): AlertSummaryParts {
  const track = resolveAlertTrack(alert, shadowTracks);
  return {
    target: pickTargetId(alert, track),
    position: pickPosition(alert, track),
    area: pickArea(alert),
    level: pickLevel(alert),
  };
}

/**
 * 告警单行摘要：`目标：x, 位置：x, 区域：x`（威胁分改由证据链展示，不再带等级）
 */
export function formatAlertSummaryLine(
  alert: AlertData,
  shadowTracks: ReadonlyMap<string, Track>,
): string {
  const { target, position, area } = buildAlertSummaryParts(alert, shadowTracks);
  return `目标：${target}, 位置：${position}, 区域：${area}`;
}
