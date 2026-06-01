/**
 * track-alias-store — 航迹别名（纯显示用）
 *
 * 按 trackId 自动分配递增别名（目标1、目标2 …）。
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

const STORAGE_KEY = "nexus.trackAliases.v1";
const TARGET_ALIAS_RE = /^目标-?(\d+)$/;

interface TrackAliasState {
  aliases: Record<string, string>;
  _counter: number;
  getOrCreate: (trackId: string) => string;
  getAlias: (trackId: string) => string | undefined;
}

function maxAliasIndex(aliases: Record<string, string>): number {
  let max = 0;
  for (const alias of Object.values(aliases)) {
    const m = String(alias).trim().match(TARGET_ALIAS_RE);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max;
}

function loadAliasSnapshot(): Pick<TrackAliasState, "aliases" | "_counter"> {
  if (typeof window === "undefined") return { aliases: {}, _counter: 0 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { aliases: {}, _counter: 0 };
    const parsed = JSON.parse(raw) as { aliases?: unknown; counter?: unknown; _counter?: unknown };
    const aliases =
      parsed.aliases && typeof parsed.aliases === "object" && !Array.isArray(parsed.aliases)
        ? (parsed.aliases as Record<string, string>)
        : {};
    const counter = Math.max(Number(parsed.counter ?? parsed._counter) || 0, maxAliasIndex(aliases));
    return { aliases, _counter: counter };
  } catch {
    return { aliases: {}, _counter: 0 };
  }
}

function saveAliasSnapshot(aliases: Record<string, string>, counter: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ aliases, counter }));
  } catch {
    // localStorage 不可用时仍保持内存别名，不影响主流程。
  }
}

const initialAliasState = loadAliasSnapshot();

export const useTrackAliasStore = create<TrackAliasState>((set, get) => ({
  aliases: initialAliasState.aliases,
  _counter: initialAliasState._counter,

  getOrCreate: (trackId) => {
    const key = String(trackId ?? "").trim();
    if (!key) return "";
    const s = get();
    if (s.aliases[key]) return s.aliases[key];
    const next = Math.max(s._counter, maxAliasIndex(s.aliases)) + 1;
    const alias = `目标${next}`;
    const aliases = { ...s.aliases, [key]: alias };
    saveAliasSnapshot(aliases, next);
    set({ aliases, _counter: next });
    return alias;
  },

  getAlias: (trackId) => get().aliases[String(trackId ?? "").trim()],
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
