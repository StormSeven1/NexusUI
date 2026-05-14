"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AreaTableRow } from "@/lib/area-table-geometry";
import { dbAreaVisibilityKey } from "@/lib/area-table-geometry";

const DB_AREA_VISIBILITY_STORAGE_KEY = "nexus-ui-db-area-visibility-v1";

interface DbAreaState {
  rows: AreaTableRow[];
  /** `groupId:areaId` → 显隐；缺省 true */
  areaVisibility: Record<string, boolean>;
  lastError: string | null;
  lastFetchedAt: number | null;
  setRows: (rows: AreaTableRow[], err?: string | null) => void;
  setAreaVisible: (groupId: number, areaId: number, visible: boolean) => void;
  /** 该组内全部区域设为同一显隐（父级控子级） */
  setGroupAllAreasVisible: (groupId: number, visible: boolean) => void;
  /** 若组内全非显，则等效于关组；若至少一个开则保持各子项 */
  toggleGroupAllAreasVisible: (groupId: number) => void;
}

function pruneVisibility(
  areaVisibility: Record<string, boolean>,
  rows: AreaTableRow[],
): Record<string, boolean> {
  const valid = new Set(rows.map((r) => dbAreaVisibilityKey(r.group_id, r.area_id)));
  const next: Record<string, boolean> = {};
  for (const k of Object.keys(areaVisibility)) {
    if (valid.has(k)) next[k] = areaVisibility[k];
  }
  for (const r of rows) {
    const k = dbAreaVisibilityKey(r.group_id, r.area_id);
    if (!(k in next)) next[k] = true;
  }
  return next;
}

export const useDbAreaStore = create<DbAreaState>()(
  persist(
    (set, get) => ({
      rows: [],
      areaVisibility: {},
      lastError: null,
      lastFetchedAt: null,

      setRows: (rows, err = null) =>
        set((s) => ({
          rows,
          areaVisibility: pruneVisibility(s.areaVisibility, rows),
          lastError: err,
          lastFetchedAt: Date.now(),
        })),

      setAreaVisible: (groupId, areaId, visible) =>
        set((s) => ({
          areaVisibility: { ...s.areaVisibility, [dbAreaVisibilityKey(groupId, areaId)]: visible },
        })),

      setGroupAllAreasVisible: (groupId, visible) =>
        set((s) => {
          const next = { ...s.areaVisibility };
          for (const r of s.rows) {
            if (r.group_id === groupId) {
              next[dbAreaVisibilityKey(r.group_id, r.area_id)] = visible;
            }
          }
          return { areaVisibility: next };
        }),

      toggleGroupAllAreasVisible: (groupId) => {
        const { rows, areaVisibility } = get();
        const inGroup = rows.filter((r) => r.group_id === groupId);
        if (inGroup.length === 0) return;
        const allOn = inGroup.every(
          (r) => areaVisibility[dbAreaVisibilityKey(r.group_id, r.area_id)] !== false,
        );
        get().setGroupAllAreasVisible(groupId, !allOn);
      },
    }),
    {
      name: DB_AREA_VISIBILITY_STORAGE_KEY,
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            }
          : window.localStorage,
      ),
      partialize: (s) => ({ areaVisibility: s.areaVisibility }),
    },
  ),
);
