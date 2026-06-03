/**
 * 右侧 AI 对话：与 Qt `GPTInterfaceWgt::sendChatToServer` 在 `m_nWorkFlowMode == 1` 时行为对齐，
 * POST `/api/langgraph-chat` → 服务端按环境变量转发对话服务，
 * 请求体 `{ messages: [{ role, content }], user_context: {} }`，SSE `data:` 行 JSON 流式拼助手回复。
 */

"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
import { clearTaskStatusVerifyChatSession } from "@/lib/task-status-verify-chat-ingest";
import {
  useAssistantPanelMessages,
  useAssistantPanelSessionStore,
} from "@/stores/assistant-panel-session-store";
import { Bot, ChevronRight, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  logLangGraphChatRequest,
  logLangGraphChatResponse,
  logLangGraphChatSendBlocked,
  logLangGraphChatStreamEnd,
} from "@/lib/langgraph-chat-http-log";

/** 闪电菜单与空状态区共用的快捷问题文案 */
const QUICK_PROMPTS: readonly string[] = [
  "出动2台相机和1架无人机帮我在港外航道监控区上航迹目标中找一艘船",
  "10海里内有多少目标",
  "使用无人机对搜索区1和搜索区2进行搜索",
  "无人机返航",
];

/** 向指定助手气泡追加正文（与 Qt `appendTextToSession` 对齐） */
function appendTextToAssistantMessageById(
  setMessages: Dispatch<SetStateAction<UIMessage[]>>,
  messageId: string,
  chunk: string,
) {
  if (!chunk) return;
  setMessages((msgs) =>
    msgs.map((msg) => {
      if (msg.id !== messageId) return msg;
      const parts = [...msg.parts];
      const ti = parts.findIndex((p) => p.type === "text");
      if (ti >= 0) {
        const tp = parts[ti] as { type: "text"; text: string };
        parts[ti] = { type: "text", text: (tp.text ?? "") + chunk };
      } else {
        parts.push({ type: "text", text: chunk });
      }
      return { ...msg, parts };
    }),
  );
}

