import type { Track } from "@/lib/map-entity-model";

/**
 * WatchSys `PtzMainWidget::SendUavFlightTask` 中 `specification.targetSourceId`（radarid）：
 * 海上目标 0，空中目标 9；`radarid==7||8` 时 C++ 走 `DroneTracking`，此处右键菜单固定走 `MultiDroneTracking`。
 */
export function uavFlightTaskTargetSourceId(track: Track): number {
  if (track.type === "sea" || track.type === "underwater") return 0;
  return 9;
}
