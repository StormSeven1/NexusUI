"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AreaTableRow } from "@/lib/area-table-geometry";
import { dbAreaVisibilityKey } from "@/lib/area-table-geometry";
import {
  AREA_ALERT_FLASH_MS,
  findDbAreaRowsByAreaName,
  isDbAreaKeyFlashing,
} from "@/lib/db-area-alert-flash";
import { isDbAreaListable } from "@/lib/db-area-panel-helpers";

const DB_AREA_VISIBILITY_STORAGE_KEY = "nexus-ui-db-area-visibility-v1";

let areaFlashCleanupTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAreaFlashCleanup(get: () => DbAreaState, prune: () => void): void {
  if (areaFlashCleanupTimer != null) clearTimeout(areaFlashCleanupTimer);
  const now = Date.now();
  let nextExpiry = Infinity;
  for (const until of Object.values(get().areaFlashUntil)) {
    if (until > now && until < nextExpiry) nextExpiry = until;
  }
  if (!Number.isFinite(nextExpiry)) return;
  areaFlashCleanupTimer = setTimeout(() => {
    areaFlashCleanupTimer = null;
    prune();
  }, Math.max(0, nextExpiry - now) + 50);
}

interface DbAreaState {
  rows: AreaTableRow[];
  /** `groupId:areaId` → 显隐；缺省 true */
  areaVisibility: Record<string, boolean>;
  /** `groupId:areaId` → 闪烁结束时间戳（ms）；不入持久化 */
  areaFlashUntil: Record<string, number>;
  /** 闪烁状态变更序号，供地图订阅 */
  flashRevision: number;
  lastError: string | null;
  lastFetchedAt: number | null;
  setRows: (rows: AreaTableRow[], err?: string | null) => void;
  setAreaVisible: (groupId: number, areaId: number, visible: boolean) => void;
  /** 该组内全部区域设为同一显隐（父级控子级） */
  setGroupAllAreasVisible: (groupId: number, visible: boolean) => void;
  /** 若组内全非显，则等效于关组；若至少一个开则保持各子项 */
  toggleGroupAllAreasVisible: (groupId: number) => void;
  /** 全部可绘区域设为同一显隐 */
  setAllDrawableAreasVisible: (visible: boolean) => void;
  isAreaFlashing: (groupId: number, areaId: number) => boolean;
  /** 按 `area_name` 触发地图闪烁；匹配不到返回 false */
  triggerAreaFlashByName: (areaName: string, durationMs?: number) => boolean;
  pruneExpiredAreaFlashes: () => void;
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
    if (!(k in next)) next[k] = false;
  }
  return next;
}

export const useDbAreaStore = create<DbAreaState>()(
  persist(
    (set, get) => ({
      rows: [],
      areaVisibility: {},
      areaFlashUntil: {},
      flashRevision: 0,
      lastError: null,
      lastFetchedAt: null,

      setRows: (rows, err = null) =>
        set((s) => ({
          rows,
          // 空数组：请求失败或未连库时不要 prune，否则会清空 persisted 里的显隐；
          // 另：首轮 fetch 早于 persist hydrate 时用 {} merge 会令全部 true 并抢先覆盖 localStorage。
          areaVisibility:
            rows.length > 0 ? pruneVisibility(s.areaVisibility, rows) : s.areaVisibility,
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
        const allOn = inGroup.every((r) =>
          areaVisibility[dbAreaVisibilityKey(r.group_id, r.area_id)] === true,
        );
        get().setGroupAllAreasVisible(groupId, !allOn);
      },

      setAllDrawableAreasVisible: (visible) =>
        set((s) => {
          const next = { ...s.areaVisibility };
          for (const r of s.rows) {
            if (!isDbAreaListable(r)) continue;
            next[dbAreaVisibilityKey(r.group_id, r.area_id)] = visible;
          }
          return { areaVisibility: next };
        }),

      isAreaFlashing: (groupId, areaId) =>
        isDbAreaKeyFlashing(get().areaFlashUntil, groupId, areaId),

      triggerAreaFlashByName: (areaName, durationMs = AREA_ALERT_FLASH_MS) => {
        const matched = findDbAreaRowsByAreaName(get().rows, areaName);
        if (matched.length === 0) return false;
        const until = Date.now() + durationMs;
        set((s) => {
          const next = { ...s.areaFlashUntil };
          for (const r of matched) {
            next[dbAreaVisibilityKey(r.group_id, r.area_id)] = until;
          }
          return { areaFlashUntil: next, flashRevision: s.flashRevision + 1 };
        });
        scheduleAreaFlashCleanup(get, () => get().pruneExpiredAreaFlashes());
        return true;
      },

      pruneExpiredAreaFlashes: () => {
        const now = Date.now();
        const prev = get().areaFlashUntil;
        const next: Record<string, number> = {};
        for (const [k, until] of Object.entries(prev)) {
          if (until > now) next[k] = until;
        }
        if (Object.keys(next).length === Object.keys(prev).length) {
          scheduleAreaFlashCleanup(get, () => get().pruneExpiredAreaFlashes());
          return;
        }
        set((s) => ({ areaFlashUntil: next, flashRevision: s.flashRevision + 1 }));
        scheduleAreaFlashCleanup(get, () => get().pruneExpiredAreaFlashes());
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
