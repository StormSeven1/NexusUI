"use client";

import { create } from "zustand";
import type { AreaDrawShape } from "@/lib/area-table-serialize";
import type { DbAreaDrawCompletePayload } from "@/components/map/modules/db-area-draw-maplibre";

export type AreaDrawSession = {
  shape: AreaDrawShape;
  groupId: number;
  groupName: string;
  isNewGroup: boolean;
};

interface AreaDrawState {
  /** 是否正在地图上手绘 */
  drawing: boolean;
  session: AreaDrawSession | null;
  /** 绘制完成、待命名存库 */
  pendingSave: (DbAreaDrawCompletePayload & { session: AreaDrawSession }) | null;
  setSession: (s: AreaDrawSession | null) => void;
  setDrawing: (v: boolean) => void;
  setPendingSave: (p: AreaDrawState["pendingSave"]) => void;
  reset: () => void;
}

export const useAreaDrawStore = create<AreaDrawState>((set) => ({
  drawing: false,
  session: null,
  pendingSave: null,
  setSession: (session) => set({ session }),
  setDrawing: (drawing) => set({ drawing }),
  setPendingSave: (pendingSave) => set({ pendingSave, drawing: false }),
  reset: () => set({ drawing: false, session: null, pendingSave: null }),
}));
