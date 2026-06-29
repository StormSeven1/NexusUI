import { create } from "zustand";
import { findTrackForDisposalTarget } from "@/lib/asset-target-line";

const TARGET_ALIAS_RE = /^目标-?(\d+)$/;

interface TrackAliasState {
  aliases: Record<string, string>;
  _counter: number;
  getOrCreate: (targetID: string) => string;
  getAlias: (targetID: string) => string | undefined;
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

  getOrCreate: (targetID) => {
    const key = String(targetID ?? "").trim();
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

  getAlias: (targetID) => get().aliases[String(targetID ?? "").trim()],
}));

export function resolveAliasKey(track: {
  external_target_id?: string;
  targetID?: string;
  isAirTrack?: boolean;
  type?: string;
}): string | null {
  return track.targetID ?? null;
}

export function resolveAliasByTargetId(targetId: string | null | undefined): string | undefined {
  const tid = String(targetId ?? "").trim();
  if (!tid) return undefined;

  const direct = useTrackAliasStore.getState().getAlias(tid);
  if (direct) return direct;

  const track = findTrackForDisposalTarget(tid);
  if (!track) return undefined;

  const aliasKey = resolveAliasKey(track);
  if (!aliasKey) return undefined;

  return useTrackAliasStore.getState().getOrCreate(String(aliasKey));
}

