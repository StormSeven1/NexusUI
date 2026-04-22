/**
 * disposed-store — 已处置目标跟踪
 *
 * 处置过的航迹永久过滤：不再接收该航迹的点，也不再接收其告警。
 * 对齐 V2 `disposedStore.js`。
 */

import { create } from "zustand";

interface DisposedState {
  /** 按 uniqueID（= showID）索引 */
  disposedUniqueIDs: Set<string>;
  /** 按业务 trackId 索引（告警过滤用） */
  disposedBusinessTrackIds: Set<string>;

  addDisposedTrack: (uniqueID: string | undefined, businessTrackId: string | undefined) => void;
  isTrackDisposed: (uniqueID: string) => boolean;
  isBusinessTrackDisposed: (businessTrackId: string) => boolean;
  clear: () => void;
}

export const useDisposedStore = create<DisposedState>((set, get) => ({
  disposedUniqueIDs: new Set<string>(),
  disposedBusinessTrackIds: new Set<string>(),

  addDisposedTrack: (uniqueID, businessTrackId) => {
    const uid = typeof uniqueID === "string" ? uniqueID.trim() : "";
    const tid = typeof businessTrackId === "string" ? businessTrackId.trim() : "";
    if (!uid && !tid) return;

    set((s) => {
      const uids = new Set(s.disposedUniqueIDs);
      const tids = new Set(s.disposedBusinessTrackIds);
      if (uid) uids.add(uid);
      if (tid) tids.add(tid);
      return { disposedUniqueIDs: uids, disposedBusinessTrackIds: tids };
    });
  },

  isTrackDisposed: (uniqueID) => {
    const id = typeof uniqueID === "string" ? uniqueID.trim() : "";
    return id ? get().disposedUniqueIDs.has(id) : false;
  },

  isBusinessTrackDisposed: (businessTrackId) => {
    const id = typeof businessTrackId === "string" ? businessTrackId.trim() : "";
    return id ? get().disposedBusinessTrackIds.has(id) : false;
  },

  clear: () =>
    set({ disposedUniqueIDs: new Set<string>(), disposedBusinessTrackIds: new Set<string>() }),
}));
