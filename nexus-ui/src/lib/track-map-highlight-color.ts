import type { Track } from "@/lib/map-entity-model";
import { isTrackAlarmLinked } from "@/stores/track-store";
import { isTrackSuspicious } from "@/stores/suspicious-track-store";
import { SUSPICIOUS_TRACK_MAP_COLOR } from "@/lib/suspicious-track-constants";
import { useAlertStore } from "@/stores/alert-store";
import { isSuspiciousAlarmMarker } from "@/lib/suspicious-alarm-marker";

/** 该航迹是否关联「非可疑」真实威胁/告警（决定蓝色） */
function trackHasRealThreatAlarm(
  track: Pick<Track, "uniqueID" | "showID" | "trackId">,
): boolean {
  if (!isTrackAlarmLinked(track as Track)) return false;
  const uid = track.uniqueID != null ? String(track.uniqueID).trim() : "";
  const sid = track.showID != null ? String(track.showID).trim() : "";
  const tid = track.trackId != null ? String(track.trackId).trim() : "";
  const alerts = useAlertStore.getState().alerts;
  for (const a of alerts) {
    if (isSuspiciousAlarmMarker(a as unknown as Record<string, unknown>)) continue;
    const aUid = a.uniqueID?.trim() ?? "";
    const aTid = a.trackId?.trim() ?? "";
    if (uid && (aUid === uid || aTid === uid)) return true;
    if (sid && (aUid === sid || aTid === sid)) return true;
    if (tid && (aUid === tid || aTid === tid)) return true;
  }
  // 渲染层已关联但告警列表已被清掉可疑后仍可能短暂命中：不算真实威胁
  return false;
}

/** 重点关注标黄：仅真实威胁（蓝）时不覆盖 */
export function shouldApplySuspiciousTrackGreen(
  track: Pick<Track, "uniqueID" | "showID" | "trackId" | "isSuspicious">,
): boolean {
  if (!isTrackSuspicious(track)) return false;
  if (trackHasRealThreatAlarm(track)) return false;
  return true;
}

/** @deprecated 请用 shouldApplySuspiciousTrackGreen（现为黄色重点关注） */
export const shouldApplySuspiciousTrackYellow = shouldApplySuspiciousTrackGreen;

/** 地图态势色优先级：蓝(真实威胁) > 黄(重点关注) > 默认；查证不再单独着色 */
export function resolveTrackMapHighlightFill(
  track: Pick<Track, "uniqueID" | "showID" | "trackId" | "isSuspicious">,
  baseFill: string,
): string {
  if (trackHasRealThreatAlarm(track)) {
    return baseFill;
  }
  if (isTrackSuspicious(track)) {
    return SUSPICIOUS_TRACK_MAP_COLOR;
  }
  if (isTrackAlarmLinked(track as Track)) {
    return baseFill;
  }
  return baseFill;
}
