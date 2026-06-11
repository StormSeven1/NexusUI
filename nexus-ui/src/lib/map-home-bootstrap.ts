"use client";

import {
  clampOpacity,
  clampRingCount,
  coerceSpacingNm,
} from "@/lib/distance-ring-settings";
import type { AppConfigMapHome } from "@/lib/map-home-config";
import { useDistanceRingStore } from "@/stores/distance-ring-store";

/**
 * app-config 加载后：把 mapHome 写入态势「距离环」store（覆盖 localStorage 旧中心）。
 * 须在客户端、地图挂载前或同时调用一次。
 */
export function bootstrapMapHomeSideEffects(mapHome: AppConfigMapHome | null): void {
  if (!mapHome) return;
  const [lng, lat] = mapHome.center;
  const dr = mapHome.distanceRings;
  const prev = useDistanceRingStore.getState();
  useDistanceRingStore.setState({
    centerLng: lng,
    centerLat: lat,
    ...(dr?.ringCount != null ? { ringCount: clampRingCount(dr.ringCount) } : {}),
    ...(dr?.spacingNm != null ? { spacingNm: coerceSpacingNm(dr.spacingNm) } : {}),
    ...(typeof dr?.ringColor === "string" && dr.ringColor.trim()
      ? { ringColor: dr.ringColor.trim() }
      : {}),
    ...(dr?.ringOpacity != null ? { ringOpacity: clampOpacity(dr.ringOpacity) } : {}),
    ...(dr?.labelOpacity != null ? { labelOpacity: clampOpacity(dr.labelOpacity) } : {}),
    settingsRevision: prev.settingsRevision + 1,
  });
}
