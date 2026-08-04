import { create } from "zustand";
import type { Track } from "@/lib/map-entity-model";

function normUniqueId(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return /^\d+$/.test(s) ? s : null;
}

interface SuspiciousTrackState {
  /** AlarmSys SuspiciousTargetThread 发布的 unique_id 集合 */
  suspiciousUniqueIds: Record<string, true>;
  mapSuspiciousRev: number;
  /** 每轮研判结果全量替换（非增量） */
  setSuspiciousTargetIds: (uniqueIds: readonly (string | number)[]) => void;
  clearSuspicious: () => void;
}

export const useSuspiciousTrackStore = create<SuspiciousTrackState>((set, get) => ({
  suspiciousUniqueIds: {},
  mapSuspiciousRev: 0,

  setSuspiciousTargetIds: (uniqueIds) => {
    const next: Record<string, true> = {};
    for (const raw of uniqueIds) {
      const id = normUniqueId(raw);
      if (id) next[id] = true;
    }
    const prev = get().suspiciousUniqueIds;
    const prevKeys = Object.keys(prev).sort().join(",");
    const nextKeys = Object.keys(next).sort().join(",");
    if (prevKeys === nextKeys) return;
    set({
      suspiciousUniqueIds: next,
      mapSuspiciousRev: get().mapSuspiciousRev + 1,
    });
  },

  clearSuspicious: () => {
    if (Object.keys(get().suspiciousUniqueIds).length === 0) return;
    set({ suspiciousUniqueIds: {}, mapSuspiciousRev: get().mapSuspiciousRev + 1 });
  },
}));

export function isTrackSuspicious(
  track: Pick<Track, "uniqueID" | "showID" | "trackId" | "isSuspicious">,
): boolean {
  if (track.isSuspicious === true) return true;
  const set = useSuspiciousTrackStore.getState().suspiciousUniqueIds;
  const uid = normUniqueId(track.uniqueID);
  if (uid && set[uid]) return true;
  const sid = normUniqueId(track.showID);
  if (sid && set[sid]) return true;
  const tid = normUniqueId(track.trackId);
  return Boolean(tid && set[tid]);
}
