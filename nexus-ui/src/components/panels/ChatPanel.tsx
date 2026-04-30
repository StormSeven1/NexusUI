"use client";

import { useEffect } from "react";
import { useAppConfigStore } from "@/stores/app-config-store";
import { ChatPanelGptPlaceholder } from "@/components/panels/ChatPanelGptPlaceholder";
import { ChatPanelLegacy } from "@/components/panels/ChatPanelLegacy";

/**
 * 右侧 AI 助手面板入口。
 * `public/app-config.json` → `ui.gptInterfaceRightPanel === true` 时停用原有会话/处置 WS 等逻辑，改为 GPT 占位界面（光电视频截图预览不受此项控制）。
 */
export function ChatPanel() {
  const status = useAppConfigStore((s) => s.status);
  const gptInterfaceRightPanel = useAppConfigStore((s) => s.config?.gptInterfaceRightPanel === true);

  useEffect(() => {
    void useAppConfigStore.getState().ensureLoaded();
  }, []);

  if (status === "loading" || status === "idle") {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-nexus-text-muted">
        正在加载应用配置…
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-red-400">
        配置加载失败，无法决定面板模式
      </div>
    );
  }

  return gptInterfaceRightPanel ? <ChatPanelGptPlaceholder /> : <ChatPanelLegacy />;
}