function appendToLastAssistantText(setMessages: Dispatch<SetStateAction<UIMessage[]>>, chunk: string) {
  if (!chunk) return;
  setMessages((msgs) => {
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

export function ChatPanelLangGraph() {
  const [messages, setMessages] = useAssistantPanelMessages("chat");
  const clearSession = useAssistantPanelSessionStore((s) => s.clearSession);
  const setLangGraphThreadId = useAssistantPanelSessionStore((s) => s.setLangGraphThreadId);
  const [isStreaming, setIsStreaming] = useState(false);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const leadingToolbarRef = useRef<HTMLDivElement | null>(null);
  const vlmInjectSeq = useVlmChatInjectStore((s) => s.injectSeq);
  const [interruptPrompt, setInterruptPrompt] = useState<LangGraphInterruptUiPayload | null>(null);

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
    setMessages((msgs) => [
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
  }, [vlmInjectSeq]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const handleClear = useCallback(() => {
    stop();
    setQuickMenuOpen(false);
    setInterruptPrompt(null);
    clearTaskStatusVerifyChatSession();
    clearSession("chat");
  }, [stop, clearSession]);

  const processLangGraphParsedLine = useCallback(async (parsed: Record<string, unknown>) => {
    const tid = parsed.thread_id;
    if (typeof tid === "string" && tid.trim()) setLangGraphThreadId(tid.trim());

    const intr = parseLangGraphInterruptEvent(parsed);
    if (intr) {
      setInterruptPrompt(intr);
      appendToLastAssistantText(
        setMessages,
        "\n\n—— 任务流已暂停，请在弹窗中确认后继续 ——\n",
      );
      return;
    }

    const ev = String(parsed.event ?? "");
    if (ev === "tool_call" && parsed.data != null && typeof parsed.data === "object") {
      const reply = executeLangGraphToolCallFromData(parsed.data as Record<string, unknown>);
      if (reply) appendToLastAssistantText(setMessages, reply);
      return;
    }
    for (const c of extractLangGraphDisplayChunks(parsed)) appendToLastAssistantText(setMessages, c);
  }, []);

  /** 与 Qt `WorkflowInterruptDialog::getFeedbackJson` + 仅 POST 反馈体到同一 URL 一致 */
  const resumeLangGraphInterrupt = useCallback(
    async (p: LangGraphInterruptUiPayload, feedbackValue: string) => {
      const ac = new AbortController();
      abortRef.current = ac;
      setInterruptPrompt(null);
      setIsStreaming(true);
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
        if ((e as Error).name === "AbortError") {
          appendToLastAssistantText(setMessages, "\n\n[已停止]");
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          toast.error("中断反馈请求失败", { description: msg });
          appendToLastAssistantText(setMessages, `\n\n❌ ${msg}`);
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [processLangGraphParsedLine],
  );

  const runLangGraphStream = useCallback(async (userText: string) => {
    const ac = new AbortController();
    abortRef.current = ac;
    setIsStreaming(true);

    const userId = generateId();
    const asstId = generateId();
    setMessages((m) => [
      ...m,
      { id: userId, role: "user", parts: [{ type: "text", text: userText }] },
      { id: asstId, role: "assistant", parts: [{ type: "text", text: "" }] },
    ]);

    // 与 Qt `GPTInterfaceWgt::sendChatToServer`（m_nWorkFlowMode==1）一致：普通对话不传 thread_id，由上游每次处理；
    // thread_id 仅在中断恢复（interrupt_feedback）时使用。
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
      if ((e as Error).name === "AbortError") {
        appendToLastAssistantText(setMessages, "\n\n[已停止]");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("助手服务请求失败", { description: msg });
        appendToLastAssistantText(setMessages, `\n\n❌ ${msg}`);
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  }, [processLangGraphParsedLine]);

  const handleQuickPromptSelect = useCallback((label: string) => {
    if (interruptPrompt) {
      toast.message("请先处理任务确认弹窗", { description: "继续执行、取消任务或关闭弹窗后再选择快捷问题" });
      return;
    }
    setQuickMenuOpen(false);
    chatInputRef.current?.setDraft(label);
  }, [interruptPrompt]);

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
      void runLangGraphStream(t);
    },
    [interruptPrompt, isStreaming, runLangGraphStream],
  );

  const leadingToolbar = (
    <div ref={leadingToolbarRef} className="flex shrink-0 items-center gap-1">
      <NxIconButton size="md" onClick={handleClear} title="清空会话">
        <Trash2 size={15} strokeWidth={2} />
      </NxIconButton>
      <div className="relative flex items-center">
        <NxIconButton
          size="md"
          onClick={() => setQuickMenuOpen((o) => !o)}
          disabled={!!interruptPrompt}
          title="快捷问题"
        >
          <Zap size={15} strokeWidth={2} />
        </NxIconButton>
        {quickMenuOpen && (
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {messages.length === 0 ? (
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
                      <h3 className="text-sm font-semibold tracking-tight text-nexus-text-primary">智能助手</h3>
                      <p className="mt-0.5 text-[10px] text-nexus-text-muted">智能对话 · 指令调度</p>
                    </div>
                    <p className="text-[11px] leading-[1.65] text-nexus-text-secondary">
                      可根据自然语言理解意图，下发航迹查询、无人机协同等指令。点击
                      <span className="mx-0.5 text-nexus-text-primary">快捷问题</span>
                      会填入底部输入框，可修改后再发送；输入栏左侧的
                      <span className="mx-0.5 inline-flex items-center gap-0.5 text-amber-300/90">
                        <Zap className="inline h-3 w-3" />
                        闪电
                      </span>
                      菜单。光电研判结果仍可由研判流程注入本会话。
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
                        onClick={() => handleQuickPromptSelect(label)}
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
        ) : (
          <ChatMessageList messages={messages} isStreaming={isStreaming} />
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
          void resumeLangGraphInterrupt(interruptPrompt, "[CONFIRM]");
        }}
        onCancelTask={() => {
          if (!interruptPrompt || isStreaming) return;
          void resumeLangGraphInterrupt(interruptPrompt, "[CANCEL]");
        }}
        onSubmitDetails={(details) => {
          if (!interruptPrompt || isStreaming) return;
          void resumeLangGraphInterrupt(interruptPrompt, details);
        }}
      />
    </div>
  );
}
