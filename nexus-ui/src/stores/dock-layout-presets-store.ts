import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { DockLayoutSnapshot } from "@/lib/dock/dock-layout-snapshot";

export const MAX_DOCK_LAYOUT_PRESETS = 5;
const STORAGE_KEY = "nexus-dock-layout-presets-v1";

export interface DockLayoutPreset {
  id: string;
  name: string;
  snapshot: DockLayoutSnapshot;
  updatedAt: number;
}

interface DockLayoutPresetsState {
  presets: DockLayoutPreset[];
  upsertPreset: (name: string, snapshot: DockLayoutSnapshot, overwriteId?: string) => { ok: true } | { ok: false; reason: string };
  removePreset: (id: string) => void;
  canAddPreset: () => boolean;
}

function newId() {
  return `layout-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeName(name: string) {
  return name.trim();
}

export const useDockLayoutPresetsStore = create<DockLayoutPresetsState>()(
  persist(
    (set, get) => ({
      presets: [],

      canAddPreset: () => get().presets.length < MAX_DOCK_LAYOUT_PRESETS,

      upsertPreset: (name, snapshot, overwriteId) => {
        const label = normalizeName(name);
        if (!label) {
          return { ok: false as const, reason: "布局名称不能为空" };
        }
        if (label.length > 32) {
          return { ok: false as const, reason: "布局名称不能超过 32 个字符" };
        }

        const now = Date.now();
        const cloned = structuredClone(snapshot);

        if (overwriteId) {
          const idx = get().presets.findIndex((p) => p.id === overwriteId);
          if (idx < 0) {
            return { ok: false as const, reason: "要覆盖的布局不存在" };
          }
          const duplicate = get().presets.some(
            (p) => p.id !== overwriteId && p.name === label,
          );
          if (duplicate) {
            return { ok: false as const, reason: "已存在同名布局" };
          }
          set((s) => {
            const next = [...s.presets];
            next[idx] = {
              ...next[idx],
              name: label,
              snapshot: cloned,
              updatedAt: now,
            };
            return { presets: next };
          });
          return { ok: true as const };
        }

        if (get().presets.length >= MAX_DOCK_LAYOUT_PRESETS) {
          return {
            ok: false as const,
            reason: `最多保存 ${MAX_DOCK_LAYOUT_PRESETS} 套自定义布局`,
          };
        }
        if (get().presets.some((p) => p.name === label)) {
          return { ok: false as const, reason: "已存在同名布局，请更换名称或覆盖已有项" };
        }

        set((s) => ({
          presets: [
            ...s.presets,
            { id: newId(), name: label, snapshot: cloned, updatedAt: now },
          ],
        }));
        return { ok: true as const };
      },

      removePreset: (id) => {
        set((s) => ({ presets: s.presets.filter((p) => p.id !== id) }));
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? { getItem: () => null, setItem: () => {}, removeItem: () => {} }
          : window.localStorage,
      ),
      partialize: (s) => ({ presets: s.presets }),
    },
  ),
);
