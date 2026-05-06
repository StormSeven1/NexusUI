"use client";

import { useEffect } from "react";
import { useAppConfigStore } from "@/stores/app-config-store";
import { ChatPanelLangGraph } from "@/components/panels/ChatPanelLangGraph";

/** 右侧 AI 助手面板（见 ChatPanelLangGraph）。 */
export function ChatPanel() {
  useEffect(() => {
    void useAppConfigStore.getState().ensureLoaded();
  }, []);

  return <ChatPanelLangGraph />;
}
