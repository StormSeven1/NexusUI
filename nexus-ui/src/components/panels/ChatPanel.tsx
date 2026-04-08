"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { NxPanelHeader, NxIconButton } from "@/components/nexus";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import { ConversationList } from "@/components/chat/ConversationList";
import { applyToolSideEffect } from "@/lib/tool-bridge";
import { Trash2, SquarePen } from "lucide-react";
import type { FileUIPart, UIMessage } from "ai";
import type { ConversationSummary } from "@/lib/chat-api";

/**
 * 从 assistant 消息中提取已完成的工具调用，用于触发客户端副作用
 */
function extractCompletedTools(messages: UIMessage[]) {
  const results: { toolCallId: string; action: string; output: Record<string, unknown> }[] = [];
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (const part of msg.parts) {
      if (
        part.type.startsWith("tool-") &&
        "state" in part &&
        (part as { state: string }).state === "output-available" &&
        "output" in part &&
        "toolCallId" in part
      ) {
        const output = (part as { output: Record<string, unknown> }).output;
        const action = output?.action as string | undefined;
        const toolCallId = (part as { toolCallId: string }).toolCallId;
        if (action && toolCallId) {
          results.push({ toolCallId, action, output });
        }
      }
    }
  }
  return results;
}

export function ChatPanel() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const processedToolIds = useRef(new Set<string>());

  // 自定义 transport，在请求中注入 conversationId
  const transport = useRef(
    new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest(request) {
        return {
          body: {
            ...request.body,
            messages: request.messages,
            conversationId: conversationId,
          },
        };
      },
    })
  );

  // conversationId 变化时更新 transport
  useEffect(() => {
    transport.current = new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest(request) {
        return {
          body: {
            ...request.body,
            messages: request.messages,
            conversationId: conversationId,
          },
        };
      },
    });
  }, [conversationId]);

  const { messages, setMessages, sendMessage, stop, status, error } = useChat({
    transport: transport.current,
    onError: (err) => console.error("[NexusChat]", err),
    onFinish: () => {
      setRefreshKey((k) => k + 1);
    },
  });

  const isLoading = status === "submitted" || status === "streaming";

  // 监听工具完成事件，触发客户端副作用
  useEffect(() => {
    const tools = extractCompletedTools(messages);
    for (const { toolCallId, action, output } of tools) {
      if (processedToolIds.current.has(toolCallId)) continue;
      processedToolIds.current.add(toolCallId);
      applyToolSideEffect(action, output);
    }
  }, [messages]);

  const handleSend = useCallback(
    (text: string, files?: FileUIPart[]) => {
      const parts: UIMessage["parts"] = [];
      if (files) {
        for (const f of files) parts.push(f);
      }
      parts.push({ type: "text", text });
      sendMessage({ role: "user", parts });
    },
    [sendMessage]
  );

  const handleSendHint = useCallback(
    (text: string) => {
      sendMessage({ role: "user", parts: [{ type: "text", text }] });
    },
    [sendMessage]
  );

  // 新建对话
  const handleNewChat = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    processedToolIds.current.clear();
  }, [setMessages]);

  // 切换对话：加载历史消息
  const handleSelectConversation = useCallback(
    async (conv: ConversationSummary) => {
      setConversationId(conv.id);
      setMessages([]);
      processedToolIds.current.clear();

      try {
        const res = await fetch(`/api/backend/conversations/${conv.id}`);
        if (!res.ok) return;
        const detail = await res.json();

        const uiMessages: UIMessage[] = (detail.messages ?? []).map(
          (msg: { id: string; role: string; content: string; created_at: string }) => {
            let parts: UIMessage["parts"];
            try {
              const parsed = JSON.parse(msg.content);
              parts = Array.isArray(parsed) ? parsed : [{ type: "text", text: msg.content }];
            } catch {
              parts = [{ type: "text", text: msg.content }];
            }
            return { id: msg.id, role: msg.role as UIMessage["role"], parts };
          }
        );
        setMessages(uiMessages);
      } catch {
        /* 静默处理 */
      }
    },
    [setMessages]
  );

  const handleClear = useCallback(() => {
    setMessages([]);
    processedToolIds.current.clear();
    if (conversationId) {
      fetch(`/api/backend/conversations/${conversationId}/messages`, { method: "DELETE" }).catch(() => {});
    }
  }, [setMessages, conversationId]);

  return (
    <div className="flex h-full flex-col">
      <NxPanelHeader
        title="AI 助手"
        right={
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <NxIconButton size="xs" onClick={handleClear} title="清空对话">
                <Trash2 size={12} />
              </NxIconButton>
            )}
            <NxIconButton size="xs" onClick={handleNewChat} title="新建对话">
              <SquarePen size={12} />
            </NxIconButton>
          </div>
        }
      />

      <ConversationList
        activeId={conversationId}
        onSelect={handleSelectConversation}
        onNew={handleNewChat}
        refreshKey={refreshKey}
      />

      <ChatMessageList
        messages={messages}
        isStreaming={isLoading}
        onHintClick={handleSendHint}
      />

      {error && (
        <div className="mx-3 mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] text-red-400">
          连接错误: {error.message}
        </div>
      )}

      <ChatInput onSend={handleSend} onStop={stop} isLoading={isLoading} />
    </div>
  );
}
