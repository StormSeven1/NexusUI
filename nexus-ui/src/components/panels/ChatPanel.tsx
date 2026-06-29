"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Trash2, SquarePen, X } from "lucide-react";
import type { FileUIPart, UIMessage } from "ai";

import { NxIconButton, NxPanelHeader } from "@/components/nexus";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { ConversationList } from "@/components/chat/ConversationList";
import { applyToolSideEffect } from "@/lib/chat-tool-bridge";
import type { ConversationSummary } from "@/lib/chat-api";
import { useAppStore } from "@/stores/app-store";

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
        if (action && toolCallId) results.push({ toolCallId, action, output });
      }
    }
  }
  return results;
}

function generateThreadId(): string {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 8);
  return `session_${date}_${rand}`;
}

export function ChatPanel() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState(generateThreadId);
  const [refreshKey, setRefreshKey] = useState(0);
  const processedToolIds = useRef(new Set<string>());
  const conversationIdRef = useRef<string | null>(null);
  const { selectedAgentMessage, setSelectedAgentMessage } = useAppStore();

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const persistMessage = useCallback((cid: string | null, role: string, content: string) => {
    if (!cid || !content) return;
    fetch(`/api/backend/conversations/${cid}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, content }),
    }).catch(() => {});
  }, []);

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
              conversationId,
              threadId,
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
    [conversationId, threadId],
  );

  const ensureConversation = useCallback(async (firstMsg?: string) => {
    if (conversationId) return conversationId;
    try {
      const res = await fetch("/api/backend/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: firstMsg?.slice(0, 40) || "新对话", category: "chat" }),
      });
      if (res.ok) {
        const conv = await res.json();
        setConversationId(conv.id);
        conversationIdRef.current = conv.id;
        return conv.id as string;
      }
    } catch {
      /* backend may be offline */
    }
    return null;
  }, [conversationId]);

  const { messages, setMessages, sendMessage, stop, status, error } = useChat({
    transport,
    onError: (err) => console.error("[NexusChat]", err),
    onFinish: ({ message: finishedMsg }) => {
      const text = (finishedMsg.parts ?? [])
        .filter((p) => p.type === "text")
        .map((p) => (p as { type: "text"; text: string }).text)
        .join("");
      persistMessage(conversationIdRef.current, "assistant", text);
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
    async (text: string, files?: FileUIPart[]) => {
      const cid = await ensureConversation(text);
      persistMessage(cid, "user", text);
      setRefreshKey((k) => k + 1);

      const parts: UIMessage["parts"] = [];
      if (files) {
        for (const f of files) parts.push(f);
      }
      parts.push({ type: "text", text });
      sendMessage({ role: "user", parts });
    },
    [sendMessage, ensureConversation, persistMessage],
  );

  const handleSendHint = useCallback(
    async (text: string) => {
      const cid = await ensureConversation(text);
      persistMessage(cid, "user", text);
      setRefreshKey((k) => k + 1);
      sendMessage({ role: "user", parts: [{ type: "text", text }] });
    },
    [sendMessage, ensureConversation, persistMessage],
  );

  const handleNewChat = useCallback(() => {
    setConversationId(null);
    conversationIdRef.current = null;
    setThreadId(generateThreadId());
    setMessages([]);
    processedToolIds.current.clear();
  }, [setMessages]);

  const handleSelectConversation = useCallback(
    async (conv: ConversationSummary) => {
      setConversationId(conv.id);
      conversationIdRef.current = conv.id;
      setMessages([]);
      processedToolIds.current.clear();

      try {
        const res = await fetch(`/api/backend/conversations/${conv.id}`);
        if (!res.ok) return;
        const detail = await res.json();
        const uiMessages: UIMessage[] = [];
        for (const msg of (detail.messages ?? []) as Array<{ id: string; role: string; content: string }>) {
          let parts: UIMessage["parts"];
          try {
            const parsed = JSON.parse(msg.content);
            parts = Array.isArray(parsed) ? parsed : [{ type: "text", text: msg.content }];
          } catch {
            parts = [{ type: "text", text: msg.content }];
          }
          uiMessages.push({ id: msg.id, role: msg.role as UIMessage["role"], parts });
        }
        setMessages(uiMessages);
      } catch {
        /* ignore load failure */
      }
    },
    [setMessages],
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
        title="作管智能助手"
        right={
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <NxIconButton size="xs" onClick={handleClear} title="清空对话">
                <Trash2 size={12} />
              </NxIconButton>
            )}
            <NxIconButton size="xs" onClick={handleNewChat} title="新对话">
              <SquarePen size={12} />
            </NxIconButton>
          </div>
        }
      />

      <ConversationList
        category="chat"
        activeId={conversationId}
        onSelect={handleSelectConversation}
        onNew={handleNewChat}
        refreshKey={refreshKey}
        currentLabel="当前对话"
        currentActive
        currentCount={messages.length}
        activeBadgeLabel="当前"
      />

      {selectedAgentMessage && (
        <div className="mx-3 mb-2 rounded-md border border-nexus-border bg-nexus-bg-elevated p-3">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-nexus-accent/20 text-xs font-bold text-nexus-accent">
                {selectedAgentMessage.agentType === "core" && "C"}
                {selectedAgentMessage.agentType === "data" && "D"}
                {selectedAgentMessage.agentType === "tactical" && "T"}
                {selectedAgentMessage.agentType === "analysis" && "A"}
              </div>
              <div>
                <div className="text-xs font-medium text-nexus-text-primary">{selectedAgentMessage.agentName}</div>
                <div className="text-[10px] text-nexus-text-muted">
                  {selectedAgentMessage.timestamp.toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </div>
              </div>
            </div>
            <button
              onClick={() => setSelectedAgentMessage(null)}
              className="flex h-5 w-5 items-center justify-center rounded-md text-nexus-text-muted transition-colors hover:bg-nexus-bg-elevated hover:text-nexus-text-primary"
            >
              <X size={12} />
            </button>
          </div>
          <div className="mb-2">
            <div className="mb-1 text-xs font-medium text-nexus-text-primary">{selectedAgentMessage.title}</div>
            <div
              className={`text-xs ${
                selectedAgentMessage.status === "error"
                  ? "text-red-400"
                  : selectedAgentMessage.status === "warning"
                    ? "text-yellow-400"
                    : selectedAgentMessage.status === "success"
                      ? "text-green-400"
                      : "text-nexus-text-secondary"
              }`}
            >
              {selectedAgentMessage.content}
            </div>
          </div>
        </div>
      )}

      <ChatMessageList messages={messages} isStreaming={isLoading} onHintClick={handleSendHint} />

      {error && (
        <div className="mx-3 mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] text-red-400">
          连接错误: {error.message}
        </div>
      )}

      <ChatInput onSend={handleSend} onStop={stop} isLoading={isLoading} />
    </div>
  );
}
