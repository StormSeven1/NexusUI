/**
 * 右侧 AI 对话：与 Qt `GPTInterfaceWgt::sendChatToServer` 在 `m_nWorkFlowMode == 1` 时行为对齐。
 * - 智能助手：`POST /api/langgraph-chat`
 * - 知识库：`POST /api/knowledge-base-chat`
 * 两者均转发任务管理 `POST /api/v1/chat/stream`，复用同一套 SSE 消费与工作流渲染
 *（`workflow_update` / `message_chunk` / `chat_notification` / `interrupt` / `chat_answer` / `map_command`）。
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
import { KnowledgeBaseInterruptDialog } from "@/components/chat/KnowledgeBaseInterruptDialog";
import { useVlmChatInjectStore } from "@/stores/vlm-chat-inject-store";
import {
  consumeLangGraphSseStream,
  extractLangGraphDisplayChunks,
  shouldPrefixedNewlineForLangGraphEvent,
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
  extractChatNotificationAlertArea,
  extractLangGraphWorkflowName,
  isBirdRadarAcquisitionWorkflow,
  isLangGraphToolCallEvent,
  shouldRouteToWorkflowSessionTab,
} from "@/lib/langgraph-workflow-task-id";
import {
  clearTaskStatusVerifyChatSession,
  isDailyVerificationParentTaskId,
  registerWorkflowVerifyThreadId,
} from "@/lib/task-status-verify-chat-ingest";
import {
  postWorkflowStopCapture,
  postWorkflowTerminate,
} from "@/lib/quick-workflow-client";
import {
  AI_CHAT_TAB_ID,
  DUTY_CHAT_TAB_ID,
  isAssistantChatLikeTab,
  useAssistantChatTabMessages,
  useAssistantChatTabsStore,
  type AssistantChatTab,
} from "@/stores/assistant-chat-tabs-store";
import { BookOpen, Bot, ChevronRight, Eraser, MessageSquare, Plus, Square, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useDbAreaStore } from "@/stores/db-area-store";
import {
  logLangGraphChatRequest,
  logLangGraphChatResponse,
  logLangGraphChatSendBlocked,
  logLangGraphChatStreamEnd,
} from "@/lib/langgraph-chat-http-log";
import {
  applyWorkflowUpdateToProgress,
  createWorkflowProgressPart,
  extractWorkflowProgressMeta,
  isWorkflowProgressPart,
  type WorkflowProgressData,
} from "@/lib/langgraph-workflow-progress";
import {
  extractWorkflowDevicesFromChatNotification,
  extractWorkflowTopicFromMessageChunk,
} from "@/lib/langgraph-workflow-context";
import { WorkflowDeviceStrip } from "@/components/chat/WorkflowDeviceStrip";
import {
  buildKnowledgeBaseChatRequestBody,
  buildKnowledgeBaseResumeRequestBody,
} from "@/lib/knowledge-base-chat-context";
import {
  formatKnowledgeBaseChatAnswerSuffix,
  parseKnowledgeBaseInterrupt,
  parseTaskManagerMapCommandFromSse,
  type KnowledgeBasePendingInterrupt,
} from "@/lib/knowledge-base-chat-sse";
import {
  createDbQaStreamState,
  finalizeDbQaStreamIfNeeded,
  handleDbQaChatAnswerEvent,
  isDbQaRoutedChatAnswer,
  pickDbQaAnswerId,
  type DbQaStreamState,
} from "@/lib/knowledge-base-db-qa-adapter";
import {
  executeTaskManagerMapCommand,
  formatMapCommandFeedback,
} from "@/lib/task-manager-map-command-adapter";
import { useAssistantPanelSessionStore } from "@/stores/assistant-panel-session-store";

/** 闪电菜单与空状态区共用的快捷问题（智能助手 / 知识库模式一致） */
const ASSISTANT_QUICK_PROMPTS: readonly string[] = [
  "出动2台相机和1架无人机帮我在港外航道监控区上航迹目标中找一艘船",
  "10海里内有多少目标",
  "使用无人机对搜索区1和搜索区2进行搜索",
  "无人机返航",
  "启动探鸟雷达自动采集, 目标区域是探鸟雷达分类数据采集区, 航线类型为多点, 无人机ID列表为uav-006, uav-007",
];

type AssistantApiMode = "assistant" | "knowledge-base";

function resolveBusinessWorkflowThreadId(tab: AssistantChatTab | undefined): string {
  if (!tab) return "";
  if (tab.businessWorkflowThreadId.trim()) return tab.businessWorkflowThreadId.trim();
  for (const id of tab.taskIds) {
    const t = id.trim();
    if (!t) continue;
    if (/tanniao_radar|_workflow_/i.test(t)) return t;
  }
  return "";
}

function tabLooksLikeBirdRadarWorkflow(tab: AssistantChatTab | undefined): boolean {
  if (!tab || tab.kind !== "workflow") return false;
  const hint = tab.messages
    .filter((m) => m.role === "user")
    .map((m) =>
      m.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join(""),
    )
    .join("\n");
  return isBirdRadarAcquisitionWorkflow({
    workflowName: tab.workflowName,
    businessWorkflowThreadId: tab.businessWorkflowThreadId,
    title: tab.title,
    hintText: hint,
  });
}
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

/** 工作流 SSE 始终写入本轮固定的助手气泡（避免查证等后续气泡抢「最后一条 assistant」） */
function appendToAssistantTextById(
  patchMessages: (updater: (prev: UIMessage[]) => UIMessage[]) => void,
  messageId: string | null | undefined,
  chunk: string,
) {
  if (!chunk) return;
  let applied = false;
  patchMessages((msgs) => {
    if (messageId) {
      const idx = msgs.findIndex((m) => m.id === messageId && m.role === "assistant");
      if (idx >= 0) {
        applied = true;
        const next = [...msgs];
        const parts = [...next[idx].parts];
        const ti = parts.findIndex((p) => p.type === "text");
        if (ti >= 0) {
          const p = parts[ti] as { type: "text"; text: string };
          parts[ti] = { type: "text", text: (p.text ?? "") + chunk };
        } else {
          parts.push({ type: "text", text: chunk });
        }
        next[idx] = { ...next[idx], parts };
        return next;
      }
    }
    return msgs;
  });
  if (!applied) {
    appendToLastAssistantText(patchMessages, chunk);
  }
}

