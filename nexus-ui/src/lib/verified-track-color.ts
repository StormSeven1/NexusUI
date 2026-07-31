import type { Track } from "@/lib/map-entity-model";
import { resolveTrackMapHighlightFill } from "@/lib/track-map-highlight-color";
import { VERIFIED_TRACK_MAP_COLOR } from "@/lib/verified-track-constants";

export { VERIFIED_TRACK_MAP_COLOR };

/**
 * 查证目标不再标黄（恒 false）。
 * 保留函数名以兼容军标/列表调用点；黄色已改用于重点关注。
 */
export function shouldApplyVerifiedTrackYellow(
  _track: Pick<Track, "uniqueID" | "showID">,
): boolean {
  return false;
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
