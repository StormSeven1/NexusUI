/**
 * 右侧 AI 对话：与 Qt `GPTInterfaceWgt::sendChatToServer` 在 `m_nWorkFlowMode == 1` 时行为对齐，
 * POST `/api/langgraph-chat` → 服务端按环境变量转发对话服务，
 * 请求体 `{ messages: [{ role, content }], user_context: {} }`，SSE `data:` 行 JSON 流式拼助手回复。
 *
 * 左侧多会话 Tab：值班助手 / AI助手 / 动态工作流「会话N」。
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { generateId } from "ai";
import type { FileUIPart, UIMessage } from "ai";
import { NxIconButton } from "@/components/nexus";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { ChatInput, type ChatInputHandle } from "@/components/chat/ChatInput";
import { LangGraphInterruptDialog } from "@/components/chat/LangGraphInterruptDialog";
import { useVlmChatInjectStore } from "@/stores/vlm-chat-inject-store";
import {
  consumeLangGraphSseStream,
  extractLangGraphDisplayChunks,
  parseLangGraphInterruptEvent,
  type LangGraphInterruptUiPayload,
} from "@/lib/langgraph-chat-sse";
import { executeLangGraphToolCallFromData } from "@/lib/langgraph-tool-dispatch";
import {
  extractVerifyEntityIdsFromLangGraphEvent,
} from "@/lib/langgraph-interrupt-verify-entity";
import {
  extractLangGraphTaskIds,
  extractChatNotificationThreadId,
  isLangGraphToolCallEvent,
  shouldRouteToWorkflowSessionTab,
} from "@/lib/langgraph-workflow-task-id";
import {
  clearTaskStatusVerifyChatSession,
  isDailyVerificationParentTaskId,
  registerWorkflowVerifyThreadId,
} from "@/lib/task-status-verify-chat-ingest";
import {
  AI_CHAT_TAB_ID,
  DUTY_CHAT_TAB_ID,
  isAssistantChatLikeTab,
  useAssistantChatTabMessages,
  useAssistantChatTabsStore,
  type AssistantChatTab,
} from "@/stores/assistant-chat-tabs-store";
import { Bot, ChevronRight, Eraser, MessageSquare, Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  logLangGraphChatRequest,
  logLangGraphChatResponse,
  logLangGraphChatSendBlocked,
  logLangGraphChatStreamEnd,
} from "@/lib/langgraph-chat-http-log";

/** 闪电菜单与空状态区共用的快捷问题文案（AI助手 Tab） */
const QUICK_PROMPTS: readonly string[] = [
  "出动2台相机和1架无人机帮我在港外航道监控区上航迹目标中找一艘船",
  "10海里内有多少目标",
  "使用无人机对搜索区1和搜索区2进行搜索",
  "无人机返航",
];

type StreamResponseMode = "pending" | "toolcall" | "workflow";

function appendToLastAssistantText(
  patchMessages: (updater: (prev: UIMessage[]) => UIMessage[]) => void,
  chunk: string,
) {
  if (!chunk) return;
  patchMessages((msgs) => {
    const next = [...msgs];
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].role !== "assistant") continue;
      const parts = [...next[i].parts];
      const ti = parts.findIndex((p) => p.type === "text");
      if (ti >= 0) {
        const p = parts[ti] as { type: "text"; text: string };
        parts[ti] = { type: "text", text: (p.text ?? "") + chunk };
      } else {
        parts.push({ type: "text", text: chunk });
      }
      next[i] = { ...next[i], parts };
      return next;
    }
    return msgs;
  });
}

function isMeaningfulNonToolCallEvent(parsed: Record<string, unknown>): boolean {
  return shouldRouteToWorkflowSessionTab(parsed);
}

