"use client";

import { useEffect, useState } from "react";
import { generateId } from "ai";
import type { UIMessage } from "ai";
import { NxPanelHeader } from "@/components/nexus";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { useVlmChatInjectStore } from "@/stores/vlm-chat-inject-store";

/**
 * `app-config.json` → `ui.gptInterfaceRightPanel === true` 时展示。
 * 完整会话后续接入；光电截图「分析」结果以与 Legacy 相同的对话气泡形式显示在本区域。
 */
export function ChatPanelGptPlaceholder() {
  const [vlmMessages, setVlmMessages] = useState<UIMessage[]>([]);
  const vlmInjectSeq = useVlmChatInjectStore((s) => s.injectSeq);

  useEffect(() => {
    const p = useVlmChatInjectStore.getState().consumePending();
    if (!p) return;
    const userId = generateId();
    const asstId = generateId();
    setVlmMessages((msgs) => [
      ...msgs,
      {
        id: userId,
        role: "user",
        parts: [
          { type: "text", text: p.userText },
          {
            type: "file",
            url: p.imageUrl,
            mediaType: "image/png",
            filename: p.filename || "eo-snapshot.png",
          },
        ],
      },
      {
        id: asstId,
        role: "assistant",
        parts: [{ type: "text", text: p.assistantText }],
      },
    ]);
  }, [vlmInjectSeq]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <NxPanelHeader title="GPT 助手" />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {vlmMessages.length > 0 ? (
          <ChatMessageList messages={vlmMessages} isStreaming={false} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-xs text-nexus-text-primary">已启用 GPT 界面模式</p>
            <p className="max-w-[300px] text-[11px] leading-relaxed text-nexus-text-muted">
              光电视频截图「分析」后，研判结果将以对话形式显示在此处。其它智能问答能力将陆续接入。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
