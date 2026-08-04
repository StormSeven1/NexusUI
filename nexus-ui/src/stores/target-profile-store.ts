"use client";

import { create } from "zustand";

/**
 * 右侧「目标档案」面板：由地图双击航迹驱动；`focusedShowId` 与 `track-store` 的 `showID` 对齐。
 * 相册条目含 `downloadUrl`（给知识库船只识别等），UI 只用 `url` 展示。
 */

export type TargetProfileShot = {
  /** 浏览器 `<img>` 用（同源 proxy） */
  url: string;
  /** 外部服务可 GET 的下载地址；无则空串 */
  downloadUrl: string;
  cameraIndex: string;
  uploadedAt: string;
};

interface TargetProfileState {
  /** 当前聚焦的航迹 showID；`null` 表示未选或目标已消失 */
  focusedShowId: string | null;
  /** 当前档案相册（与面板展示一致，含下载地址） */
  shots: TargetProfileShot[];
  /** 地图双击时调用：写入聚焦 id（不替代单击选中的 `selectedTrackId`） */
  setFocusedShowId: (id: string | null) => void;
  setShots: (shots: TargetProfileShot[]) => void;
  clearShots: () => void;
}

export const useTargetProfileStore = create<TargetProfileState>((set) => ({
  focusedShowId: null,
  shots: [],
  setFocusedShowId: (id) =>
    set({
      focusedShowId: id?.trim() ? id.trim() : null,
      shots: [],
    }),
  setShots: (shots) => set({ shots: Array.isArray(shots) ? shots : [] }),
  clearShots: () => set({ shots: [] }),
}));

/** 知识库 `user_context.image_urls`：当前档案可见图的下载地址（最多 8 张） */
export function getTargetProfileImageDownloadUrls(limit = 8): string[] {
  const max = Math.min(8, Math.max(0, Math.floor(limit)));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of useTargetProfileStore.getState().shots) {
    const u = (s.downloadUrl || s.url || "").trim();
    if (!u || !/^https?:\/\//i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}
