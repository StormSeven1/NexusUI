import type { Track } from "@/lib/map-entity-model";
import { isTrackAlarmLinked } from "@/stores/track-store";
import { isTrackSuspicious } from "@/stores/suspicious-track-store";
import { isTrackOpticallyVerified } from "@/stores/verified-track-store";
import { SUSPICIOUS_TRACK_MAP_COLOR } from "@/lib/suspicious-track-constants";
import { VERIFIED_TRACK_MAP_COLOR } from "@/lib/verified-track-constants";

/** 可疑目标标绿：告警（蓝）已着色时不覆盖 */
export function shouldApplySuspiciousTrackGreen(
  track: Pick<Track, "uniqueID" | "showID" | "trackId">,
): boolean {
  if (isTrackAlarmLinked(track as Track)) return false;
  return isTrackSuspicious(track);
}

/** @deprecated 请用 shouldApplySuspiciousTrackGreen */
export const shouldApplySuspiciousTrackYellow = shouldApplySuspiciousTrackGreen;

/** 地图态势色优先级：蓝(告警) > 绿(可疑) > 黄(查证) > 默认 */
export function resolveTrackMapHighlightFill(
  track: Pick<Track, "uniqueID" | "showID" | "trackId">,
  baseFill: string,
): string {
  if (isTrackAlarmLinked(track as Track)) {
    return baseFill;
  }
  if (isTrackSuspicious(track)) {
    return SUSPICIOUS_TRACK_MAP_COLOR;
  }
  if (isTrackOpticallyVerified(track) && !isTrackAlarmLinked(track as Track)) {
    return VERIFIED_TRACK_MAP_COLOR;
  }
  return baseFill;
}
