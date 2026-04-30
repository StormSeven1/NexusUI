"use client";

import { create } from "zustand";

/**
 * 光电「分析」完成后注入右侧 Chat 对话框（与 useChat 消息格式一致，由 Legacy / GPT 占位各自消费）。
 */
export type VlmChatInjectPayload = {
  userText: string;
  imageUrl: string;
  filename: string;
  assistantText: string;
};

type State = {
  /** 递增以触发订阅方 useEffect */
  injectSeq: number;
  pending: VlmChatInjectPayload | null;
  scheduleVlmExchange: (p: VlmChatInjectPayload) => void;
  consumePending: () => VlmChatInjectPayload | null;
};

export const useVlmChatInjectStore = create<State>((set, get) => ({
  injectSeq: 0,
  pending: null,
  scheduleVlmExchange: (p) =>
    set((s) => ({
      pending: p,
      injectSeq: s.injectSeq + 1,
    })),
  consumePending: () => {
    const p = get().pending;
    if (!p) return null;
    set({ pending: null });
    return p;
  },
}));
