"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  SYSTEM_EVAL_SECTION_TABS,
  type SystemEvalSectionId,
} from "@/components/panels/system-evaluation/types";

const SYSTEM_EVAL_UI_STORAGE_KEY = "nexus-ui-system-evaluation-ui-v1";

const VALID_SECTION_IDS = new Set<SystemEvalSectionId>(
  SYSTEM_EVAL_SECTION_TABS.map((t) => t.id),
);

interface SystemEvaluationUiState {
  section: SystemEvalSectionId;
  setSection: (section: SystemEvalSectionId) => void;
}

export const useSystemEvaluationUiStore = create<SystemEvaluationUiState>()(
  persist(
    (set) => ({
      section: "track",
      setSection: (section) => set({ section }),
    }),
    {
      name: SYSTEM_EVAL_UI_STORAGE_KEY,
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            }
          : window.localStorage,
      ),
      partialize: (s) => ({ section: s.section }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SystemEvaluationUiState>;
        const section =
          p.section && VALID_SECTION_IDS.has(p.section) ? p.section : current.section;
        return { ...current, section };
      },
    },
  ),
);
