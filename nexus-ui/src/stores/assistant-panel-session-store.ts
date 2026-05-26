"use client";

import type { UIMessage } from "ai";
import { create } from "zustand";

/** 右侧可切换的对话面板（切换 dock 时组件会卸载，会话存于此 store） */
export type AssistantPanelSessionId = "chat" | "knowledge-base";

export type AssistantPanelSession = {
  messages: UIMessage[];
  /** 知识库查询多轮 `conv_uid` */
  convUid: string;
  /** 智能助手 LangGraph `thread_id` */
  langGraphThreadId: string;
};

const emptySession = (): AssistantPanelSession => ({
  messages: [],
  convUid: "",
  langGraphThreadId: "",
});

type MessagesUpdater = UIMessage[] | ((prev: UIMessage[]) => UIMessage[]);

type State = {
  sessions: Record<AssistantPanelSessionId, AssistantPanelSession>;
  patchMessages: (id: AssistantPanelSessionId, updater: MessagesUpdater) => void;
  setConvUid: (convUid: string) => void;
  setLangGraphThreadId: (threadId: string) => void;
  clearSession: (id: AssistantPanelSessionId) => void;
};

export const useAssistantPanelSessionStore = create<State>((set, get) => ({
  sessions: {
    chat: emptySession(),
    "knowledge-base": emptySession(),
  },

  patchMessages: (id, updater) => {
    set((s) => {
      const prev = s.sessions[id].messages;
      const next = typeof updater === "function" ? updater(prev) : updater;
      return {
        sessions: {
          ...s.sessions,
          [id]: { ...s.sessions[id], messages: next },
        },
      };
    });
  },

  setConvUid: (convUid) => {
    set((s) => ({
      sessions: {
        ...s.sessions,
        "knowledge-base": { ...s.sessions["knowledge-base"], convUid },
      },
    }));
  },

  setLangGraphThreadId: (threadId) => {
    set((s) => ({
      sessions: {
        ...s.sessions,
        chat: { ...s.sessions.chat, langGraphThreadId: threadId },
      },
    }));
  },

  clearSession: (id) => {
    set((s) => ({
      sessions: {
        ...s.sessions,
        [id]: emptySession(),
      },
    }));
  },
}));

/** 与 `useState<UIMessage[]>` 兼容，供切换 dock 后保留消息 */
export function useAssistantPanelMessages(panelId: AssistantPanelSessionId) {
  const messages = useAssistantPanelSessionStore((s) => s.sessions[panelId].messages);
  const patchMessages = useAssistantPanelSessionStore((s) => s.patchMessages);
  const setMessages = (updater: MessagesUpdater) => patchMessages(panelId, updater);
  return [messages, setMessages] as const;
}

export function getAssistantConvUid(): string {
  return useAssistantPanelSessionStore.getState().sessions["knowledge-base"].convUid.trim();
}

export function getAssistantLangGraphThreadId(): string {
  return useAssistantPanelSessionStore.getState().sessions.chat.langGraphThreadId.trim();
}
