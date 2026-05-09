/**
 * track-alias-store — 航迹别名（纯显示用）
 *
 * 按 trackId 自动分配递增别名（目标-1、目标-2 …）。
 * 仅在 UI 渲染时调用，不参与任何缓存/过滤/匹配/处置逻辑。
 *
 * 【别名 key 规则】对齐告警匹配逻辑 isTrackMatchedByAlarm：
 *   - 18.141 模式：key = track.trackId
 *   - 28.9 对海：key = track.uniqueID（告警里 trackId 实际存的是 uniqueID）
 *   - 28.9 对空：key = track.trackId
 *   统一由 resolveAliasKey(track) 返回。
 */

import { create } from "zustand";
import { getTrackIdModeConfig } from "@/lib/map-app-config";

interface TrackAliasState {
  aliases: Record<string, string>;
  _counter: number;
  getOrCreate: (trackId: string) => string;
  getAlias: (trackId: string) => string | undefined;
}

export const useTrackAliasStore = create<TrackAliasState>((set, get) => ({
  aliases: {},
  _counter: 0,

  getOrCreate: (trackId) => {
    const s = get();
    if (s.aliases[trackId]) return s.aliases[trackId];
    const next = s._counter + 1;
    const alias = `目标-${next}`;
    set({ aliases: { ...s.aliases, [trackId]: alias }, _counter: next });
    return alias;
  },

  getAlias: (trackId) => get().aliases[trackId],
}));

/**
 * 根据模式返回航迹对应的别名 key（对齐 isTrackMatchedByAlarm）。
 * - 18.141：trackId
 * - 28.9 对海：uniqueID（告警里 trackId 存的就是 uniqueID）
 * - 28.9 对空：trackId
 */
export function resolveAliasKey(track: { trackId?: string; uniqueID?: string; isAirTrack?: boolean; type?: string }): string | null {
  if (getTrackIdModeConfig().distinguishSeaAir) {
    const isAir = track.isAirTrack === true || track.type === "air";
    return isAir ? (track.trackId ?? null) : (track.uniqueID ?? null);
  }
  return track.trackId ?? null;
}