function appendToStreamAssistantText(
  patchMessages: (updater: (prev: UIMessage[]) => UIMessage[]) => void,
  messageId: string | null | undefined,
  chunk: string,
) {
  if (messageId) {
    appendToAssistantTextById(patchMessages, messageId, chunk);
    return;
  }
  appendToLastAssistantText(patchMessages, chunk);
}

/** 原位替换助手气泡正文（db_qa：delta 拼接 / final 覆盖） */
function setAssistantTextById(
  patchMessages: (updater: (prev: UIMessage[]) => UIMessage[]) => void,
  messageId: string | null | undefined,
  text: string,
) {
  patchMessages((msgs) => {
    const next = [...msgs];
    let idx = -1;
    if (messageId) {
      idx = next.findIndex((m) => m.id === messageId && m.role === "assistant");
    }
    if (idx < 0) {
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "assistant") {
          idx = i;
          break;
        }
      }
    }
    if (idx < 0) return msgs;
    const parts = [...next[idx].parts];
    const ti = parts.findIndex((p) => p.type === "text");
    if (ti >= 0) {
      parts[ti] = { type: "text", text };
    } else {
      parts.push({ type: "text", text });
    }
    next[idx] = { ...next[idx], parts };
    return next;
  });
}

/** 更新助手气泡上的工作流进度树 part（无则插入） */
function upsertWorkflowProgressOnAssistant(
  patchMessages: (updater: (prev: UIMessage[]) => UIMessage[]) => void,
  messageId: string | null | undefined,
  data: WorkflowProgressData,
) {
  const part = createWorkflowProgressPart(data);
  patchMessages((msgs) => {
    const next = [...msgs];
    let idx = -1;
    if (messageId) {
      idx = next.findIndex((m) => m.id === messageId && m.role === "assistant");
    }
    if (idx < 0) {
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "assistant") {
          idx = i;
          break;
        }
      }
    }
    if (idx < 0) return msgs;
    const parts = [...next[idx].parts];
    const pi = parts.findIndex((p) => isWorkflowProgressPart(p));
    if (pi >= 0) {
      parts[pi] = part as unknown as (typeof parts)[number];
    } else {
      // 进度树放在文本前，便于先看到节点再看 interrupt 等附加文案
      const textIdx = parts.findIndex((p) => p.type === "text");
      if (textIdx >= 0) {
        parts.splice(textIdx, 0, part as unknown as (typeof parts)[number]);
      } else {
        parts.push(part as unknown as (typeof parts)[number]);
      }
    }
    next[idx] = { ...next[idx], parts };
    return next;
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
    <aside className="flex w-[52px] shrink-0 flex-col border-r border-nexus-border bg-nexus-bg-base/40">
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto py-1.5">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              title={tab.title}
              className={cn(
                "relative mx-0.5 flex flex-col items-center gap-0.5 rounded-md px-0.5 py-1.5 text-center transition-colors",
                active
                  ? "bg-sky-500/15 text-sky-200 ring-1 ring-sky-400/30"
                  : "text-nexus-text-muted hover:bg-white/[0.05] hover:text-nexus-text-primary",
              )}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="line-clamp-1 w-full text-[8px] leading-tight">{tab.title}</span>
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
            "mx-auto flex h-8 w-8 items-center justify-center rounded-md",
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
  quickPrompts,
  mode,
  onQuickPromptSelect,
}: {
  title: string;
  interruptPrompt: LangGraphInterruptUiPayload | null;
  quickPrompts: readonly string[];
  mode: AssistantApiMode;
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
                <p className="mt-0.5 text-[10px] text-nexus-text-muted">
                  {mode === "knowledge-base" ? "知识库问答 · 地图控制" : "智能对话 · 指令调度"}
                </p>
              </div>
              <p className="text-[11px] leading-[1.65] text-nexus-text-secondary">
                {mode === "knowledge-base"
                  ? "对接任务管理知识库流：支持问答、地图控制，以及选机/中断确认。"
                  : "可根据自然语言理解意图，下发航迹查询、无人机协同等指令。简单查询在本 Tab 回答；任务工作流会自动新建「会话N」Tab 并展示查证进度。"}
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
            {quickPrompts.map((label, index) => (
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
  const setTabBusinessWorkflowThreadId = useAssistantChatTabsStore((s) => s.setTabBusinessWorkflowThreadId);
  const setTabWorkflowName = useAssistantChatTabsStore((s) => s.setTabWorkflowName);
  const applyWorkflowTopicToTab = useAssistantChatTabsStore((s) => s.applyWorkflowTopicToTab);
  const upsertWorkflowDevicesForTab = useAssistantChatTabsStore((s) => s.upsertWorkflowDevicesForTab);
  const registerTaskIdsForTab = useAssistantChatTabsStore((s) => s.registerTaskIdsForTab);
  const registerVerifyEntityIdsForTab = useAssistantChatTabsStore((s) => s.registerVerifyEntityIdsForTab);
  const setActiveWorkflowVerifyTabId = useAssistantChatTabsStore((s) => s.setActiveWorkflowVerifyTabId);
  const finishWorkflowVerifyRouting = useAssistantChatTabsStore((s) => s.finishWorkflowVerifyRouting);
  const patchTabMessages = useAssistantChatTabsStore((s) => s.patchTabMessages);

  const [messages] = useAssistantChatTabMessages(activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const chatLikeActive = isAssistantChatLikeTab(activeTab);

  const [isStreaming, setIsStreaming] = useState(false);
  /** 中断反馈 POST 进行中（与主 SSE isStreaming 分离，避免确认按钮被锁死） */
  const [interruptSubmitting, setInterruptSubmitting] = useState(false);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  /** 主对话 SSE 的 AbortController（interrupt 后仍保持读流，与 Qt 一致） */
  const abortRef = useRef<AbortController | null>(null);
  /** interrupt_feedback 请求的 AbortController（勿覆盖 abortRef） */
  const resumeAbortRef = useRef<AbortController | null>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const leadingToolbarRef = useRef<HTMLDivElement | null>(null);
  const vlmInjectSeq = useVlmChatInjectStore((s) => s.injectSeq);
  const [interruptPrompt, setInterruptPrompt] = useState<LangGraphInterruptUiPayload | null>(null);
  /** 与 interruptPrompt 同步，供 SSE finally 等异步路径判断（避免批处理把确认区冲掉） */
  const interruptPromptRef = useRef<LangGraphInterruptUiPayload | null>(null);
  const [workflowActionBusy, setWorkflowActionBusy] = useState<"terminate" | "stop-capture" | null>(null);
  const [apiMode, setApiMode] = useState<AssistantApiMode>("assistant");
  const apiModeRef = useRef<AssistantApiMode>("assistant");
  const [kbPendingInterrupt, setKbPendingInterrupt] = useState<KnowledgeBasePendingInterrupt | null>(null);
  const [kbInterruptSubmitting, setKbInterruptSubmitting] = useState(false);
  const [kbInterruptResultUnknown, setKbInterruptResultUnknown] = useState(false);
  const kbPendingInterruptRef = useRef<KnowledgeBasePendingInterrupt | null>(null);

  const streamTabIdRef = useRef(activeTabId);
  const sourceTabIdForStreamRef = useRef(activeTabId);
  const responseModeRef = useRef<StreamResponseMode>("pending");
  /** 本轮 SSE 是否已为本工作流新建「会话N」（每次发消息重置，禁止复用旧 workflow Tab） */
  const workflowStreamPromotedRef = useRef(false);
  const pendingPairRef = useRef<{ userId: string; asstId: string } | null>(null);
  /** 本轮 LangGraph 流式回复绑定的助手消息 id（中断恢复后仍写回同一条） */
  const streamAssistantMsgIdRef = useRef<string | null>(null);
  /** db_qa 按 answer_id 的流式状态（仅知识库数据库问答路由） */
  const dbQaStatesRef = useRef<Map<string, DbQaStreamState>>(new Map());

  const quickPrompts = ASSISTANT_QUICK_PROMPTS;

  const assignInterruptPrompt = useCallback((p: LangGraphInterruptUiPayload | null) => {
    interruptPromptRef.current = p;
    setInterruptPrompt(p);
  }, []);

  const assignKbPendingInterrupt = useCallback((p: KnowledgeBasePendingInterrupt | null) => {
    kbPendingInterruptRef.current = p;
    setKbPendingInterrupt(p);
  }, []);

  useEffect(() => {
    apiModeRef.current = apiMode;
  }, [apiMode]);

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
    resumeAbortRef.current?.abort();
    resumeAbortRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    setInterruptSubmitting(false);
    setKbInterruptSubmitting(false);
    assignInterruptPrompt(null);
    assignKbPendingInterrupt(null);
    setKbInterruptResultUnknown(false);
    setIsStreaming(false);
  }, [assignInterruptPrompt, assignKbPendingInterrupt]);

  const handleClearContent = useCallback(() => {
    stop();
    setQuickMenuOpen(false);
    assignInterruptPrompt(null);
    assignKbPendingInterrupt(null);
    setKbInterruptResultUnknown(false);
    clearTaskStatusVerifyChatSession(activeTabId);
    clearTabContent(activeTabId);
  }, [stop, clearTabContent, activeTabId, assignInterruptPrompt, assignKbPendingInterrupt]);

  const handleDeleteSession = useCallback(() => {
    stop();
    setQuickMenuOpen(false);
    assignInterruptPrompt(null);
    assignKbPendingInterrupt(null);
    setKbInterruptResultUnknown(false);
    clearTaskStatusVerifyChatSession(activeTabId);
    if (!deleteTab(activeTabId)) {
      toast.message("Cannot delete this tab", {
        description: "Duty Assistant and AI Assistant are fixed tabs.",
      });
    }
  }, [stop, deleteTab, activeTabId, assignInterruptPrompt, assignKbPendingInterrupt]);

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

      if (pair?.asstId) {
        streamAssistantMsgIdRef.current = pair.asstId;
      }

      const userHint =
        userMsg?.parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("") ?? "";
      if (isBirdRadarAcquisitionWorkflow({ hintText: userHint })) {
        setTabWorkflowName(newTabId, "探鸟雷达");
      }
    }
    return newTabId;
  }, [createWorkflowTab, patchTabMessages, setActiveWorkflowVerifyTabId, setTabWorkflowName]);

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

      // message_chunk.extracted_topic → 替换「会话N」标题
      const extractedTopic = extractWorkflowTopicFromMessageChunk(parsed);
      if (extractedTopic) {
        tabId = ensureWorkflowTabForStream();
        applyWorkflowTopicToTab(tabId, extractedTopic);
      }

      const notifyThreadId = extractChatNotificationThreadId(parsed);
      if (notifyThreadId && !isDailyVerificationParentTaskId(notifyThreadId)) {
        tabId = ensureWorkflowTabForStream();
        registerWorkflowVerifyThreadId(notifyThreadId, tabId);
        setTabBusinessWorkflowThreadId(tabId, notifyThreadId);
        registerTaskIdsForTab(tabId, [notifyThreadId]);
      }

      // chat_notification 相机/无人机设备卡片
      const deviceCards = extractWorkflowDevicesFromChatNotification(parsed);
      if (deviceCards.length > 0) {
        tabId = ensureWorkflowTabForStream();
        upsertWorkflowDevicesForTab(tabId, deviceCards);
        registerVerifyEntityIdsForTab(
          tabId,
          deviceCards.map((d) => d.id),
        );
      }

      const wfName = extractLangGraphWorkflowName(parsed);
      if (wfName) {
        if (isBirdRadarAcquisitionWorkflow({ workflowName: wfName, businessWorkflowThreadId: notifyThreadId })) {
          setTabWorkflowName(tabId, wfName.includes("探鸟雷达") ? wfName : "探鸟雷达");
        } else {
          setTabWorkflowName(tabId, wfName);
        }
      }

      const alertArea = extractChatNotificationAlertArea(parsed);
      if (alertArea) {
        useDbAreaStore.getState().triggerAreaFlashByName(alertArea);
      }

      const tid = parsed.thread_id;
      if (typeof tid === "string" && tid.trim()) {
        setTabLangGraphThreadId(tabId, tid.trim());
        if (apiModeRef.current === "knowledge-base") {
          useAssistantPanelSessionStore.getState().setThreadId(tid.trim());
        }
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
      const appendStream = (chunk: string) => {
        appendToStreamAssistantText(patchForStream, streamAssistantMsgIdRef.current, chunk);
      };

      const ev = String(parsed.event ?? "");

      // 知识库 / 统一对话：map_command 由当前浏览器执行
      const mapCmd = parseTaskManagerMapCommandFromSse(parsed);
      if (mapCmd) {
        const result = executeTaskManagerMapCommand(mapCmd);
        const feedback = formatMapCommandFeedback(mapCmd, result);
        if (mapCmd.expects_result && result.message) {
          appendStream(`\n\n${feedback}`);
        } else if (!mapCmd.expects_result && !result.ok) {
          appendStream(`\n\n${feedback}`);
        }
        return;
      }

      // chat_answer：db_qa 按事件类型分流；其它路由仍追加终态正文
      if (ev === "chat_answer") {
        const data =
          parsed.data && typeof parsed.data === "object"
            ? (parsed.data as Record<string, unknown>)
            : parsed;

        if (isDbQaRoutedChatAnswer(data)) {
          const answerId = pickDbQaAnswerId(data);
          let state = dbQaStatesRef.current.get(answerId);
          if (!state) {
            state = createDbQaStreamState();
            dbQaStatesRef.current.set(answerId, state);
          }
          const action = handleDbQaChatAnswerEvent(state, data);
          if (action.kind === "set_content") {
            let content = action.content;
            if (action.status === "completed" || action.status === "failed") {
              const status =
                typeof data.status === "string" ? data.status.trim() : action.status;
              const payload =
                data.payload && typeof data.payload === "object" && !Array.isArray(data.payload)
                  ? (data.payload as Record<string, unknown>)
                  : undefined;
              const suffix = formatKnowledgeBaseChatAnswerSuffix({
                type: "chat_answer",
                text: content,
                status,
                payload: payload as
                  | {
                      dispatched?: boolean;
                      cancelled?: boolean;
                      partial_success?: boolean;
                    }
                  | undefined,
                raw: parsed,
              });
              if (suffix) content = [content, suffix].filter(Boolean).join("\n\n");
              assignInterruptPrompt(null);
              assignKbPendingInterrupt(null);
              setKbInterruptResultUnknown(false);
            }
            setAssistantTextById(patchForStream, streamAssistantMsgIdRef.current, content);
          }
          return;
        }

        const text =
          (typeof data.content === "string" && data.content.trim()) ||
          (typeof data.text === "string" && data.text.trim()) ||
          (typeof data.answer === "string" && data.answer.trim()) ||
          "";
        const status = typeof data.status === "string" ? data.status.trim() : undefined;
        const payload =
          data.payload && typeof data.payload === "object" && !Array.isArray(data.payload)
            ? (data.payload as Record<string, unknown>)
            : undefined;
        const suffix = formatKnowledgeBaseChatAnswerSuffix({
          type: "chat_answer",
          text,
          status,
          payload: payload as
            | {
                dispatched?: boolean;
                cancelled?: boolean;
                partial_success?: boolean;
              }
            | undefined,
          raw: parsed,
        });
        const display = [text, suffix].filter(Boolean).join("\n\n");
        if (display) appendStream(`\n\n${display}`);
        assignInterruptPrompt(null);
        assignKbPendingInterrupt(null);
        setKbInterruptResultUnknown(false);
        return;
      }

      // 知识库模式：通用 nodes/options 中断面板；智能助手仍用 Qt 风格确认区
      if (ev === "interrupt") {
        const kbIntr = parseKnowledgeBaseInterrupt(parsed);
        if (apiModeRef.current === "knowledge-base" && kbIntr) {
          assignKbPendingInterrupt(kbIntr);
          setKbInterruptResultUnknown(false);
          assignInterruptPrompt(null);
          useAssistantPanelSessionStore.getState().setThreadId(kbIntr.threadId);
          const wfOnInterrupt = useAssistantChatTabsStore.getState().getTabById(tabId);
          if (wfOnInterrupt?.kind === "workflow") {
            setActiveWorkflowVerifyTabId(tabId);
          }
          const preview = kbIntr.nodes.map((n) => n.message).filter(Boolean).join("\n");
          appendStream(
            preview
              ? `\n\n—— 需要确认 ——\n${preview}\n`
              : "\n\n—— 任务流已暂停，请在下方确认后继续 ——\n",
          );
          return;
        }
        const intr = parseLangGraphInterruptEvent(parsed);
        if (intr) {
          assignInterruptPrompt(intr);
          assignKbPendingInterrupt(null);
          const wfOnInterrupt = useAssistantChatTabsStore.getState().getTabById(tabId);
          if (wfOnInterrupt?.kind === "workflow") {
            setActiveWorkflowVerifyTabId(tabId);
          }
          if (intr.verifyEntityIds.length > 0) {
            registerVerifyEntityIdsForTab(tabId, intr.verifyEntityIds);
          }
          if (intr.threadId && /tanniao_radar|_workflow_/i.test(intr.threadId)) {
            setTabBusinessWorkflowThreadId(tabId, intr.threadId);
          }
          appendStream("\n\n—— 任务流已暂停，请在下方确认后继续 ——\n");
          return;
        }
      }

      if (ev === "tool_call" && parsed.data != null && typeof parsed.data === "object") {
        const reply = await executeLangGraphToolCallFromData(parsed.data as Record<string, unknown>);
        if (reply) appendStream(reply);
        return;
      }

      // workflow_update / chat_notification → 中文主节点进度树（不用英文 node 名作标题）
      const progressMeta = extractWorkflowProgressMeta(parsed);
      if (progressMeta) {
        const msgId = streamAssistantMsgIdRef.current;
        let prevData: WorkflowProgressData | null = null;
        const tab = useAssistantChatTabsStore.getState().getTabById(tabId);
        const asst = msgId
          ? tab?.messages.find((m) => m.id === msgId)
          : [...(tab?.messages ?? [])].reverse().find((m) => m.role === "assistant");
        const existing = asst?.parts.find((p) => isWorkflowProgressPart(p));
        if (existing && isWorkflowProgressPart(existing)) {
          prevData = existing.data;
        }
        const nextData = applyWorkflowUpdateToProgress(prevData, parsed);
        if (nextData) {
          upsertWorkflowProgressOnAssistant(patchForStream, msgId, nextData);
        }
        return;
      }

      // 英文-only workflow_update / 已入库的 chat_notification 不再拼纯文本，避免英文 node 名刷屏
      if (ev === "workflow_update" || ev === "chat_notification") {
        return;
      }
      const chunks = extractLangGraphDisplayChunks(parsed);
      const useNewline = shouldPrefixedNewlineForLangGraphEvent(ev);
      for (const c of chunks) {
        appendStream(useNewline ? `\n\n${c}` : c);
      }
    },
    [
      ensureWorkflowTabForStream,
      patchTabMessages,
      registerTaskIdsForTab,
      registerVerifyEntityIdsForTab,
      revertMistakenWorkflowTab,
      setActiveWorkflowVerifyTabId,
      assignInterruptPrompt,
      assignKbPendingInterrupt,
      setTabBusinessWorkflowThreadId,
      setTabLangGraphThreadId,
      setTabWorkflowName,
      applyWorkflowTopicToTab,
      upsertWorkflowDevicesForTab,
    ],
  );

  const resumeLangGraphInterrupt = useCallback(
    async (p: LangGraphInterruptUiPayload, feedbackValue: string) => {
      // 与 Qt 一致：原对话 SSE 继续读；另起 interrupt_feedback POST，勿 abort 原连接、勿覆盖 abortRef
      const ac = new AbortController();
      resumeAbortRef.current = ac;
      assignInterruptPrompt(null);
      setInterruptSubmitting(true);
      const tabId = streamTabIdRef.current;
      const resumeTab = useAssistantChatTabsStore.getState().getTabById(tabId);
      if (resumeTab?.kind === "workflow") {
        setActiveWorkflowVerifyTabId(tabId);
      }
      const resumeThreadId = (p.threadId || resumeTab?.langGraphThreadId || "").trim();
      if (!resumeThreadId) {
        toast.error("无法恢复任务流", { description: "缺少 thread_id，请重新发起工作流" });
        setInterruptSubmitting(false);
        resumeAbortRef.current = null;
        return;
      }
      const patchForStream = (updater: (prev: UIMessage[]) => UIMessage[]) => {
        patchTabMessages(tabId, updater);
      };
      appendToStreamAssistantText(
        patchForStream,
        streamAssistantMsgIdRef.current,
        feedbackValue === "[CANCEL]" ? "\n\n—— 已取消任务 ——\n" : "\n\n—— 已继续执行 ——\n",
      );
      const body: Record<string, unknown> = {
        interrupt_feedback: { [p.interruptId]: feedbackValue },
        interrupt_id: p.mainInterruptId,
        thread_id: resumeThreadId,
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
      // 等响应头超时提示（fetch 在收到 headers 前会一直挂起）
      const headerWaitTimer = window.setTimeout(() => {
        console.warn(
          `[智能助手 HTTP] #${seq} 中断恢复仍在等待 HTTP 响应头…`,
          { elapsedMs: Math.round(performance.now() - reqStarted), threadId: resumeThreadId },
        );
        toast.message("正在等待任务管理响应", {
          description: "若长时间无反应，请检查 Network 中 langgraph-chat 是否一直 pending",
        });
      }, 8_000);
      try {
        const res = await fetch(chatUrl, {
          method: "POST",
          headers: chatHeaders,
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        window.clearTimeout(headerWaitTimer);

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

        // 与 Qt 一致：feedback 流读完之前不要 abort 原 SSE。
        // 过早 abort 会让任务管理/代理把 feedback 流一并掐断 → ERR_INCOMPLETE_CHUNKED_ENCODING。
        const reader = res.body?.getReader();
        if (!reader) throw new Error("无响应体");
        setIsStreaming(true);
        const streamStarted = performance.now();
        let streamResult;
        try {
          streamResult = await consumeLangGraphSseStream(reader, processLangGraphParsedLine, {
            kind: "interrupt_resume",
            logSeq: seq,
            signal: ac.signal,
            idleTimeoutMs: 0,
          });
        } catch (streamErr) {
          // 网络半截断开时，若已收到过事件则视为流结束而非硬失败
          const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
          if (/SSE read failed|network|fetch|chunked/i.test(msg)) {
            console.warn(`[智能助手 HTTP] #${seq} 中断恢复流异常结束（已尽量吞掉）`, msg);
            streamResult = {
              reason: "http_done" as const,
              eventCount: 0,
            };
          } else {
            throw streamErr;
          }
        }
        logLangGraphChatStreamEnd({
          kind: "interrupt_resume",
          seq,
          reason: streamResult.reason,
          eventCount: streamResult.eventCount,
          durationMs: Math.round(performance.now() - streamStarted),
        });
        if (streamResult.reason === "cancelled") {
          appendToStreamAssistantText(
            patchForStream,
            streamAssistantMsgIdRef.current,
            "\n\n[已停止]\n",
          );
        }
        // feedback 结束后再关原连接（此时 interrupt 状态已由任务管理消费）
        abortRef.current?.abort();
        if (abortRef.current) abortRef.current = null;
        if (!interruptPromptRef.current) {
          streamAssistantMsgIdRef.current = null;
        }
      } catch (e) {
        window.clearTimeout(headerWaitTimer);
        const patchForErr = (updater: (prev: UIMessage[]) => UIMessage[]) => {
          patchTabMessages(tabId, updater);
        };
        if ((e as Error).name === "AbortError") {
          appendToStreamAssistantText(patchForErr, streamAssistantMsgIdRef.current, "\n\n[已停止]\n");
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          // Chrome 对半截 SSE 常报 TypeError / Failed to fetch
          const soft =
            /INCOMPLETE_CHUNKED|Failed to fetch|network error|Load failed/i.test(msg) ||
            (e instanceof TypeError && /fetch|network|load/i.test(msg));
          if (soft) {
            console.warn(`[智能助手 HTTP] #${seq} 中断恢复网络中断`, e);
            appendToStreamAssistantText(
              patchForErr,
              streamAssistantMsgIdRef.current,
              "\n\n—— 反馈已发送，连接中断；请查看任务是否已继续/取消 ——\n",
            );
          } else {
            toast.error("中断反馈请求失败", { description: msg });
            appendToStreamAssistantText(patchForErr, streamAssistantMsgIdRef.current, `\n\n❌ ${msg}`);
          }
        }
      } finally {
        if (resumeAbortRef.current === ac) {
          resumeAbortRef.current = null;
        }
        setInterruptSubmitting(false);
        setIsStreaming(false);
        finishStreamWorkflowVerifyRouting();
      }
    },
    [
      assignInterruptPrompt,
      finishStreamWorkflowVerifyRouting,
      patchTabMessages,
      processLangGraphParsedLine,
      setActiveWorkflowVerifyTabId,
    ],
  );

  const runLangGraphStream = useCallback(
    async (userText: string, sourceTabId: string) => {
      const ac = new AbortController();
      abortRef.current = ac;
      setIsStreaming(true);

      const userId = generateId();
      const asstId = generateId();
      pendingPairRef.current = { userId, asstId };
      streamAssistantMsgIdRef.current = asstId;
      responseModeRef.current = "pending";
      workflowStreamPromotedRef.current = false;
      sourceTabIdForStreamRef.current = sourceTabId;
      dbQaStatesRef.current = new Map();
      assignKbPendingInterrupt(null);
      setKbInterruptResultUnknown(false);

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

      const body =
        apiModeRef.current === "knowledge-base"
          ? buildKnowledgeBaseChatRequestBody(userText)
          : ({
              messages: [{ role: "user", content: userText }],
              user_context: {} as Record<string, unknown>,
            } as Record<string, unknown>);

      const chatUrl =
        apiModeRef.current === "knowledge-base" ? "/api/knowledge-base-chat" : "/api/langgraph-chat";
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
          idleTimeoutMs: 0,
        });
        logLangGraphChatStreamEnd({
          kind: "chat",
          seq,
          reason: streamResult.reason,
          eventCount: streamResult.eventCount,
          durationMs: Math.round(performance.now() - streamStarted),
        });
        if (streamResult.reason !== "cancelled") {
          const tabId = streamTabIdRef.current;
          const patchForStream = (updater: (prev: UIMessage[]) => UIMessage[]) => {
            patchTabMessages(tabId, updater);
          };
          for (const state of dbQaStatesRef.current.values()) {
            const action = finalizeDbQaStreamIfNeeded(state);
            if (action.kind === "set_content") {
              setAssistantTextById(
                patchForStream,
                streamAssistantMsgIdRef.current,
                action.content,
              );
            }
          }
        }
        if (streamResult.reason === "idle_timeout") {
          const tabId = streamTabIdRef.current;
          const patchForStream = (updater: (prev: UIMessage[]) => UIMessage[]) => {
            patchTabMessages(tabId, updater);
          };
          appendToStreamAssistantText(
            patchForStream,
            streamAssistantMsgIdRef.current,
            "\n\n—— 助手连接已空闲断开，任务流可能仍在后台执行 ——\n",
          );
        }
        // 有未处理 interrupt 时保留确认区与助手气泡 id（流结束帧常与 interrupt 同批到达，
        // 若此处清空会被 React 批处理成「确认区从未出现」）
        // resume 进行中也保留气泡 id，由 feedback 流继续写
        if (
          !interruptPromptRef.current &&
          !kbPendingInterruptRef.current &&
          !resumeAbortRef.current
        ) {
          streamAssistantMsgIdRef.current = null;
        }
      } catch (e) {
        const tabId = streamTabIdRef.current;
        const patchForStream = (updater: (prev: UIMessage[]) => UIMessage[]) => {
          patchTabMessages(tabId, updater);
        };
        if ((e as Error).name === "AbortError") {
          // 恢复请求主动 abort 原连接时不写「已停止」
          if (!resumeAbortRef.current) {
            appendToStreamAssistantText(patchForStream, streamAssistantMsgIdRef.current, "\n\n[已停止]");
            assignInterruptPrompt(null);
            assignKbPendingInterrupt(null);
            streamAssistantMsgIdRef.current = null;
          }
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          toast.error("助手服务请求失败", { description: msg });
          appendToStreamAssistantText(patchForStream, streamAssistantMsgIdRef.current, `\n\n❌ ${msg}`);
          if (
            !interruptPromptRef.current &&
            !kbPendingInterruptRef.current &&
            !resumeAbortRef.current
          ) {
            streamAssistantMsgIdRef.current = null;
          }
        }
      } finally {
        if (abortRef.current === ac) {
          abortRef.current = null;
        }
        pendingPairRef.current = null;
        // interrupt_feedback 进行中时由 resume 负责 isStreaming / 查证收尾
        if (!resumeAbortRef.current) {
          setIsStreaming(false);
          finishStreamWorkflowVerifyRouting();
        }
      }
    },
    [
      assignInterruptPrompt,
      assignKbPendingInterrupt,
      finishStreamWorkflowVerifyRouting,
      patchTabMessages,
      processLangGraphParsedLine,
      setActiveTabId,
    ],
  );

  const resumeKnowledgeBaseInterrupt = useCallback(
    async (selectedValues: Record<string, string>) => {
      if (!kbPendingInterrupt || kbInterruptSubmitting || kbInterruptResultUnknown) return;

      let body: Record<string, unknown>;
      try {
        body = buildKnowledgeBaseResumeRequestBody(kbPendingInterrupt, selectedValues);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("无法提交确认", { description: msg });
        return;
      }

      const prev = kbPendingInterrupt;
      assignKbPendingInterrupt(null);
      setKbInterruptSubmitting(true);

      const ac = new AbortController();
      resumeAbortRef.current = ac;
      const tabId = streamTabIdRef.current || activeTabId;
      const resumeTab = useAssistantChatTabsStore.getState().getTabById(tabId);
      if (resumeTab?.kind === "workflow") {
        setActiveWorkflowVerifyTabId(tabId);
      }

      const patchForStream = (updater: (prev: UIMessage[]) => UIMessage[]) => {
        patchTabMessages(tabId, updater);
      };
      const choiceSummary = prev.nodes
        .map((n) => {
          const v = selectedValues[n.interrupt_id];
          const label = n.options.find((o) => o.value === v)?.label ?? v;
          return `${n.node_name}：${label}`;
        })
        .join("；");
      appendToStreamAssistantText(
        patchForStream,
        streamAssistantMsgIdRef.current,
        `\n\n—— 已提交：${choiceSummary} ——\n`,
      );

      const chatUrl = "/api/knowledge-base-chat";
      const chatHeaders = { "Content-Type": "application/json", Accept: "text/event-stream" };
      const reqStarted = performance.now();
      const seq = logLangGraphChatRequest({
        kind: "interrupt_resume",
        url: chatUrl,
        method: "POST",
        headers: chatHeaders,
        body,
        userTextPreview: `[kb-interrupt] ${prev.interruptId}`,
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
        setIsStreaming(true);
        const streamStarted = performance.now();
        const streamResult = await consumeLangGraphSseStream(reader, processLangGraphParsedLine, {
          kind: "interrupt_resume",
          logSeq: seq,
          signal: ac.signal,
          idleTimeoutMs: 0,
        });
        logLangGraphChatStreamEnd({
          kind: "interrupt_resume",
          seq,
          reason: streamResult.reason,
          eventCount: streamResult.eventCount,
          durationMs: Math.round(performance.now() - streamStarted),
        });
        abortRef.current?.abort();
        if (abortRef.current) abortRef.current = null;
        if (!interruptPromptRef.current && !kbPendingInterruptRef.current) {
          streamAssistantMsgIdRef.current = null;
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          appendToStreamAssistantText(patchForStream, streamAssistantMsgIdRef.current, "\n\n[已停止]\n");
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          const soft =
            /INCOMPLETE_CHUNKED|Failed to fetch|network error|Load failed/i.test(msg) ||
            (e instanceof TypeError && /fetch|network|load/i.test(msg));
          if (soft) {
            assignKbPendingInterrupt(prev);
            setKbInterruptResultUnknown(true);
            appendToStreamAssistantText(
              patchForStream,
              streamAssistantMsgIdRef.current,
              `\n\n⚠ ${msg}（结果状态不确定，未自动重试）`,
            );
            toast.error("确认结果不确定", {
              description: "请勿重复提交；请核对设备/任务状态后再决定是否重新发起指令。",
            });
          } else {
            assignKbPendingInterrupt(prev);
            setKbInterruptResultUnknown(true);
            toast.error("中断反馈请求失败", { description: msg });
            appendToStreamAssistantText(
              patchForStream,
              streamAssistantMsgIdRef.current,
              `\n\n⚠ ${msg}（结果状态不确定，未自动重试）`,
            );
          }
        }
      } finally {
        if (resumeAbortRef.current === ac) resumeAbortRef.current = null;
        setKbInterruptSubmitting(false);
        setIsStreaming(false);
        finishStreamWorkflowVerifyRouting();
      }
    },
    [
      activeTabId,
      assignKbPendingInterrupt,
      finishStreamWorkflowVerifyRouting,
      kbInterruptResultUnknown,
      kbInterruptSubmitting,
      kbPendingInterrupt,
      patchTabMessages,
      processLangGraphParsedLine,
      setActiveWorkflowVerifyTabId,
    ],
  );

  const handleQuickPromptSelect = useCallback(
    (label: string) => {
      if (interruptPrompt) {
        toast.message("请先处理任务确认", {
          description: "继续执行、取消任务或收起确认区后再选择快捷问题",
        });
        return;
      }
      if (kbPendingInterrupt && !kbInterruptResultUnknown) {
        toast.message("请先处理知识库确认面板");
        return;
      }
      setQuickMenuOpen(false);
      chatInputRef.current?.setDraft(label);
    },
    [interruptPrompt, kbInterruptResultUnknown, kbPendingInterrupt],
  );

  const handleCreateSession = useCallback(() => {
    if (isStreaming) {
      toast.message("请等待当前回复结束", { description: "流式响应完成后再新建会话" });
      return;
    }
    if (interruptPrompt) {
      toast.message("请先处理任务确认", { description: "收起确认区后再新建会话" });
      return;
    }
    if (kbPendingInterrupt && !kbInterruptResultUnknown) {
      toast.message("请先处理知识库确认面板", { description: "提交或收起后再新建会话" });
      return;
    }
    createUserChatTab();
    setQuickMenuOpen(false);
    chatInputRef.current?.setDraft("");
  }, [createUserChatTab, interruptPrompt, isStreaming, kbInterruptResultUnknown, kbPendingInterrupt]);

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
        logLangGraphChatSendBlocked("存在未处理的任务中断确认", {
          threadId: interruptPrompt.threadId,
          interruptId: interruptPrompt.interruptId,
        });
        toast.message("请先处理任务确认", { description: "继续执行、取消任务或收起确认区后再发送" });
        return;
      }
      if (kbPendingInterrupt && !kbInterruptResultUnknown) {
        toast.message("请先处理知识库确认面板", { description: "提交或收起后再发送" });
        return;
      }
      void runLangGraphStream(t, activeTabId);
    },
    [
      activeTabId,
      interruptPrompt,
      isStreaming,
      kbInterruptResultUnknown,
      kbPendingInterrupt,
      runLangGraphStream,
    ],
  );

  const handleTerminateWorkflow = useCallback(async () => {
    if (activeTab?.kind !== "workflow") return;
    const tid = resolveBusinessWorkflowThreadId(activeTab);
    if (!tid) {
      toast.message("尚无业务工作流 ID", {
        description: "等待任务管理 SSE 的 chat_notification 后再试",
      });
      return;
    }
    if (workflowActionBusy) return;
    setWorkflowActionBusy("terminate");
    try {
      const ret = await postWorkflowTerminate(tid);
      if (!ret.ok) {
        toast.error("停止工作流失败", { description: ret.detail || ret.error });
        return;
      }
      stop();
      toast.success("已请求停止工作流", { description: tid });
      appendToStreamAssistantText(
        (updater) => patchTabMessages(activeTabId, updater),
        streamAssistantMsgIdRef.current,
        "\n\n—— 已请求停止工作流（终止后将跳过上传）——\n",
      );
    } finally {
      setWorkflowActionBusy(null);
    }
  }, [activeTab, activeTabId, patchTabMessages, stop, workflowActionBusy]);

  const handleStopCapture = useCallback(async () => {
    if (activeTab?.kind !== "workflow") return;
    if (!tabLooksLikeBirdRadarWorkflow(activeTab)) return;
    const tid = resolveBusinessWorkflowThreadId(activeTab);
    if (!tid) {
      toast.message("尚无业务工作流 ID", {
        description: "等待任务管理 SSE 的 chat_notification 后再试",
      });
      return;
    }
    if (workflowActionBusy) return;
    setWorkflowActionBusy("stop-capture");
    try {
      const ret = await postWorkflowStopCapture(tid);
      if (!ret.ok) {
        toast.error("停止采集失败", { description: ret.detail || ret.error });
        return;
      }
      toast.success("已请求停止采集", {
        description: ret.message || "等待轮询周期结束后仍会提示是否上传",
      });
      appendToStreamAssistantText(
        (updater) => patchTabMessages(activeTabId, updater),
        streamAssistantMsgIdRef.current,
        "\n\n—— 已请求停止采集，结束后仍可选择是否上传 ——\n",
      );
    } finally {
      setWorkflowActionBusy(null);
    }
  }, [activeTab, activeTabId, patchTabMessages, workflowActionBusy]);

  const showChatLikeEmpty = chatLikeActive && messages.length === 0;
  const showDutyEmpty = activeTabId === DUTY_CHAT_TAB_ID && messages.length === 0;
  const emptyStateTitle = activeTab?.title ?? "AI助手";

  const canDeleteActiveTab =
    activeTab?.kind === "user" || activeTab?.kind === "workflow";
  const canUseQuickPrompts =
    chatLikeActive || activeTab?.kind === "workflow" || activeTab?.kind === "duty";
  const assistantLabel = activeTab?.title ?? "AI助手";
  const showWorkflowControls = activeTab?.kind === "workflow";
  const showBirdRadarStopCapture = tabLooksLikeBirdRadarWorkflow(activeTab);
  const hasBusinessWorkflowId = !!resolveBusinessWorkflowThreadId(activeTab);

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
        <NxIconButton
          size="md"
          onClick={() => {
            setApiMode((prev) => (prev === "assistant" ? "knowledge-base" : "assistant"));
            setQuickMenuOpen(false);
          }}
          title={
            apiMode === "knowledge-base"
              ? "当前：知识库（点击切回智能助手）"
              : "当前：智能助手（点击切到知识库）"
          }
          className={cn(
            apiMode === "knowledge-base" && "text-emerald-300 hover:text-emerald-200",
          )}
        >
          <BookOpen size={15} strokeWidth={apiMode === "knowledge-base" ? 2.4 : 2} />
        </NxIconButton>
        {quickMenuOpen && canUseQuickPrompts && (
          <div
            className="absolute bottom-full left-0 z-[100] mb-1 flex max-h-[min(50vh,320px)] w-[min(calc(100vw-2rem),320px)] flex-col gap-0.5 overflow-y-auto rounded-md border border-nexus-border bg-nexus-bg-elevated p-1.5 shadow-xl"
            role="menu"
          >
            {quickPrompts.map((label) => (
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
                quickPrompts={quickPrompts}
                mode={apiMode}
                onQuickPromptSelect={handleQuickPromptSelect}
              />
            ) : showDutyEmpty ? (
              <DutyAssistantEmptyState />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {activeTab?.kind === "workflow" &&
                (activeTab.workflowDevices?.length ?? 0) > 0 ? (
                  <WorkflowDeviceStrip devices={activeTab.workflowDevices} />
                ) : null}
                <ChatMessageList
                  messages={messages}
                  isStreaming={isStreaming}
                  assistantLabel={assistantLabel}
                />
              </div>
            )}
          </div>
          {showWorkflowControls ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-nexus-border/80 bg-nexus-bg-base/50 px-2.5 py-1.5">
              <button
                type="button"
                disabled={!!workflowActionBusy || !hasBusinessWorkflowId}
                onClick={() => void handleTerminateWorkflow()}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[11px] font-medium transition-colors",
                  "border-red-500/35 bg-red-500/10 text-red-300 hover:bg-red-500/20",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                )}
                title={
                  hasBusinessWorkflowId
                    ? "终止整条工作流（探鸟采集将跳过上传）"
                    : "等待业务工作流 ID（SSE chat_notification）"
                }
              >
                <Square size={11} strokeWidth={2.5} className="opacity-80" />
                {workflowActionBusy === "terminate" ? "停止中…" : "停止工作流"}
              </button>
              {showBirdRadarStopCapture ? (
                <button
                  type="button"
                  disabled={!!workflowActionBusy || !hasBusinessWorkflowId}
                  onClick={() => void handleStopCapture()}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[11px] font-medium transition-colors",
                    "border-amber-500/35 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20",
                    "disabled:cursor-not-allowed disabled:opacity-40",
                  )}
                  title={
                    hasBusinessWorkflowId
                      ? "停止采集；结束后仍会提示是否上传 CSV"
                      : "等待业务工作流 ID（SSE chat_notification）"
                  }
                >
                  {workflowActionBusy === "stop-capture" ? "停止采集中…" : "停止采集"}
                </button>
              ) : null}
            </div>
          ) : null}
          <LangGraphInterruptDialog
            open={!!interruptPrompt}
            payload={interruptPrompt}
            submitting={interruptSubmitting}
            onDismiss={() => {
              if (interruptSubmitting) return;
              // 收起确认区不终止主 SSE（任务管理仍在等反馈）；用户可用停止按钮彻底取消
              assignInterruptPrompt(null);
            }}
            onConfirm={() => {
              if (!interruptPrompt || interruptSubmitting) return;
              const tabId = streamTabIdRef.current;
              if (interruptPrompt.verifyEntityIds.length > 0) {
                registerVerifyEntityIdsForTab(tabId, interruptPrompt.verifyEntityIds);
              }
              void resumeLangGraphInterrupt(interruptPrompt, "[CONFIRM]");
            }}
            onCancelTask={() => {
              if (!interruptPrompt || interruptSubmitting) return;
              void resumeLangGraphInterrupt(interruptPrompt, "[CANCEL]");
            }}
            onSubmitDetails={(details) => {
              if (!interruptPrompt || interruptSubmitting) return;
              const tabId = streamTabIdRef.current;
              if (interruptPrompt.verifyEntityIds.length > 0) {
                registerVerifyEntityIdsForTab(tabId, interruptPrompt.verifyEntityIds);
              }
              void resumeLangGraphInterrupt(interruptPrompt, details);
            }}
          />
          <KnowledgeBaseInterruptDialog
            open={!!kbPendingInterrupt}
            pending={kbPendingInterrupt}
            submitting={kbInterruptSubmitting}
            resultUnknown={kbInterruptResultUnknown}
            onDismiss={() => {
              if (kbInterruptSubmitting) return;
              assignKbPendingInterrupt(null);
              setKbInterruptResultUnknown(false);
            }}
            onSubmit={(values) => {
              void resumeKnowledgeBaseInterrupt(values);
            }}
          />
          <ChatInput
            ref={chatInputRef}
            onSend={handleSend}
            onStop={stop}
            isLoading={isStreaming || !!interruptPrompt || kbInterruptSubmitting || (!!kbPendingInterrupt && !kbInterruptResultUnknown)}
            leadingToolbar={leadingToolbar}
            enableVoiceInput
          />
        </div>
      </div>
    </div>
  );
}
