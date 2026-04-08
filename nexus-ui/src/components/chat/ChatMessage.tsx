"use client";

import { cn } from "@/lib/utils";
import {
  Bot, User, MapPin, Target, Map, PanelRight, Search,
  CheckCircle2, XCircle, Loader2,
} from "lucide-react";
import { NxCard, NxBadge } from "@/components/nexus";
import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/* ──── 工具元数据 ──── */

const TOOL_META: Record<string, { icon: typeof MapPin; label: string; color: string }> = {
  navigate_to_location: { icon: MapPin, label: "地图导航", color: "text-sky-400" },
  select_track:         { icon: Target, label: "选中目标", color: "text-amber-400" },
  switch_map_mode:      { icon: Map, label: "切换视图", color: "text-emerald-400" },
  open_panel:           { icon: PanelRight, label: "打开面板", color: "text-purple-400" },
  query_tracks:         { icon: Search, label: "查询目标", color: "text-nexus-friendly" },
};

interface ToolPartProps {
  type: string;
  toolName?: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

function resolveToolName(part: ToolPartProps): string {
  if (part.toolName) return part.toolName;
  if (part.type.startsWith("tool-")) return part.type.slice(5);
  return "unknown";
}

/* ──── Shimmer 思考动画（参照 Vercel chatbot） ──── */

function Shimmer({ text }: { text: string }) {
  return (
    <span className="inline-block animate-pulse text-[11px] font-medium text-nexus-text-secondary">
      {text}
    </span>
  );
}

/* ──── 工具调用卡片 ──── */

function ToolCallCard({ part }: { part: ToolPartProps }) {
  const toolName = resolveToolName(part);
  const meta = TOOL_META[toolName] ?? { icon: Bot, label: toolName, color: "text-nexus-text-muted" };
  const Icon = meta.icon;

  const isStreaming = part.state === "input-streaming";
  const isWaiting = part.state === "input-available";
  const isDone = part.state === "output-available";
  const isError = part.state === "output-error";

  const output = part.output as Record<string, string | undefined> | undefined;

  return (
    <NxCard padding="sm" className="my-1.5 transition-all duration-200">
      <div className="flex items-center gap-2">
        <div className={cn("flex h-5 w-5 items-center justify-center rounded", meta.color, "bg-current/10")}>
          <Icon size={11} className={meta.color} />
        </div>
        <span className="text-[10px] font-semibold tracking-wider text-nexus-text-secondary uppercase">
          {meta.label}
        </span>
        <span className="ml-auto">
          {(isStreaming || isWaiting) && <Loader2 size={11} className="animate-spin text-nexus-text-muted" />}
          {isDone && <CheckCircle2 size={11} className="text-emerald-400" />}
          {isError && <XCircle size={11} className="text-red-400" />}
        </span>
      </div>
      {isDone && output?.message && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-nexus-text-secondary">{output.message}</p>
      )}
      {isError && part.errorText && (
        <p className="mt-1.5 text-[10px] text-red-400">{part.errorText}</p>
      )}
    </NxCard>
  );
}

/* ──── 单条消息 ──── */

export function ChatMessage({ message, isStreaming }: { message: UIMessage; isStreaming?: boolean }) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  const hasAnyContent = message.parts?.some(
    (part) =>
      (part.type === "text" && "text" in part && (part.text as string)?.trim().length > 0) ||
      (part.type === "reasoning" && "text" in part && (part.text as string)?.trim().length > 0) ||
      part.type.startsWith("tool-")
  );
  const isThinking = isAssistant && isStreaming && !hasAnyContent;

  // 合并连续的 reasoning parts
  const mergedReasoning = message.parts?.reduce(
    (acc, part) => {
      if (part.type === "reasoning" && "text" in part && (part.text as string)?.trim().length > 0) {
        return {
          text: acc.text ? `${acc.text}\n\n${part.text}` : (part.text as string),
          isStreaming: "state" in part ? (part as { state: string }).state === "streaming" : false,
          rendered: false,
        };
      }
      return acc;
    },
    { text: "", isStreaming: false, rendered: false }
  ) ?? { text: "", isStreaming: false, rendered: false };

  return (
    <div className={cn("flex gap-2 px-3 py-2 animate-fade-in", isUser && "flex-row-reverse")}>
      {/* 头像 */}
      <div
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
          isUser ? "bg-white/[0.08] text-nexus-text-primary" : "bg-sky-500/15 text-sky-400"
        )}
      >
        {isUser ? <User size={13} /> : <Bot size={13} />}
      </div>

      {/* 消息体 */}
      <div className={cn("min-w-0 flex-1 space-y-1", isUser && "text-right")}>
        <span className="text-[10px] font-medium text-nexus-text-muted">
          {isUser ? "操作员" : "Nexus AI"}
        </span>

        {isThinking ? (
          <div className="flex h-[18px] items-center">
            <Shimmer text="思考中..." />
          </div>
        ) : (
          message.parts.map((part, i) => {
            const key = `${message.id}-${i}`;

            // 推理过程（合并后只渲染一次）
            if (part.type === "reasoning") {
              if (!mergedReasoning.rendered && mergedReasoning.text) {
                mergedReasoning.rendered = true;
                return (
                  <details key={key} className="mt-1">
                    <summary className="cursor-pointer text-[10px] text-nexus-text-muted hover:text-nexus-text-secondary">
                      {mergedReasoning.isStreaming ? "思考中..." : "思考过程"}
                    </summary>
                    <p className="mt-1 rounded-md bg-white/[0.02] p-2 text-[10px] italic leading-relaxed text-nexus-text-muted">
                      {mergedReasoning.text}
                    </p>
                  </details>
                );
              }
              return null;
            }

            // 文本
            if (part.type === "text" && part.text) {
              return (
                <div
                  key={key}
                  className={cn(
                    "nexus-markdown text-[11px] leading-relaxed text-nexus-text-primary",
                    isUser && "inline-block rounded-md bg-white/[0.06] px-2.5 py-1.5 text-left"
                  )}
                >
                  {isUser ? (
                    <span>{part.text}</span>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
                  )}
                </div>
              );
            }

            // 文件附件
            if (part.type === "file") {
              const isImage = part.mediaType?.startsWith("image/");
              if (isImage) {
                return (
                  <img
                    key={key}
                    src={part.url}
                    alt={part.filename ?? "附件"}
                    className="mt-1 max-h-40 rounded-md border border-white/[0.06]"
                  />
                );
              }
              return (
                <NxBadge key={key} variant="info" className="mt-1">
                  {part.filename ?? "文件附件"}
                </NxBadge>
              );
            }

            // 工具调用
            if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
              return <ToolCallCard key={key} part={part as unknown as ToolPartProps} />;
            }

            return null;
          })
        )}
      </div>
    </div>
  );
}
