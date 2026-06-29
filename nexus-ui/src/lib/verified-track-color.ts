import type { Track } from "@/lib/map-entity-model";
import { resolveTrackMapHighlightFill, shouldApplySuspiciousTrackGreen } from "@/lib/track-map-highlight-color";
import { isTrackOpticallyVerified } from "@/stores/verified-track-store";
import { VERIFIED_TRACK_MAP_COLOR } from "@/lib/verified-track-constants";
import { isTrackAlarmLinked } from "@/stores/track-store";

export { VERIFIED_TRACK_MAP_COLOR };

/** 地图是否标黄：已光电查证，且非告警/可疑（蓝 > 绿 > 黄） */
export function shouldApplyVerifiedTrackYellow(track: Pick<Track, "uniqueID" | "showID">): boolean {
  if (!isTrackOpticallyVerified(track)) return false;
  if (isTrackAlarmLinked(track as Track)) return false;
  if (shouldApplySuspiciousTrackGreen(track)) return false;
  return true;
}

/** @deprecated 请用 shouldApplyVerifiedTrackYellow */
export const shouldApplyVerifiedTrackGreen = shouldApplyVerifiedTrackYellow;

/** @deprecated 请用 resolveTrackMapHighlightFill */
export function resolveVerifiedTrackPointFill(
  track: Pick<Track, "uniqueID" | "showID">,
  defaultFill: string,
): string {
  return resolveTrackMapHighlightFill(track, defaultFill);
}
