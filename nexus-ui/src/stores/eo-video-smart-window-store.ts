import { create } from "zustand";

interface EoVideoSmartWindowState {
  /** 各光电 dock 面板是否开启智能窗口（默认关闭） */
  enabledByPanelId: Record<string, boolean>;
  /** 智能窗口锁定到某路无人机流后，在该机任务结束前不抢占 */
  lockedUavStreamByPanelId: Record<string, string>;
  setEnabled: (panelId: string, enabled: boolean) => void;
  toggle: (panelId: string) => void;
  setLockedUavStream: (panelId: string, streamId: string | null) => void;
}

export const useEoVideoSmartWindowStore = create<EoVideoSmartWindowState>((set) => ({
  enabledByPanelId: {},
  lockedUavStreamByPanelId: {},
  setEnabled: (panelId, enabled) => {
    const id = panelId.trim();
    if (!id) return;
    set((s) => {
      const nextEnabled = { ...s.enabledByPanelId, [id]: enabled };
      const nextLocked = { ...s.lockedUavStreamByPanelId };
      if (!enabled) delete nextLocked[id];
      return { enabledByPanelId: nextEnabled, lockedUavStreamByPanelId: nextLocked };
    });
  },
  toggle: (panelId) => {
    const id = panelId.trim();
    if (!id) return;
    set((s) => {
      const cur = s.enabledByPanelId[id] ?? false;
      const nextEnabled = { ...s.enabledByPanelId, [id]: !cur };
      const nextLocked = { ...s.lockedUavStreamByPanelId };
      if (cur) delete nextLocked[id];
      return { enabledByPanelId: nextEnabled, lockedUavStreamByPanelId: nextLocked };
    });
  },
  setLockedUavStream: (panelId, streamId) => {
    const id = panelId.trim();
    if (!id) return;
    set((s) => {
      const nextLocked = { ...s.lockedUavStreamByPanelId };
      const sid = streamId?.trim() ?? "";
      if (sid) nextLocked[id] = sid;
      else delete nextLocked[id];
      return { lockedUavStreamByPanelId: nextLocked };
    });
  },
}));
