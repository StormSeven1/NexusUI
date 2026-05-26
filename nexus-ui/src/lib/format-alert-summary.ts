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
  if (alert.alarmLevel != null && Number.isFinite(alert.alarmLevel)) {
    return String(alert.alarmLevel);
  }
  return SEVERITY_LEVEL_LABEL[alert.severity] ?? "-";
}

/**
 * 告警单行摘要：`目标：x, 位置：x, 区域：x, 等级：x`（逗号分隔，对齐 Qt 列表语义）
 */
export function formatAlertSummaryLine(
  alert: AlertData,
  shadowTracks: ReadonlyMap<string, Track>,
): string {
  const track =
    (alert.trackId ? resolveTrackFromAlarmTrackId(alert.trackId, shadowTracks) : null) ??
    (alert.uniqueID
      ? getRenderCache().get(alert.uniqueID) ?? shadowTracks.get(alert.uniqueID) ?? null
      : null);

  const target = pickTargetId(alert, track);
  const position = pickPosition(alert, track);
  const area = pickArea(alert);
  const level = pickLevel(alert);

  return `目标：${target}, 位置：${position}, 区域：${area}, 等级：${level}`;
}
