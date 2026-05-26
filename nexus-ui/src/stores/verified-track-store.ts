import { create } from "zustand";
import type { Track } from "@/lib/map-entity-model";

function normUniqueId(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return /^\d+$/.test(s) ? s : null;
}

interface VerifiedTrackState {
  /** 已在 minio_multi_metadata 查证到截图的 unique_id（纯数字字符串） */
  verifiedUniqueIds: Record<string, true>;
  /** 地图航迹图层刷新计数 */
  mapVerifiedRev: number;
  markVerified: (uniqueId: string | number) => void;
  markVerifiedMany: (uniqueIds: readonly (string | number)[]) => void;
  clearVerified: () => void;
}

export const useVerifiedTrackStore = create<VerifiedTrackState>((set, get) => ({
  verifiedUniqueIds: {},
  mapVerifiedRev: 0,

  markVerified: (uniqueId) => {
    const id = normUniqueId(uniqueId);
    if (!id) return;
    const prev = get().verifiedUniqueIds;
    if (prev[id]) return;
    set({
      verifiedUniqueIds: { ...prev, [id]: true },
      mapVerifiedRev: get().mapVerifiedRev + 1,
    });
  },

  markVerifiedMany: (uniqueIds) => {
    if (!uniqueIds.length) return;
    const prev = get().verifiedUniqueIds;
    const next = { ...prev };
    let changed = false;
    for (const raw of uniqueIds) {
      const id = normUniqueId(raw);
      if (!id || next[id]) continue;
      next[id] = true;
      changed = true;
    }
    if (!changed) return;
    set({ verifiedUniqueIds: next, mapVerifiedRev: get().mapVerifiedRev + 1 });
  },

  clearVerified: () => {
    if (Object.keys(get().verifiedUniqueIds).length === 0) return;
    set({ verifiedUniqueIds: {}, mapVerifiedRev: get().mapVerifiedRev + 1 });
  },
}));

/** 航迹是否已光电查证（按报文 uniqueID / showID 与库表 unique_id 对齐） */
export function isTrackOpticallyVerified(track: Pick<Track, "uniqueID" | "showID">): boolean {
  const set = useVerifiedTrackStore.getState().verifiedUniqueIds;
  const uid = normUniqueId(track.uniqueID);
  if (uid && set[uid]) return true;
  const sid = normUniqueId(track.showID);
  return Boolean(sid && set[sid]);
}
