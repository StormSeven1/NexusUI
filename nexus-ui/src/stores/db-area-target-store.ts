"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  dbAreaTargetVisibilityKey,
  isDbAreaTargetListable,
} from "@/lib/db-area-target-geometry";

export type AreaTableTargetRow = {
  id: string;
  area_name: string;
  target_id: number;
  area_type: number;
  start_point?: string | null;
  end_point?: string | null;
  area_rect?: string | null;
  area_points?: string | null;
};

const STORAGE_KEY = "nexus-ui-db-area-target-visibility-v1";

interface DbAreaTargetState {
  rows: AreaTableTargetRow[];
  /** `ft:<uuid>` → 显隐；缺省 false（与区域子项一致，须面板显式开启） */
  targetVisibility: Record<string, boolean>;
  error: string | null;
  setRows: (rows: AreaTableTargetRow[], error?: string | null) => void;
  setTargetVisible: (id: string, visible: boolean) => void;
  setAllTargetsVisible: (visible: boolean) => void;
}

function pruneVisibility(
  targetVisibility: Record<string, boolean>,
  rows: AreaTableTargetRow[],
): Record<string, boolean> {
  const valid = new Set(rows.map((r) => dbAreaTargetVisibilityKey(r.id)));
  const next: Record<string, boolean> = {};
  for (const k of Object.keys(targetVisibility)) {
    if (valid.has(k)) next[k] = targetVisibility[k];
  }
  for (const r of rows) {
    const k = dbAreaTargetVisibilityKey(r.id);
    if (!(k in next)) next[k] = false;
  }
  return next;
}

export const useDbAreaTargetStore = create<DbAreaTargetState>()(
  persist(
    (set) => ({
      rows: [],
      targetVisibility: {},
      error: null,

      setRows: (rows, error = null) =>
        set((s) => ({
          rows,
          targetVisibility:
            rows.length > 0 ? pruneVisibility(s.targetVisibility, rows) : s.targetVisibility,
          error,
        })),

      setTargetVisible: (id, visible) =>
        set((s) => ({
          targetVisibility: {
            ...s.targetVisibility,
            [dbAreaTargetVisibilityKey(id)]: visible,
          },
        })),

      setAllTargetsVisible: (visible) =>
        set((s) => {
          const next = { ...s.targetVisibility };
          for (const r of s.rows) {
            if (!isDbAreaTargetListable(r)) continue;
            next[dbAreaTargetVisibilityKey(r.id)] = visible;
          }
          return { targetVisibility: next };
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            }
          : window.localStorage,
      ),
      partialize: (s) => ({ targetVisibility: s.targetVisibility }),
    },
  ),
);
