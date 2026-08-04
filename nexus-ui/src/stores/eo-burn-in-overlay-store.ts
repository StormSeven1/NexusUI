"use client";

import { create } from "zustand";

/**
 * 烧录叠层「隐藏框/ID」勾选态（按 entityId）。
 * 权威在 camServer；本 store 由检测 WS `burnInHideOverlay` 与 GET/POST 同步，供多面板/多浏览器对齐。
 */
type EoBurnInOverlayState = {
  /** entityId → hideOverlay（true=不绘制） */
  byEntityId: Record<string, boolean>;
  setHideOverlay: (entityId: string, hide: boolean) => void;
  /** 仅当值变化时写入，避免 WS 高频触发无意义重渲染 */
  applyFromWs: (entityId: string, hide: boolean) => void;
};

export const useEoBurnInOverlayStore = create<EoBurnInOverlayState>((set, get) => ({
  byEntityId: {},
  setHideOverlay: (entityId, hide) => {
    const id = entityId.trim().toLowerCase();
    if (!id) return;
    set((s) => {
      if (s.byEntityId[id] === hide) return s;
      return { byEntityId: { ...s.byEntityId, [id]: hide } };
    });
  },
  applyFromWs: (entityId, hide) => {
    get().setHideOverlay(entityId, hide);
  },
}));

export function selectBurnInHideOverlay(
  state: EoBurnInOverlayState,
  entityId: string | null | undefined,
): boolean {
  const id = (entityId ?? "").trim().toLowerCase();
  if (!id) return false;
  return !!state.byEntityId[id];
}
