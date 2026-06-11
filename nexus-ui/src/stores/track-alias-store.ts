import { create } from "zustand";
import { getTrackIdModeConfig } from "@/lib/map-app-config";

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
    const match = String(alias).trim().match(TARGET_ALIAS_RE);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value)) {
      max = Math.max(max, value);
    }
  }
  return max;
}

export const useTrackAliasStore = create<TrackAliasState>((set, get) => ({
  aliases: {},
  _counter: 0,

  getOrCreate: (trackId) => {
    const key = String(trackId ?? "").trim();
    if (!key) return "";
    const state = get();
    if (state.aliases[key]) return state.aliases[key];

    const next = Math.max(state._counter, maxAliasIndex(state.aliases)) + 1;
    const alias = `目标${next}`;
    set({
      aliases: { ...state.aliases, [key]: alias },
      _counter: next,
    });
    return alias;
  },

  getAlias: (trackId) => get().aliases[String(trackId ?? "").trim()],
}));

export function resolveAliasKey(track: {
  trackId?: string;
  uniqueID?: string;
  isAirTrack?: boolean;
  type?: string;
}): string | null {
  if (getTrackIdModeConfig().distinguishSeaAir) {
    const isAir = track.isAirTrack === true || track.type === "air";
    return isAir ? (track.trackId ?? null) : (track.uniqueID ?? null);
  }
  return track.trackId ?? null;
}
