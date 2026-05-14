import { create } from "zustand";

/** 与 `EoVideoDockPanel` / 注册表里 `electro-optical*` 面板 id 一致 */
export function isElectroOpticalDockPanel(id: string | undefined): id is string {
  if (!id) return false;
  return id === "electro-optical" || id.startsWith("electro-optical-");
}

interface EoVideoPanelFocusState {
  /** 当前被选中的光电 dock 面板 id（多窗口切焦点）；默认光电显示 1 */
  focusedDockPanelId: string;
  setFocusedDockPanel: (id: string) => void;
}

export const useEoVideoPanelFocusStore = create<EoVideoPanelFocusState>((set) => ({
  focusedDockPanelId: "electro-optical-1",
  setFocusedDockPanel: (id) => {
    if (isElectroOpticalDockPanel(id)) set({ focusedDockPanelId: id });
  },
}));
