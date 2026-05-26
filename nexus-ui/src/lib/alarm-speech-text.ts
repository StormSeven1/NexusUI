import type { Track } from "@/lib/map-entity-model";
import { findTrackForTaskStatusVerify } from "@/lib/task-status-track-enrich";
import type { AlertData } from "@/stores/alert-store";

const NM_PER_METRE = 1 / 1852;

function fmtNm(nm: number): string {
  const rounded = Math.round(nm * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function fmtBearing(deg: number): string {
  return String(Math.round(((deg % 360) + 360) % 360));
}

/** 目标尾号：trackId / uniqueID 末 4 位数字，不足则末 4 字符 */
export function extractAlarmTailNumber(alert: AlertData): string {
  const raw = (alert.trackId ?? alert.uniqueID ?? "").trim();
  if (!raw) return "未知";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  if (raw.length >= 4) return raw.slice(-4);
  return raw;
}

function findTrackForAlert(alert: AlertData, tracks: readonly Track[]): Track | undefined {
  const tid = alert.trackId?.trim();
  if (tid) {
    const asNum = Number(tid);
    if (Number.isFinite(asNum)) {
      const byNum = findTrackForTaskStatusVerify(asNum, tracks);
      if (byNum) return byNum;
    }
    for (const t of tracks) {
      if (t.trackId === tid || t.uniqueID === tid || t.showID === tid) return t;
    }
  }
  const uid = alert.uniqueID?.trim();
  if (uid) {
    for (const t of tracks) {
      if (t.uniqueID === uid || t.showID === uid || t.trackId === uid) return t;
    }
  }
  return undefined;
}

/** 拼装语音文案：「距离xx海里，方位xx度发现威胁目标，目标尾号xxxx」 */
export function buildAlarmSpeechText(alert: AlertData, tracks: readonly Track[]): string {
  let distanceNm = alert.distanceNm;
  let bearingDeg = alert.bearingDeg;

  const track = findTrackForAlert(alert, tracks);
  if (track) {
    if (distanceNm == null && track.distance != null && Number.isFinite(track.distance)) {
      distanceNm = track.distance * NM_PER_METRE;
    }
    if (bearingDeg == null) {
      const a = track.azimuth ?? track.course ?? track.heading;
      if (a != null && Number.isFinite(a)) bearingDeg = a;
    }
  }

  const distPart =
    distanceNm != null && Number.isFinite(distanceNm) ? fmtNm(distanceNm) : "未知";
  const bearPart =
    bearingDeg != null && Number.isFinite(bearingDeg) ? fmtBearing(bearingDeg) : "未知";
  const tail = extractAlarmTailNumber(alert);

  return `距离${distPart}海里，方位${bearPart}度发现威胁目标，目标尾号${tail}`;
}
