/**
 * 右侧知识库查询：watchsystem 数据库问答，布局与智能助手一致。
 * POST `/api/knowledge-base-chat` → 服务端代理 DB-GPT `react-agent` 流式接口。
 */

"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { generateId } from "ai";
import type { UIMessage } from "ai";
import { NxIconButton } from "@/components/nexus";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { ChatInput, type ChatInputHandle } from "@/components/chat/ChatInput";
import { forEachDbQaSseLine } from "@/lib/knowledge-base-chat-sse";
import {
  getAssistantConvUid,
  useAssistantPanelMessages,
  useAssistantPanelSessionStore,
} from "@/stores/assistant-panel-session-store";
import { toast } from "sonner";
import { BookOpen, ChevronRight, Trash2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const QUICK_PROMPTS: readonly string[] = [
  "现在有哪些告警？",
  "当前高风险告警有多少条？",
  "最近24小时新增了多少条航迹？",
  "watchsystem 库中有哪些表？",
];

function setAssistantTextById(
  setMessages: Dispatch<SetStateAction<UIMessage[]>>,
  messageId: string,
  text: string,
) {
  setMessages((msgs) =>
    msgs.map((msg) => {
      if (msg.id !== messageId) return msg;
      const parts = [...msg.parts];
      const ti = parts.findIndex((p) => p.type === "text");
      if (ti >= 0) {
        parts[ti] = { type: "text", text };
      } else {
        parts.push({ type: "text", text });
      }
      return { ...msg, parts };
    }),
  );
}

function appendAssistantTextById(
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

export function KnowledgeBasePanel() {
  const [messages, setMessages] = useAssistantPanelMessages("knowledge-base");
  const clearSession = useAssistantPanelSessionStore((s) => s.clearSession);
  const setConvUid = useAssistantPanelSessionStore((s) => s.setConvUid);
  const [isStreaming, setIsStreaming] = useState(false);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const leadingToolbarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!quickMenuOpen) return;
    const onDocDown = (e: MouseEvent) => {
      const el = leadingToolbarRef.current;
      if (el && !el.contains(e.target as Node)) setQuickMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [quickMenuOpen]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const handleClear = useCallback(() => {
    stop();
    setQuickMenuOpen(false);
    clearSession("knowledge-base");
  }, [stop, clearSession]);

  const runDbQaStream = useCallback(async (userText: string) => {
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

    const body: Record<string, unknown> = {
      question: userText,
      stream: true,
    };
    const existingConv = getAssistantConvUid();
    if (existingConv) body.conv_uid = existingConv;

    let stepBuffer = "";
    let gotFinal = false;

    try {
      const res = await fetch("/api/knowledge-base-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
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
        throw new Error(detail || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无响应体");

      await forEachDbQaSseLine(reader, async (ev) => {
        if (ev.type === "step") {
          stepBuffer += (stepBuffer ? "\n" : "") + ev.content;
          setAssistantTextById(setMessages, asstId, stepBuffer);
          return;
        }
        if (ev.type === "final") {
          gotFinal = true;
          if (ev.convUid) setConvUid(ev.convUid);
          const answer = ev.content.trim() || stepBuffer;
          setAssistantTextById(setMessages, asstId, answer || "（无回答内容）");
          stepBuffer = "";
          return;
        }
        if (ev.type === "done" && !gotFinal && stepBuffer.trim()) {
          setAssistantTextById(setMessages, asstId, stepBuffer);
        }
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        appendAssistantTextById(setMessages, asstId, "\n\n[已停止]");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("知识库查询失败", { description: msg });
        appendAssistantTextById(setMessages, asstId, `\n\n❌ ${msg}`);
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  }, []);

  const handleQuickPromptSelect = useCallback((label: string) => {
    setQuickMenuOpen(false);
    chatInputRef.current?.setDraft(label);
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || isStreaming) return;
      void runDbQaStream(t);
    },
    [isStreaming, runDbQaStream],
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
          disabled={isStreaming}
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
                  "relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-emerald-500/[0.12] via-white/[0.04] to-transparent",
                  "px-4 py-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_8px_32px_-12px_rgba(0,0,0,0.45)]",
                )}
              >
                <div
                  className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-emerald-400/10 blur-2xl"
                  aria-hidden
                />
                <div className="relative flex gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 ring-1 ring-emerald-400/25">
                    <BookOpen className="h-5 w-5 text-emerald-300" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div>
                      <h3 className="text-sm font-semibold tracking-tight text-nexus-text-primary">
                        知识库查询
                      </h3>
                      <p className="mt-0.5 text-[10px] text-nexus-text-muted">watchsystem · 自然语言查库</p>
                    </div>
                    <p className="text-[11px] leading-[1.65] text-nexus-text-secondary">
                      针对 watchsystem 数据库进行自然语言问答，自动生成并执行 SQL 后返回结论。简单问题约
                      10–15 秒，复杂问题可能 30–90 秒。点击
                      <span className="mx-0.5 text-nexus-text-primary">快捷问题</span>
                      会填入底部输入框，可修改后再发送。
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
                        disabled={isStreaming}
                        onClick={() => handleQuickPromptSelect(label)}
                        className={cn(
                          "group flex w-full items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-left",
                          "shadow-sm transition-all duration-200",
                          "hover:border-emerald-500/35 hover:bg-emerald-500/[0.07] hover:shadow-[0_0_0_1px_rgba(52,211,153,0.12)]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40",
                          "disabled:pointer-events-none disabled:opacity-45",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold tabular-nums",
                            "bg-white/[0.06] text-nexus-text-muted",
                            "group-hover:bg-emerald-500/25 group-hover:text-emerald-200",
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
        isLoading={isStreaming}
        leadingToolbar={leadingToolbar}
        enableVoiceInput={false}
      />
    </div>
  );
}
