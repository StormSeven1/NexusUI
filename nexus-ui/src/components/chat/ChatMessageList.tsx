"use client";

import { useRef, useEffect } from "react";
import { ChatMessage } from "./ChatMessage";
import { DisposalPlanFeed } from "./DisposalPlanFeed";
import type { UIMessage } from "ai";
import { Bot, Sparkles } from "lucide-react";

const HINTS = [
  "显示所有敌方目标",
  "导航到 TRK-001",
  "切换 3D 视图",
  "用饼状图展示目标类型分布",
  "查询伦敦天气",
  "标绘一个搜索区域",
  "规划从 TRK-001 到 TRK-004 的航路",
  "当前有多少个空中目标",
];

export function ChatMessageList({
  messages,
  isStreaming,
  onHintClick,
}: {
  messages: UIMessage[];
  isStreaming: boolean;
  onHintClick?: (text: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const emptyState = (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10">
        <Bot size={20} className="text-sky-400" />
      </div>
      <div>
        <p className="text-xs font-medium text-nexus-text-secondary">Nexus AI 助手</p>
        <p className="mt-1 text-[10px] leading-relaxed text-nexus-text-muted">
          输入指令与 AI 交互，支持态势查询、地图导航、目标分析等操作
        </p>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-1.5">
        {HINTS.map((hint) => (
          <button
            key={hint}
            type="button"
            onClick={() => onHintClick?.(hint)}
            className="group flex items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[10px] text-nexus-text-muted transition-all hover:border-sky-500/20 hover:bg-sky-500/5 hover:text-sky-400"
          >
            <Sparkles size={9} className="opacity-0 transition-opacity group-hover:opacity-100" />
            {hint}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto">
      {/* 会话为空时原先整页只渲染欢迎区，未挂载 DisposalPlanFeed，导致一键处置/WS 方案写入 store 后仍看不到卡片 */}
      <DisposalPlanFeed />
      {messages.length === 0
        ? emptyState
        : messages.map((msg, i) => {
            const isLastAssistant = msg.role === "assistant" && i === messages.length - 1;
            return (
              <ChatMessage
                key={msg.id}
                message={msg}
                isStreaming={isLastAssistant && isStreaming}
              />
            );
          })}
      {messages.length > 0 &&
        isStreaming &&
        messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-sky-500/15">
              <Bot size={13} className="text-sky-400" />
            </div>
            <div className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-blink rounded-full bg-sky-400" />
              <span className="h-1.5 w-1.5 animate-blink rounded-full bg-sky-400" style={{ animationDelay: "0.2s" }} />
              <span className="h-1.5 w-1.5 animate-blink rounded-full bg-sky-400" style={{ animationDelay: "0.4s" }} />
            </div>
          </div>
        )}
      <div ref={bottomRef} />
    </div>
  );
}
