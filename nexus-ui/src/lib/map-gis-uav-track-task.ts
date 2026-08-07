import type { Track } from "@/lib/map-entity-model";

/** 无人机跟踪任务域：对海 MultiDroneTracking / 对空 DroneTracking（对齐 WatchSys SendUavFlightTask） */
export type UavTrackFollowDomain = "sea" | "air";

/**
 * WatchSys `PtzMainWidget::SendUavFlightTask` 中 `specification.targetSourceId`（radarid）：
 * 海上融合 0，空中融合 9（探鸟单源等可为 7/8，C++ 对 7/8 走 DroneTracking）。
 */
export function uavFlightTaskTargetSourceId(track: Track): number {
  if (track.type === "sea" || track.type === "underwater") return 0;
  return 9;
}

/** 地图右键航迹：对海 / 水下 → sea；对空及其余 → air */
export function uavTrackFollowDomain(track: Track): UavTrackFollowDomain {
  if (track.type === "sea" || track.type === "underwater") return "sea";
  return "air";
}
