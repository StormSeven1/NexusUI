import type { Track } from "@/lib/map-entity-model";
import { isTrackAlarmLinked } from "@/stores/track-store";
import { SUSPICIOUS_TRACK_MAP_COLOR } from "@/lib/suspicious-track-constants";
import { useAlertStore, type AlertData } from "@/stores/alert-store";
import { getThreatScoreFromAlert } from "@/lib/alarm-track-threat-rank";
import {
  isHighThreatAlert,
  resolveAlertThreatLevel,
  threatLevelName,
  type ThreatLevelRank,
} from "@/lib/alarm-threat-level";

function alertMatchesTrack(
  a: AlertData,
  track: Pick<Track, "uniqueID" | "showID" | "trackId">,
): boolean {
  const uid = track.uniqueID != null ? String(track.uniqueID).trim() : "";
  const sid = track.showID != null ? String(track.showID).trim() : "";
  const tid = track.trackId != null ? String(track.trackId).trim() : "";
  const aUid = a.uniqueID?.trim() ?? "";
  const aTid = a.trackId?.trim() ?? "";
  if (uid && (aUid === uid || aTid === uid)) return true;
  if (sid && (aUid === sid || aTid === sid)) return true;
  if (tid && (aUid === tid || aTid === tid)) return true;
  return false;
}

/** 从告警 content（区域升级 JSON）解析 score */
function threatScoreFromAlertContent(content: string | undefined): number | undefined {
  const raw = String(content ?? "").trim();
  if (!raw.startsWith("{")) return undefined;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const s = o.score ?? o.threatScore ?? o.threat_score;
    if (typeof s === "number" && Number.isFinite(s)) return s;
    if (typeof s === "string" && s.trim()) {
      const n = Number(s.trim());
      if (Number.isFinite(n)) return n;
    }
  } catch {
    /* 非 JSON 证据链 */
  }
  return undefined;
}

function resolveThreatScoreForAlert(a: AlertData): number | undefined {
  const fromContent = threatScoreFromAlertContent(a.content);
  if (fromContent != null) return fromContent;
  if (a.threatScore != null && Number.isFinite(a.threatScore) && a.threatScore > 0) {
    return a.threatScore;
  }
  const ranked = getThreatScoreFromAlert(a);
  // alarmLevel 0/1/2 是 ThreatLevel，不能当威胁分；>2 才可能是分数残留
  if (ranked > 2) return ranked;
  return undefined;
}

/** 航迹关联告警中级别最高的一条（并列取威胁分更高） */
function bestAlertForTrack(
  track: Pick<Track, "uniqueID" | "showID" | "trackId">,
): { alert: AlertData; level: ThreatLevelRank } | null {
  let best: { alert: AlertData; level: ThreatLevelRank; score: number } | null = null;
  const alerts = useAlertStore.getState().alerts;
  for (const a of alerts) {
    if (!alertMatchesTrack(a, track)) continue;
    const level = resolveAlertThreatLevel(a);
    if (level == null) continue;
    const score = resolveThreatScoreForAlert(a) ?? 0;
    if (!best || level > best.level || (level === best.level && score > best.score)) {
      best = { alert: a, level, score };
    }
  }
  return best ? { alert: best.alert, level: best.level } : null;
}

/** 航迹关联告警的最高 ThreatLevel */
function trackMaxThreatLevel(
  track: Pick<Track, "uniqueID" | "showID" | "trackId">,
): ThreatLevelRank | null {
  return bestAlertForTrack(track)?.level ?? null;
}

/** 该航迹是否关联 HIGH 正式告警（态势蓝） */
function trackHasHighAlarm(track: Pick<Track, "uniqueID" | "showID" | "trackId">): boolean {
  if (isTrackAlarmLinked(track as Track)) return true;
  const alerts = useAlertStore.getState().alerts;
  for (const a of alerts) {
    if (!isHighThreatAlert(a)) continue;
    if (alertMatchesTrack(a, track)) return true;
  }
  return false;
}

/** 该航迹关联告警最高级是否为 MEDIUM（态势黄） */
function trackHasMediumAlarm(track: Pick<Track, "uniqueID" | "showID" | "trackId">): boolean {
  return trackMaxThreatLevel(track) === 1;
}

/**
 * 预警目标标黄（ThreatLevel MEDIUM）：HIGH 告警蓝时不覆盖。
 * 函数名保留兼容军标/列表调用点。
 */
export function shouldApplySuspiciousTrackGreen(
  track: Pick<Track, "uniqueID" | "showID" | "trackId">,
): boolean {
  if (trackHasHighAlarm(track)) return false;
  return trackHasMediumAlarm(track);
}

/** @deprecated 请用 shouldApplySuspiciousTrackGreen（现为黄色预警目标） */
export const shouldApplySuspiciousTrackYellow = shouldApplySuspiciousTrackGreen;

/** 地图态势色优先级：蓝(HIGH) > 黄(MEDIUM) > 默认；LOW 与普通航迹同色。不读 is_suspicious。 */
export function resolveTrackMapHighlightFill(
  track: Pick<Track, "uniqueID" | "showID" | "trackId">,
  baseFill: string,
): string {
  if (trackHasHighAlarm(track)) {
    return baseFill;
  }
  if (trackHasMediumAlarm(track)) {
    return SUSPICIOUS_TRACK_MAP_COLOR;
  }
  return baseFill;
}

/**
 * 黄/蓝目标标牌「类型」后缀：`(MEDIUM, 65)` / `(HIGH, 80)`。
 * 非预警/告警（无 MEDIUM/HIGH）返回 null。
 */
export function formatTrackAlarmThreatParen(
  track: Pick<Track, "uniqueID" | "showID" | "trackId">,
): string | null {
  const best = bestAlertForTrack(track);
  if (!best || best.level < 1) return null;
  const name = threatLevelName(best.level);
  const score = resolveThreatScoreForAlert(best.alert);
  if (score != null && Number.isFinite(score)) {
    return `(${name}, ${Math.round(score)})`;
  }
  return `(${name})`;
}
