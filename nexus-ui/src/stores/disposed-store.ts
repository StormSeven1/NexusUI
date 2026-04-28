/**
 * disposed-store — 已处置目标跟踪
 *
 * 【作用】处置过的航迹永久过滤：不再接收该航迹的点，也不再接收其告警。
 * 对齐 V2 `disposedStore.js`。
 *
 * 【数据流】
 * 1. AlertPanel「消灭」按钮 → addDisposedTrack(uniqueID, businessTrackId)
 * 2. track-store.setTracks 入口检查 isTrackDisposed → 已处置航迹直接跳过
 * 3. alert-store.addAlerts 入口检查 isBusinessTrackDisposed → 已处置告警直接跳过
 *
 * 【两种 ID 索引】
 * - disposedUniqueIDs: 按 uniqueID（= showID，渲染缓存 key），用于航迹过滤
 * - disposedBusinessTrackIds: 按业务 trackId（告警匹配用），用于告警过滤
 *   两种 ID 在 distinguishSeaAir 模式下不同：对海用 uniqueID，对空用 trackId
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
