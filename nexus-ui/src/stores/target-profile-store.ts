"use client";

import { create } from "zustand";

/**
 * 右侧「目标档案」面板：由地图双击航迹驱动；`focusedShowId` 与 `track-store` 的 `showID` 对齐。
 */
interface TargetProfileState {
  /** 当前聚焦的航迹 showID；`null` 表示未选或目标已消失 */
  focusedShowId: string | null;
  /** 地图双击时调用：写入聚焦 id（不替代单击选中的 `selectedTrackId`） */
  setFocusedShowId: (id: string | null) => void;
}

export const useTargetProfileStore = create<TargetProfileState>((set) => ({
  focusedShowId: null,
  setFocusedShowId: (id) => set({ focusedShowId: id?.trim() ? id.trim() : null }),
}));
