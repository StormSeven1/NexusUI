"use client";

import { useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { NxPanelHeader, NxIconButton } from "@/components/nexus";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import { executeClientTool } from "@/lib/tool-bridge";
import { Trash2 } from "lucide-react";
import type { FileUIPart } from "ai";

export function ChatPanel() {
  const chat = useChat({
    onToolCall: async ({ toolCall }) => {
      const input = (toolCall.input ?? {}) as Record<string, unknown>;
      const result = executeClientTool(toolCall.toolName, input);
      chat.addToolOutput({
        tool: toolCall.toolName as never,
        toolCallId: toolCall.toolCallId,
        output: result,
      });
    },
    sendAutomaticallyWhen: ({ messages: msgs }) => {
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== "assistant") return false;
      const hasText = last.parts.some((p) => p.type === "text" && "text" in p && (p.text as string)?.length > 0);
      if (hasText) return false;
      const hasToolOutput = last.parts.some(
        (p) =>
          (p.type === "dynamic-tool" || p.type.startsWith("tool-")) &&
          "state" in p &&
          p.state === "output-available"
      );
      return hasToolOutput;
    },
    onError: (err) => {
      console.error("[NexusChat]", err);
    },
  });

  const { messages, setMessages, sendMessage, stop, status, error } = chat;
  const isLoading = status === "submitted" || status === "streaming";

  const handleSend = useCallback(
    (text: string, files?: FileUIPart[]) => {
      if (files && files.length > 0) {
        sendMessage({ text, files });
      } else {
        sendMessage({ text });
      }
    },
    [sendMessage]
  );

  const handleClear = useCallback(() => {
    setMessages([]);
  }, [setMessages]);

  return (
    <div className="flex h-full flex-col">
      <NxPanelHeader
        title="AI 助手"
        right={
          messages.length > 0 ? (
            <NxIconButton size="xs" onClick={handleClear} title="清空对话">
              <Trash2 size={12} />
            </NxIconButton>
          ) : undefined
        }
      />

      <ChatMessageList messages={messages} isStreaming={isLoading} />

      {error && (
        <div className="mx-3 mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] text-red-400">
          连接错误: {error.message}
        </div>
      )}

      <ChatInput onSend={handleSend} onStop={stop} isLoading={isLoading} />
    </div>
  );
}
