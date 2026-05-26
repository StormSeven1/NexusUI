import type { Track } from "@/lib/map-entity-model";
import { isTrackAlarmLinked } from "@/stores/track-store";
import { isTrackOpticallyVerified } from "@/stores/verified-track-store";
import { VERIFIED_TRACK_MAP_COLOR } from "@/lib/verified-track-constants";

export { VERIFIED_TRACK_MAP_COLOR };

/** 地图是否标绿：已光电查证，且非告警目标（告警蓝色优先于查证绿色） */
export function shouldApplyVerifiedTrackGreen(track: Pick<Track, "uniqueID" | "showID">): boolean {
  if (!isTrackOpticallyVerified(track)) return false;
  return !isTrackAlarmLinked(track as Track);
}

export function resolveVerifiedTrackPointFill(
  track: Pick<Track, "uniqueID" | "showID">,
  defaultFill: string,
): string {
  return shouldApplyVerifiedTrackGreen(track) ? VERIFIED_TRACK_MAP_COLOR : defaultFill;
}
