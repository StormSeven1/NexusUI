/**
 * 地图右键手动「标为无人机」的本地缓存（showID → 探鸟批号）。
 * 真值以 CustomBackend label_store 为准；此处仅驱动菜单文案切换。
 */
"use client";

import { create } from "zustand";

type State = {
  /** showID → 探鸟批号 */
  markedPihaoByShowId: Record<string, number>;
  setMarked: (showID: string, pihao: number) => void;
  clearMarked: (showID: string) => void;
  getPihao: (showID: string) => number | null;
};

export const useManualUavMarkStore = create<State>((set, get) => ({
  markedPihaoByShowId: {},
  setMarked: (showID, pihao) => {
    const id = String(showID ?? "").trim();
    const p = Math.trunc(Number(pihao));
    if (!id || !Number.isFinite(p) || p <= 0) return;
    set((s) => ({
      markedPihaoByShowId: { ...s.markedPihaoByShowId, [id]: p },
    }));
  },
  clearMarked: (showID) => {
    const id = String(showID ?? "").trim();
    if (!id) return;
    set((s) => {
      if (!(id in s.markedPihaoByShowId)) return s;
      const next = { ...s.markedPihaoByShowId };
      delete next[id];
      return { markedPihaoByShowId: next };
    });
  },
  getPihao: (showID) => {
    const id = String(showID ?? "").trim();
    const p = get().markedPihaoByShowId[id];
    return typeof p === "number" && p > 0 ? p : null;
  },
}));