function ChatTabSidebar({
  tabs,
  activeTabId,
  onSelect,
  onCreateSession,
}: {
  tabs: AssistantChatTab[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onCreateSession: () => void;
}) {
  return (
    <aside className="flex w-[72px] shrink-0 flex-col border-r border-nexus-border bg-nexus-bg-base/40">
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-2">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const unread = tab.messages.length > 0 && !active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              title={tab.title}
              className={cn(
                "relative mx-1 flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-center transition-colors",
                active
                  ? "bg-sky-500/15 text-sky-200 ring-1 ring-sky-400/30"
                  : "text-nexus-text-muted hover:bg-white/[0.05] hover:text-nexus-text-primary",
              )}
            >
              <MessageSquare className="h-4 w-4 shrink-0" aria-hidden />
              <span className="line-clamp-2 w-full text-[9px] leading-tight">{tab.title}</span>
              {unread && (
                <span
                  className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-sky-400"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="shrink-0 border-t border-nexus-border p-1">
        <button
          type="button"
          onClick={onCreateSession}
          title="新建会话"
          className={cn(
            "mx-auto flex h-9 w-9 items-center justify-center rounded-lg",
            "text-nexus-text-muted transition-colors hover:bg-sky-500/15 hover:text-sky-200",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40",
          )}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </aside>
  );
}

function AiAssistantEmptyState({
  title,
  interruptPrompt,
  onQuickPromptSelect,
}: {
  title: string;
  interruptPrompt: LangGraphInterruptUiPayload | null;
  onQuickPromptSelect: (label: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-3 py-5 sm:px-4">
      <div className="mx-auto w-full max-w-[420px] space-y-6">
        <div
          className={cn(
            "relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-sky-500/[0.12] via-white/[0.04] to-transparent",
            "px-4 py-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_8px_32px_-12px_rgba(0,0,0,0.45)]",
          )}
        >
          <div
            className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-sky-400/10 blur-2xl"
            aria-hidden
          />
          <div className="relative flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/20 ring-1 ring-sky-400/25">
              <Bot className="h-5 w-5 text-sky-300" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <h3 className="text-sm font-semibold tracking-tight text-nexus-text-primary">{title}</h3>
                <p className="mt-0.5 text-[10px] text-nexus-text-muted">智能对话 · 指令调度</p>
              </div>
              <p className="text-[11px] leading-[1.65] text-nexus-text-secondary">
                可根据自然语言理解意图，下发航迹查询、无人机协同等指令。简单查询在本 Tab 回答；任务工作流会自动新建「会话N」Tab 并展示查证进度。
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 px-0.5">
            <Zap className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-nexus-text-muted">
              快捷问题
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-white/[0.08] to-transparent" aria-hidden />
          </div>
          <ul className="flex flex-col gap-2">
            {QUICK_PROMPTS.map((label, index) => (
              <li key={label} className="w-full">
                <button
                  type="button"
                  disabled={!!interruptPrompt}
                  onClick={() => onQuickPromptSelect(label)}
                  className={cn(
                    "group flex w-full items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-left",
                    "shadow-sm transition-all duration-200",
                    "hover:border-sky-500/35 hover:bg-sky-500/[0.07] hover:shadow-[0_0_0_1px_rgba(56,189,248,0.12)]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40",
                    "disabled:pointer-events-none disabled:opacity-45",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold tabular-nums",
                      "bg-white/[0.06] text-nexus-text-muted",
                      "group-hover:bg-sky-500/25 group-hover:text-sky-200",
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 pt-0.5 text-[11px] leading-snug text-nexus-text-primary">
                    {label}
                  </span>
                  <ChevronRight
                    className="mt-1 h-4 w-4 shrink-0 text-nexus-text-muted opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function DutyAssistantEmptyState() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-8 text-center">
      <div className="max-w-[280px] space-y-2">
        <h3 className="text-sm font-semibold text-nexus-text-primary">值班助手</h3>
        <p className="text-[11px] leading-relaxed text-nexus-text-secondary">
          相机与无人机的日常查证信息将在此显示。开启「自主值班」后，查证进度与研判结果会自动写入本 Tab。
        </p>
      </div>
    </div>
  );
}

export function ChatPanelLangGraph() {
  const tabs = useAssistantChatTabsStore((s) => s.tabs);
  const activeTabId = useAssistantChatTabsStore((s) => s.activeTabId);
  const setActiveTabId = useAssistantChatTabsStore((s) => s.setActiveTabId);
  const createWorkflowTab = useAssistantChatTabsStore((s) => s.createWorkflowTab);
  const createUserChatTab = useAssistantChatTabsStore((s) => s.createUserChatTab);
  const clearTabContent = useAssistantChatTabsStore((s) => s.clearTabContent);
  const deleteTab = useAssistantChatTabsStore((s) => s.deleteTab);
  const setTabLangGraphThreadId = useAssistantChatTabsStore((s) => s.setTabLangGraphThreadId);
  const registerTaskIdsForTab = useAssistantChatTabsStore((s) => s.registerTaskIdsForTab);
  const registerVerifyEntityIdsForTab = useAssistantChatTabsStore((s) => s.registerVerifyEntityIdsForTab);
  const setActiveWorkflowVerifyTabId = useAssistantChatTabsStore((s) => s.setActiveWorkflowVerifyTabId);
  const finishWorkflowVerifyRouting = useAssistantChatTabsStore((s) => s.finishWorkflowVerifyRouting);
  const patchTabMessages = useAssistantChatTabsStore((s) => s.patchTabMessages);

  const [messages] = useAssistantChatTabMessages(activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const chatLikeActive = isAssistantChatLikeTab(activeTab);

  const [isStreaming, setIsStreaming] = useState(false);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const leadingToolbarRef = useRef<HTMLDivElement | null>(null);
  const vlmInjectSeq = useVlmChatInjectStore((s) => s.injectSeq);
  const [interruptPrompt, setInterruptPrompt] = useState<LangGraphInterruptUiPayload | null>(null);

  const streamTabIdRef = useRef(activeTabId);
  const sourceTabIdForStreamRef = useRef(activeTabId);
  const responseModeRef = useRef<StreamResponseMode>("pending");
  /** 本轮 SSE 是否已为本工作流新建「会话N」（每次发消息重置，禁止复用旧 workflow Tab） */
  const workflowStreamPromotedRef = useRef(false);
  const pendingPairRef = useRef<{ userId: string; asstId: string } | null>(null);

  useEffect(() => {
    if (!quickMenuOpen) return;
    const onDocDown = (e: MouseEvent) => {
      const el = leadingToolbarRef.current;
      if (el && !el.contains(e.target as Node)) setQuickMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [quickMenuOpen]);

  useEffect(() => {
    const p = useVlmChatInjectStore.getState().consumePending();
    if (!p) return;
    const userId = generateId();
    const asstId = generateId();
    patchTabMessages(AI_CHAT_TAB_ID, (msgs) => [
      ...msgs,
      {
        id: userId,
        role: "user",
        parts: [
          { type: "text", text: p.userText },
          {
            type: "file",
            url: p.imageUrl,
            mediaType: p.imageMediaType ?? "image/png",
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
    setActiveTabId(AI_CHAT_TAB_ID);
  }, [vlmInjectSeq, patchTabMessages, setActiveTabId]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const handleClearContent = useCallback(() => {
    stop();
    setQuickMenuOpen(false);
    setInterruptPrompt(null);
    clearTaskStatusVerifyChatSession(activeTabId);
    clearTabContent(activeTabId);
  }, [stop, clearTabContent, activeTabId]);

  const handleDeleteSession = useCallback(() => {
    stop();
    setQuickMenuOpen(false);
    setInterruptPrompt(null);
    clearTaskStatusVerifyChatSession(activeTabId);
    if (!deleteTab(activeTabId)) {
      toast.message("Cannot delete this tab", {
        description: "Duty Assistant and AI Assistant are fixed tabs.",
      });
    }
  }, [stop, deleteTab, activeTabId]);

  const revertMistakenWorkflowTab = useCallback(() => {
    const sourceTabId = sourceTabIdForStreamRef.current;
    const workflowTabId = streamTabIdRef.current;
    if (!workflowTabId || workflowTabId === sourceTabId) return;
    const wfTab = useAssistantChatTabsStore.getState().getTabById(workflowTabId);
    if (wfTab?.kind !== "workflow") return;
    finishWorkflowVerifyRouting(workflowTabId);
    const moved = wfTab.messages;
    deleteTab(workflowTabId);
    if (moved.length > 0) {
      patchTabMessages(sourceTabId, (m) => [...m, ...moved]);
    }
    streamTabIdRef.current = sourceTabId;
    responseModeRef.current = "toolcall";
    setActiveTabId(sourceTabId);
  }, [deleteTab, finishWorkflowVerifyRouting, patchTabMessages, setActiveTabId]);

  const finishStreamWorkflowVerifyRouting = useCallback(() => {
    const tabId = streamTabIdRef.current;
    const tab = useAssistantChatTabsStore.getState().getTabById(tabId);
    if (tab?.kind === "workflow" && responseModeRef.current === "workflow") {
      finishWorkflowVerifyRouting(tabId);
    }
  }, [finishWorkflowVerifyRouting]);

  const ensureWorkflowTabForStream = useCallback(() => {
    if (workflowStreamPromotedRef.current) {
      return streamTabIdRef.current;
    }

    const pair = pendingPairRef.current;
    const sourceTabId = sourceTabIdForStreamRef.current;
    const sourceMessages =
      useAssistantChatTabsStore.getState().getTabById(sourceTabId)?.messages ?? [];
    const userMsg = pair ? sourceMessages.find((m) => m.id === pair.userId) : undefined;
    const asstMsg = pair ? sourceMessages.find((m) => m.id === pair.asstId) : undefined;

    const newTabId = createWorkflowTab();
    workflowStreamPromotedRef.current = true;
    responseModeRef.current = "workflow";
    streamTabIdRef.current = newTabId;
    setActiveWorkflowVerifyTabId(newTabId);

    if (pair) {
      patchTabMessages(sourceTabId, (msgs) =>
        msgs.filter((m) => m.id !== pair.userId && m.id !== pair.asstId),
      );
      const moved: UIMessage[] = [];
      if (userMsg) moved.push(userMsg);
      else {
        moved.push({
          id: pair.userId,
          role: "user",
          parts: [{ type: "text", text: "" }],
        });
      }
      if (asstMsg) moved.push(asstMsg);
      else {
        moved.push({
          id: pair.asstId,
          role: "assistant",
          parts: [{ type: "text", text: "" }],
        });
      }
      patchTabMessages(newTabId, (msgs) => [...msgs, ...moved]);
    }
    return newTabId;
  }, [createWorkflowTab, patchTabMessages, setActiveWorkflowVerifyTabId]);

  const processLangGraphParsedLine = useCallback(
    async (parsed: Record<string, unknown>) => {
      let tabId = streamTabIdRef.current;

      if (isLangGraphToolCallEvent(parsed)) {
        if (responseModeRef.current === "pending") {
          responseModeRef.current = "toolcall";
        }
        if (
          responseModeRef.current === "workflow" &&
          streamTabIdRef.current !== sourceTabIdForStreamRef.current
        ) {
          revertMistakenWorkflowTab();
        }
      } else if (
        !workflowStreamPromotedRef.current &&
        responseModeRef.current === "pending" &&
        isMeaningfulNonToolCallEvent(parsed)
      ) {
        tabId = ensureWorkflowTabForStream();
      }

      tabId = streamTabIdRef.current;

      const notifyThreadId = extractChatNotificationThreadId(parsed);
      if (notifyThreadId && !isDailyVerificationParentTaskId(notifyThreadId)) {
        tabId = ensureWorkflowTabForStream();
        registerWorkflowVerifyThreadId(notifyThreadId, tabId);
      }

      const tid = parsed.thread_id;
      if (typeof tid === "string" && tid.trim()) {
        setTabLangGraphThreadId(tabId, tid.trim());
      }

      const taskIds = extractLangGraphTaskIds(parsed);
      if (taskIds.length > 0) {
        registerTaskIdsForTab(tabId, taskIds);
      }

      const wfTab = useAssistantChatTabsStore.getState().getTabById(tabId);
      if (wfTab?.kind === "workflow") {
        const entityIds = extractVerifyEntityIdsFromLangGraphEvent(parsed);
        if (entityIds.length > 0) {
          registerVerifyEntityIdsForTab(tabId, entityIds);
        }
      }

      const patchForStream = (updater: (prev: UIMessage[]) => UIMessage[]) => {
        patchTabMessages(tabId, updater);
      };

      const intr = parseLangGraphInterruptEvent(parsed);
      if (intr) {
        setInterruptPrompt(intr);
        const wfOnInterrupt = useAssistantChatTabsStore.getState().getTabById(tabId);
        if (wfOnInterrupt?.kind === "workflow") {
          setActiveWorkflowVerifyTabId(tabId);
        }
        if (intr.verifyEntityIds.length > 0) {
          registerVerifyEntityIdsForTab(tabId, intr.verifyEntityIds);
        }
        appendToLastAssistantText(
          patchForStream,
          "\n\n—— 任务流已暂停，请在弹窗中确认后继续 ——\n",
        );
        return;
      }

      const ev = String(parsed.event ?? "");
      if (ev === "tool_call" && parsed.data != null && typeof parsed.data === "object") {
        const reply = await executeLangGraphToolCallFromData(parsed.data as Record<string, unknown>);
        if (reply) appendToLastAssistantText(patchForStream, reply);
        return;
      }
      for (const c of extractLangGraphDisplayChunks(parsed)) {
        appendToLastAssistantText(patchForStream, c);
      }
    },
    [ensureWorkflowTabForStream, patchTabMessages, registerTaskIdsForTab, registerVerifyEntityIdsForTab, revertMistakenWorkflowTab, setActiveWorkflowVerifyTabId, setTabLangGraphThreadId],
  );

  const resumeLangGraphInterrupt = useCallback(
    async (p: LangGraphInterruptUiPayload, feedbackValue: string) => {
      const ac = new AbortController();
      abortRef.current = ac;
      setInterruptPrompt(null);
      setIsStreaming(true);
      const tabId = streamTabIdRef.current;
      const resumeTab = useAssistantChatTabsStore.getState().getTabById(tabId);
      if (resumeTab?.kind === "workflow") {
        setActiveWorkflowVerifyTabId(tabId);
      }
      const body: Record<string, unknown> = {
        interrupt_feedback: { [p.interruptId]: feedbackValue },
        interrupt_id: p.mainInterruptId,
        thread_id: p.threadId,
      };
      const chatUrl = "/api/langgraph-chat";
      const chatHeaders = { "Content-Type": "application/json", Accept: "text/event-stream" };
      const reqStarted = performance.now();
      const seq = logLangGraphChatRequest({
        kind: "interrupt_resume",
        url: chatUrl,
        method: "POST",
        headers: chatHeaders,
        body,
        userTextPreview: `[interrupt] ${p.mainInterruptId}`,
      });
      try {
        const res = await fetch(chatUrl, {
          method: "POST",
          headers: chatHeaders,
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        if (!res.ok) {
          const raw = await res.text();
          let detail = "";
          try {
            const j = JSON.parse(raw) as { error?: string; detail?: string };
            detail = (j.detail ?? j.error ?? "").trim();
          } catch {
            detail = raw.trim();
          }
          logLangGraphChatResponse({
            kind: "interrupt_resume",
            url: chatUrl,
            status: res.status,
            statusText: res.statusText,
            ok: false,
            seq,
            durationMs: Math.round(performance.now() - reqStarted),
            errorDetail: detail || raw.slice(0, 500),
          });
          throw new Error(detail || `HTTP ${res.status}`);
        }
        logLangGraphChatResponse({
          kind: "interrupt_resume",
          url: chatUrl,
          status: res.status,
          statusText: res.statusText,
          ok: true,
          seq,
          durationMs: Math.round(performance.now() - reqStarted),
        });
        const reader = res.body?.getReader();
        if (!reader) throw new Error("无响应体");
        const streamStarted = performance.now();
        const streamResult = await consumeLangGraphSseStream(reader, processLangGraphParsedLine, {
          kind: "interrupt_resume",
          logSeq: seq,
          signal: ac.signal,
        });
        logLangGraphChatStreamEnd({
          kind: "interrupt_resume",
          seq,
          reason: streamResult.reason,
          eventCount: streamResult.eventCount,
          durationMs: Math.round(performance.now() - streamStarted),
        });
      } catch (e) {
        const patchForStream = (updater: (prev: UIMessage[]) => UIMessage[]) => {
          patchTabMessages(tabId, updater);
        };
        if ((e as Error).name === "AbortError") {
          appendToLastAssistantText(patchForStream, "\n\n[已停止]");
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          toast.error("中断反馈请求失败", { description: msg });
          appendToLastAssistantText(patchForStream, `\n\n❌ ${msg}`);
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
        finishStreamWorkflowVerifyRouting();
      }
    },
    [finishStreamWorkflowVerifyRouting, patchTabMessages, processLangGraphParsedLine, setActiveWorkflowVerifyTabId],
  );

  const runLangGraphStream = useCallback(
    async (userText: string, sourceTabId: string) => {
      const ac = new AbortController();
      abortRef.current = ac;
      setIsStreaming(true);

      const userId = generateId();
      const asstId = generateId();
      pendingPairRef.current = { userId, asstId };
      responseModeRef.current = "pending";
      workflowStreamPromotedRef.current = false;
      sourceTabIdForStreamRef.current = sourceTabId;

      const initialTabId = sourceTabId;
      streamTabIdRef.current = initialTabId;

      patchTabMessages(initialTabId, (m) => [
        ...m,
        { id: userId, role: "user", parts: [{ type: "text", text: userText }] },
        { id: asstId, role: "assistant", parts: [{ type: "text", text: "" }] },
      ]);

      const sourceTab = useAssistantChatTabsStore.getState().getTabById(sourceTabId);
      if (isAssistantChatLikeTab(sourceTab)) {
        setActiveTabId(sourceTabId);
      }

      const body: Record<string, unknown> = {
        messages: [{ role: "user", content: userText }],
        user_context: {} as Record<string, unknown>,
      };

      const chatUrl = "/api/langgraph-chat";
      const chatHeaders = { "Content-Type": "application/json", Accept: "text/event-stream" };
      const reqStarted = performance.now();
      const seq = logLangGraphChatRequest({
        kind: "chat",
        url: chatUrl,
        method: "POST",
        headers: chatHeaders,
        body,
        userTextPreview: userText.slice(0, 200),
      });

      try {
        const res = await fetch(chatUrl, {
          method: "POST",
          headers: chatHeaders,
          body: JSON.stringify(body),
          signal: ac.signal,
        });

        if (!res.ok) {
          const raw = await res.text();
          let detail = "";
          try {
            const j = JSON.parse(raw) as { error?: string; detail?: string };
            detail = (j.detail ?? j.error ?? "").trim();
          } catch {
            detail = raw.trim();
          }
          logLangGraphChatResponse({
            kind: "chat",
            url: chatUrl,
            status: res.status,
            statusText: res.statusText,
            ok: false,
            seq,
            durationMs: Math.round(performance.now() - reqStarted),
            errorDetail: detail || raw.slice(0, 500),
          });
          throw new Error(detail || `HTTP ${res.status}`);
        }
        logLangGraphChatResponse({
          kind: "chat",
          url: chatUrl,
          status: res.status,
          statusText: res.statusText,
          ok: true,
          seq,
          durationMs: Math.round(performance.now() - reqStarted),
        });

        const reader = res.body?.getReader();
        if (!reader) throw new Error("无响应体");
        const streamStarted = performance.now();
        const streamResult = await consumeLangGraphSseStream(reader, processLangGraphParsedLine, {
          kind: "chat",
          logSeq: seq,
          signal: ac.signal,
        });
        logLangGraphChatStreamEnd({
          kind: "chat",
          seq,
          reason: streamResult.reason,
          eventCount: streamResult.eventCount,
          durationMs: Math.round(performance.now() - streamStarted),
        });
      } catch (e) {
        const tabId = streamTabIdRef.current;
        const patchForStream = (updater: (prev: UIMessage[]) => UIMessage[]) => {
          patchTabMessages(tabId, updater);
        };
        if ((e as Error).name === "AbortError") {
          appendToLastAssistantText(patchForStream, "\n\n[已停止]");
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          toast.error("助手服务请求失败", { description: msg });
          appendToLastAssistantText(patchForStream, `\n\n❌ ${msg}`);
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
        pendingPairRef.current = null;
        finishStreamWorkflowVerifyRouting();
      }
    },
    [finishStreamWorkflowVerifyRouting, patchTabMessages, processLangGraphParsedLine, setActiveTabId],
  );

  const handleQuickPromptSelect = useCallback(
    (label: string) => {
      if (interruptPrompt) {
        toast.message("请先处理任务确认弹窗", {
          description: "继续执行、取消任务或关闭弹窗后再选择快捷问题",
        });
        return;
      }
      setQuickMenuOpen(false);
      chatInputRef.current?.setDraft(label);
    },
    [interruptPrompt],
  );

  const handleCreateSession = useCallback(() => {
    if (isStreaming) {
      toast.message("请等待当前回复结束", { description: "流式响应完成后再新建会话" });
      return;
    }
    if (interruptPrompt) {
      toast.message("请先处理任务确认弹窗", { description: "关闭弹窗后再新建会话" });
      return;
    }
    createUserChatTab();
    setQuickMenuOpen(false);
    chatInputRef.current?.setDraft("");
  }, [createUserChatTab, interruptPrompt, isStreaming]);

  const handleSend = useCallback(
    (text: string, files?: FileUIPart[]) => {
      if (files && files.length > 0) {
        toast.message("当前模式仅支持文字", { description: "暂未开放附件上传" });
      }
      const t = text.trim();
      if (!t) return;
      if (isStreaming) {
        logLangGraphChatSendBlocked("上一轮仍在流式响应中 (isStreaming=true)");
        return;
      }
      if (interruptPrompt) {
        logLangGraphChatSendBlocked("存在未处理的任务中断弹窗", {
          threadId: interruptPrompt.threadId,
          interruptId: interruptPrompt.interruptId,
        });
        toast.message("请先处理任务确认弹窗", { description: "继续执行、取消任务或关闭弹窗后再发送" });
        return;
      }
      void runLangGraphStream(t, activeTabId);
    },
    [activeTabId, interruptPrompt, isStreaming, runLangGraphStream],
  );

  const showChatLikeEmpty = chatLikeActive && messages.length === 0;
  const showDutyEmpty = activeTabId === DUTY_CHAT_TAB_ID && messages.length === 0;
  const emptyStateTitle = activeTab?.title ?? "AI助手";

  const canDeleteActiveTab =
    activeTab?.kind === "user" || activeTab?.kind === "workflow";
  const canUseQuickPrompts =
    chatLikeActive || activeTab?.kind === "workflow" || activeTab?.kind === "duty";
  const assistantLabel = activeTab?.title ?? "AI助手";

  const leadingToolbar = (
    <div ref={leadingToolbarRef} className="flex shrink-0 items-center gap-1">
      <NxIconButton size="md" onClick={handleClearContent} title="清空对话">
        <Eraser size={15} strokeWidth={2} />
      </NxIconButton>
      <NxIconButton
        size="md"
        onClick={handleDeleteSession}
        disabled={!canDeleteActiveTab}
        title={canDeleteActiveTab ? "删除会话" : "固定 Tab 不可删除，可用橡皮擦清空"}
      >
        <Trash2 size={15} strokeWidth={2} />
      </NxIconButton>
      <div className="relative flex items-center">
        <NxIconButton
          size="md"
          onClick={() => setQuickMenuOpen((o) => !o)}
          disabled={!canUseQuickPrompts || !!interruptPrompt}
          title={
            canUseQuickPrompts
              ? "快捷问题"
              : "当前 Tab 不可用快捷问题"
          }
        >
          <Zap size={15} strokeWidth={2} />
        </NxIconButton>
        {quickMenuOpen && canUseQuickPrompts && (
          <div
            className="absolute bottom-full left-0 z-[100] mb-1 flex max-h-[min(50vh,320px)] w-[min(calc(100vw-2rem),320px)] flex-col gap-0.5 overflow-y-auto rounded-md border border-nexus-border bg-nexus-bg-elevated p-1.5 shadow-xl"
            role="menu"
          >
            {QUICK_PROMPTS.map((label) => (
              <button
                key={label}
                type="button"
                className="rounded px-2 py-1.5 text-left text-[11px] leading-snug text-nexus-text-primary hover:bg-white/[0.06]"
                onClick={() => handleQuickPromptSelect(label)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ChatTabSidebar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={setActiveTabId}
          onCreateSession={handleCreateSession}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {showChatLikeEmpty ? (
              <AiAssistantEmptyState
                title={emptyStateTitle}
                interruptPrompt={interruptPrompt}
                onQuickPromptSelect={handleQuickPromptSelect}
              />
            ) : showDutyEmpty ? (
              <DutyAssistantEmptyState />
            ) : (
              <ChatMessageList
                messages={messages}
                isStreaming={isStreaming}
                assistantLabel={assistantLabel}
              />
            )}
          </div>
          <ChatInput
            ref={chatInputRef}
            onSend={handleSend}
            onStop={stop}
            isLoading={isStreaming || !!interruptPrompt}
            leadingToolbar={leadingToolbar}
            enableVoiceInput
          />
        </div>
      </div>
      <LangGraphInterruptDialog
        open={!!interruptPrompt}
        payload={interruptPrompt}
        submitting={isStreaming}
        onDismiss={() => {
          if (isStreaming) return;
          setInterruptPrompt(null);
        }}
        onConfirm={() => {
          if (!interruptPrompt || isStreaming) return;
          const tabId = streamTabIdRef.current;
          if (interruptPrompt.verifyEntityIds.length > 0) {
            registerVerifyEntityIdsForTab(tabId, interruptPrompt.verifyEntityIds);
          }
          void resumeLangGraphInterrupt(interruptPrompt, "[CONFIRM]");
        }}
        onCancelTask={() => {
          if (!interruptPrompt || isStreaming) return;
          void resumeLangGraphInterrupt(interruptPrompt, "[CANCEL]");
        }}
        onSubmitDetails={(details) => {
          if (!interruptPrompt || isStreaming) return;
          const tabId = streamTabIdRef.current;
          if (interruptPrompt.verifyEntityIds.length > 0) {
            registerVerifyEntityIdsForTab(tabId, interruptPrompt.verifyEntityIds);
          }
          void resumeLangGraphInterrupt(interruptPrompt, details);
        }}
      />
    </div>
  );
}
