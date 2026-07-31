import type { Track } from "@/lib/map-entity-model";
import { isTrackAlarmLinked } from "@/stores/track-store";
import { isTrackSuspicious } from "@/stores/suspicious-track-store";
import { SUSPICIOUS_TRACK_MAP_COLOR } from "@/lib/suspicious-track-constants";

/** 重点关注标黄：告警（蓝）已着色时不覆盖 */
export function shouldApplySuspiciousTrackGreen(
  track: Pick<Track, "uniqueID" | "showID" | "trackId">,
): boolean {
  if (isTrackAlarmLinked(track as Track)) return false;
  return isTrackSuspicious(track);
}

/** @deprecated 请用 shouldApplySuspiciousTrackGreen（现为黄色重点关注） */
export const shouldApplySuspiciousTrackYellow = shouldApplySuspiciousTrackGreen;

/** 地图态势色优先级：蓝(威胁/告警) > 黄(重点关注) > 默认；查证不再单独着色 */
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
  return baseFill;
}
