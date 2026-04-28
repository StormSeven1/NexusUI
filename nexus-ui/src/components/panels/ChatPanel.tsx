/**
 * 右侧 AI 对话：DefaultChatTransport 走 `api` → `src/app/api/chat/route.ts`
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { NxPanelHeader, NxIconButton } from "@/components/nexus";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import { ConversationList } from "@/components/chat/ConversationList";
import { applyToolSideEffect } from "@/lib/chat-tool-bridge";
import { useAppConfigStore } from "@/stores/app-config-store";
import { DisposalPlanWsClient } from "@/lib/disposal/disposal-ws-client";
import { toast } from "sonner";
import { useAppStore } from "@/stores/app-store";
import { useDisposalPlanStore } from "@/stores/disposal-plan-store";
import { Trash2, SquarePen, X } from "lucide-react";
import type { FileUIPart, UIMessage } from "ai";
import type { ConversationSummary } from "@/lib/chat-api";

/** 从 assistant 消息里收集已完成工具的 output.action，交给 chat-tool-bridge */
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
  const { selectedAgentMessage, setSelectedAgentMessage } = useAppStore();
  const appendDisposalFromWs = useDisposalPlanStore((s) => s.appendFromNormalized);
  const setDisposalWsStatus = useDisposalPlanStore((s) => s.setWsStatus);
  const disposalWsRef = useRef<DisposalPlanWsClient | null>(null);

  /** 硬编码：右侧面板挂载即连接处置方案 WebSocket（与模式无关） */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await useAppConfigStore.getState().ensureLoaded();
      if (cancelled) return;
      setDisposalWsStatus("connecting");
      const client = new DisposalPlanWsClient({
        handlers: {
          onConnect: () => setDisposalWsStatus("open"),
          onDisconnect: (intentional) => {
            if (!intentional) {
              setDisposalWsStatus("error");
              toast.error("处置方案连接断开", { description: "WebSocket 连接意外断开，将自动重连" });
            }
          },
          onConnectTimeout: () => {
            setDisposalWsStatus("error");
            toast.error("处置方案连接超时", { description: "无法连接方案服务，请检查网络" });
          },
          onPlanReady: (n) => appendDisposalFromWs(n, "ws"),
        },
      });
      client.start();
      disposalWsRef.current = client;
    })();
    return () => {
      cancelled = true;
      disposalWsRef.current?.stop();
      disposalWsRef.current = null;
    };
  }, [appendDisposalFromWs, setDisposalWsStatus]);

  const transport = useMemo(
    () =>
    new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest(request) {
        const state = useAppStore.getState();
        return {
          body: {
            ...request.body,
            messages: request.messages,
            conversationId: conversationId,
            situationalContext: {
              selectedTrackId: state.selectedTrackId,
              mapCenter: state.mapCenter ?? null,
              zoomLevel: state.zoomLevel ?? null,
              mapViewMode: state.mapViewMode,
              highlightedTrackIds: state.highlightedTrackIds,
              visibleLayers: state.layerVisibility
                ? Object.entries(state.layerVisibility)
                    .filter(([, v]) => v)
                    .map(([k]) => k)
                : [],
            },
          },
        };
      },
    }),
    [conversationId]
  );

  const { messages, setMessages, sendMessage, stop, status, error } = useChat({
    transport,
    onError: (err) => console.error("[NexusChat]", err),
    onFinish: () => {
      setRefreshKey((k) => k + 1);
    },
  });

  const isLoading = status === "submitted" || status === "streaming";

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

  // 新会话
  const handleNewChat = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    processedToolIds.current.clear();
  }, [setMessages]);

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
        /* 加载会话失败 */
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
              <NxIconButton size="xs" onClick={handleClear} title="清空会话">
                <Trash2 size={12} />
              </NxIconButton>
            )}
            <NxIconButton size="xs" onClick={handleNewChat} title="新会话">
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

      {/* 选中一条智能体消息时展示详情 */}
      {selectedAgentMessage && (
        <div className="mx-3 mb-2 rounded-md border border-nexus-border bg-nexus-bg-elevated p-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-nexus-accent/20 text-nexus-accent text-xs font-bold">
                {selectedAgentMessage.agentType === "core" && "C"}
                {selectedAgentMessage.agentType === "data" && "D"}
                {selectedAgentMessage.agentType === "tactical" && "T"}
                {selectedAgentMessage.agentType === "analysis" && "A"}
              </div>
              <div>
                <div className="text-xs font-medium text-nexus-text-primary">{selectedAgentMessage.agentName}</div>
                <div className="text-[10px] text-nexus-text-muted">
                  {selectedAgentMessage.timestamp.toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </div>
              </div>
            </div>
            <button
              onClick={() => setSelectedAgentMessage(null)}
              className="h-5 w-5 rounded-md hover:bg-nexus-bg-elevated flex items-center justify-center text-nexus-text-muted hover:text-nexus-text-primary transition-colors"
            >
              <X size={12} />
            </button>
          </div>
          <div className="mb-2">
            <div className="text-xs font-medium text-nexus-text-primary mb-1">{selectedAgentMessage.title}</div>
            <div className={`text-xs ${
              selectedAgentMessage.status === 'error' ? 'text-red-400' :
              selectedAgentMessage.status === 'warning' ? 'text-yellow-400' :
              selectedAgentMessage.status === 'success' ? 'text-green-400' :
              'text-nexus-text-secondary'
            }`}>
              {selectedAgentMessage.content}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
              selectedAgentMessage.status === 'error' ? 'bg-red-500/20 text-red-400' :
              selectedAgentMessage.status === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
              selectedAgentMessage.status === 'success' ? 'bg-green-500/20 text-green-400' :
              'bg-blue-500/20 text-blue-400'
            }`}>
              {selectedAgentMessage.status === "error" && "错误"}
              {selectedAgentMessage.status === "warning" && "需关注"}
              {selectedAgentMessage.status === "success" && "已完成"}
              {selectedAgentMessage.status === "info" && "进行中"}
            </span>
          </div>
        </div>
      )}

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
