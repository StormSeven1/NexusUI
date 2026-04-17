import { create } from "zustand";

/** 与 Map2D init 内注册的实例一致，供顶栏 WorkspaceDetails 调用 */
export type Map2DMeasureHandlers = {
  setDrawTool: (tool: "distance" | "angle" | "polygon" | null) => void;
};

let handlers: Map2DMeasureHandlers | null = null;

export function registerMapMeasureHandlers(h: Map2DMeasureHandlers | null) {
  handlers = h;
}

export function getMapMeasureHandlers(): Map2DMeasureHandlers | null {
  return handlers;
}

export type MapMeasureDrawTool = "distance" | "angle" | "polygon" | null;

interface MapMeasureUiState {
  activeDrawTool: MapMeasureDrawTool;
  setActiveDrawTool: (t: MapMeasureDrawTool) => void;
}

/** 顶栏量算工具高亮（与地图内 handler 同步） */
export const useMapMeasureUi = create<MapMeasureUiState>((set) => ({
  activeDrawTool: null,
  setActiveDrawTool: (t) => set({ activeDrawTool: t }),
}));
