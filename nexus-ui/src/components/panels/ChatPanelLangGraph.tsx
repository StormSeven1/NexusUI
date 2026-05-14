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
import { ChatInput } from "@/components/chat/ChatInput";
import { LangGraphInterruptDialog } from "@/components/chat/LangGraphInterruptDialog";
import { useVlmChatInjectStore } from "@/stores/vlm-chat-inject-store";
import {
  extractLangGraphDisplayChunks,
  forEachLangGraphSseLine,
  parseLangGraphInterruptEvent,
  type LangGraphInterruptUiPayload,
} from "@/lib/langgraph-chat-sse";
import { executeLangGraphToolCallFromData } from "@/lib/langgraph-tool-dispatch";
import {
  buildTaskStatusVerifyBannerMarkdown,
  formatTaskStatusAssistantMarkdown,
  taskStatusImageFilePart,
  taskStatusVerifySessionKey,
} from "@/lib/task-status-chat-format";
import {
  mergeVerifyJudgmentState,
  type TaskVerifyJudgmentState,
} from "@/lib/task-status-judgment-ui";
import type { TaskStatusChatPayload } from "@/lib/task-status-types";
import { subscribeTaskStatusChat } from "@/lib/task-status-chat-feed-bus";
import { useAppStore } from "@/stores/app-store";
import { toast } from "sonner";
import { Bot, ChevronRight, Trash2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

/** 上游 JSON 偶发把 taskStatus/trackID 等打成字符串，与严格 `=== 4` 分支对齐 */
function normalizeTaskStatusPayload(raw: TaskStatusChatPayload): TaskStatusChatPayload {
  const ts = Number(raw.taskStatus);
  const _rawTrackID = Number(raw.trackID);
  const trackID =
    raw.trackID != null &&
    String(raw.trackID).trim() !== "" &&
    Number.isFinite(_rawTrackID) &&
    _rawTrackID > 0  // 0 不是合法航迹 ID
      ? _rawTrackID
      : undefined;
  const cameraIndex =
    raw.cameraIndex != null &&
    String(raw.cameraIndex).trim() !== "" &&
    Number.isFinite(Number(raw.cameraIndex))
      ? Number(raw.cameraIndex)
      : undefined;
  return {
    ...raw,
    taskStatus: Number.isFinite(ts) ? ts : raw.taskStatus,
    trackID,
    cameraIndex,
    alarmId: String(raw.alarmId ?? "").trim(),
  };
}

/** 闪电菜单与空状态区共用的快捷问题文案 */
const QUICK_PROMPTS: readonly string[] = [
  "出动2台相机和1架无人机帮我在港外航道监控区上航迹目标中找一艘船",
  "10海里内有多少目标",
  "使用无人机对搜索区1和搜索区2进行搜索",
  "无人机返航",
];

/** 查证气泡：查证文案 → 图片 → 研判文案（与 Qt 顺序一致） */
function rewriteVerifyAssistantBubble(
  setMessages: Dispatch<SetStateAction<UIMessage[]>>,
  assistantId: string,
  banner: string,
  judgment: TaskVerifyJudgmentState,
  extraImage?: FileUIPart | null,
) {
  const jt = judgment.body?.trim() ?? "";
  setMessages((msgs) =>
    msgs.map((msg) => {
      if (msg.id !== assistantId) return msg;
      const existingFiles = msg.parts.filter((p) => p.type === "file") as FileUIPart[];
      const seen = new Set(existingFiles.map((f) => f.url));
      const extra: FileUIPart[] =
        extraImage && !seen.has(extraImage.url) ? [extraImage] : [];
      const parts: UIMessage["parts"] = [{ type: "text", text: banner }, ...existingFiles, ...extra];
      if (jt) parts.push({ type: "text", text: judgment.body });
      return { ...msg, parts };
    }),
  );
}

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
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const leadingToolbarRef = useRef<HTMLDivElement | null>(null);
  /** Qt `m_mapTrackSession`：`trackId_cameraIndex` → 当前轮查证助手消息 id（供 taskStatus 5/6/7 追加研判） */
  const verifySessionRef = useRef<Map<string, string>>(new Map());
  /** 由 taskStatus=4（目标信息）创建或升级为 4 的气泡 id；用于区分「仅 5 占位」与「已完成一轮 4」以支持同一目标多次查证各一条气泡 */
  const verifyFourBubbleIdsRef = useRef<Set<string>>(new Set());
  const verifyBannerRef = useRef<Map<string, string>>(new Map());
  const judgmentStateRef = useRef<Map<string, TaskVerifyJudgmentState>>(new Map());
  const vlmInjectSeq = useVlmChatInjectStore((s) => s.injectSeq);
  /** 与 Qt SSE 根字段 `thread_id` 一致：后续用户消息与 interrupt 恢复请求携带 */
  const langGraphThreadIdRef = useRef("");
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NEXT_PUBLIC_TASK_STATUS_CHAT_FEED === "false") return;

    const onPayload = (raw: TaskStatusChatPayload) => {
      try {
        const payload = normalizeTaskStatusPayload(raw);
        const sessionKey = taskStatusVerifySessionKey(
          payload.trackID ?? undefined,
          payload.cameraIndex ?? undefined,
        );

        const app = useAppStore.getState();
        app.setRightPanelTab("chat");
        if (!app.rightSidebarOpen) app.toggleRightSidebar();

        const ts = payload.taskStatus;

        // trackId + cameraIndex 定位「当前轮」：每次 taskStatus=4（目标信息）新开一条助手气泡；5/6/7 只追加到该 key 下最新一条。
        if (sessionKey && ts === 4) {
          const banner = buildTaskStatusVerifyBannerMarkdown(payload);
          const img = taskStatusImageFilePart(payload);
          const reuseId = verifySessionRef.current.get(sessionKey);
          const fromTargetInfo = reuseId ? verifyFourBubbleIdsRef.current.has(reuseId) : false;

          // 仅当占位气泡来自「先到的 5/6/7」且尚未有过 4 时，才把本条 4 合并进该气泡，避免两条碎片。
          if (reuseId && !fromTargetInfo) {
            verifyFourBubbleIdsRef.current.add(reuseId);
            verifyBannerRef.current.set(reuseId, banner);
            const jst = judgmentStateRef.current.get(reuseId) ?? { introShown: false, body: "" };
            judgmentStateRef.current.set(reuseId, jst);
            rewriteVerifyAssistantBubble(setMessages, reuseId, banner, jst, img);
            toast.message("相机查证", { description: `告警 ${payload.alarmId} · 航迹 ${payload.trackID}` });
            return;
          }

          const asstId = generateId();
          verifySessionRef.current.set(sessionKey, asstId);
          verifyFourBubbleIdsRef.current.add(asstId);
          verifyBannerRef.current.set(asstId, banner);
          judgmentStateRef.current.set(asstId, { introShown: false, body: "" });
          const parts: UIMessage["parts"] = [{ type: "text", text: banner }];
          if (img) parts.push(img);
          setMessages((m) => [...m, { id: asstId, role: "assistant", parts }]);
          toast.message("相机查证", { description: `告警 ${payload.alarmId} · 航迹 ${payload.trackID}` });
          return;
        }

        if (sessionKey && (ts === 5 || ts === 6 || ts === 7)) {
          const img = taskStatusImageFilePart(payload);
          let bubbleId = verifySessionRef.current.get(sessionKey);
          if (!bubbleId) {
            bubbleId = generateId();
            verifySessionRef.current.set(sessionKey, bubbleId);
            const fb = buildTaskStatusVerifyBannerMarkdown(payload);
            verifyBannerRef.current.set(bubbleId, fb);
            judgmentStateRef.current.set(bubbleId, { introShown: false, body: "" });
            setMessages((m) => [...m, { id: bubbleId!, role: "assistant", parts: [{ type: "text", text: fb }] }]);
            toast.message("相机查证（仅有研判）", { description: `告警 ${payload.alarmId}` });
          }

          const banner = buildTaskStatusVerifyBannerMarkdown(payload);
          verifyBannerRef.current.set(bubbleId, banner);
          const merged = mergeVerifyJudgmentState(judgmentStateRef.current.get(bubbleId), payload.description ?? "");
          judgmentStateRef.current.set(bubbleId, merged);
          rewriteVerifyAssistantBubble(setMessages, bubbleId, banner, merged, img);
          return;
        }

        // ts=5/6/7 且没有有效 sessionKey：研判结果孤包（trackID 无效如 0），直接丢弃，
        // 避免产生 "正在查证ID为0的目标" 的垃圾气泡。
        if (ts === 5 || ts === 6 || ts === 7) return;

        const text = formatTaskStatusAssistantMarkdown(payload);
        const asstId = generateId();
        const parts: UIMessage["parts"] = [{ type: "text", text }];
        const imgOther = taskStatusImageFilePart(payload);
        if (imgOther) parts.push(imgOther);
        setMessages((m) => [...m, { id: asstId, role: "assistant", parts }]);
        toast.message("相机查证更新", { description: `告警 ${payload.alarmId}` });
      } catch {
        /* ignore malformed */
      }
    };

    return subscribeTaskStatusChat(onPayload);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const handleClear = useCallback(() => {
    stop();
    setQuickMenuOpen(false);
    langGraphThreadIdRef.current = "";
    setInterruptPrompt(null);
    verifySessionRef.current.clear();
    verifyFourBubbleIdsRef.current.clear();
    verifyBannerRef.current.clear();
    judgmentStateRef.current.clear();
    setMessages([]);
  }, [stop]);

  const processLangGraphParsedLine = useCallback(async (parsed: Record<string, unknown>) => {
    const tid = parsed.thread_id;
    if (typeof tid === "string" && tid.trim()) langGraphThreadIdRef.current = tid.trim();

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
      try {
        const res = await fetch("/api/langgraph-chat", {
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
        await forEachLangGraphSseLine(reader, processLangGraphParsedLine);
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

    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: userText }],
      user_context: {} as Record<string, unknown>,
    };
    const existingThread = langGraphThreadIdRef.current.trim();
    if (existingThread) body.thread_id = existingThread;

    try {
      const res = await fetch("/api/langgraph-chat", {
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
      await forEachLangGraphSseLine(reader, processLangGraphParsedLine);
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

  const handleSend = useCallback(
    (text: string, files?: FileUIPart[]) => {
      if (files && files.length > 0) {
        toast.message("当前模式仅支持文字", { description: "暂未开放附件上传" });
      }
      const t = text.trim();
      if (!t || isStreaming) return;
      if (interruptPrompt) {
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
          disabled={isStreaming || !!interruptPrompt}
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
                onClick={() => {
                  setQuickMenuOpen(false);
                  handleSend(label);
                }}
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
                      可根据自然语言理解意图，下发航迹查询、无人机协同等指令。在底部输入并发送；或使用下方
                      <span className="mx-0.5 text-nexus-text-primary">快捷问题</span>
                      与输入栏左侧的
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
                        disabled={isStreaming || !!interruptPrompt}
                        onClick={() => handleSend(label)}
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
        onSend={handleSend}
        onStop={stop}
        isLoading={isStreaming || !!interruptPrompt}
        leadingToolbar={leadingToolbar}
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
