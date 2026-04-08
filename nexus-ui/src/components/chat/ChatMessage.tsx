"use client";

import { cn } from "@/lib/utils";
import { Bot, User, MapPin, Target, Map, PanelRight, Search, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { NxCard, NxBadge } from "@/components/nexus";
import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const TOOL_META: Record<string, { icon: typeof MapPin; label: string; color: string }> = {
  navigate_to_location: { icon: MapPin, label: "地图导航", color: "text-sky-400" },
  select_track: { icon: Target, label: "选中目标", color: "text-amber-400" },
  switch_map_mode: { icon: Map, label: "切换视图", color: "text-emerald-400" },
  open_panel: { icon: PanelRight, label: "打开面板", color: "text-purple-400" },
  query_tracks: { icon: Search, label: "查询目标", color: "text-nexus-friendly" },
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
    <NxCard padding="sm" className="my-1.5">
      <div className="flex items-center gap-2">
        <Icon size={13} className={meta.color} />
        <span className="text-[10px] font-semibold tracking-wider text-nexus-text-secondary">{meta.label}</span>
        <span className="ml-auto">
          {(isStreaming || isWaiting) && <Loader2 size={11} className="animate-spin text-nexus-text-muted" />}
          {isDone && <CheckCircle2 size={11} className="text-emerald-400" />}
          {isError && <XCircle size={11} className="text-red-400" />}
        </span>
      </div>
      {isDone && output?.message && (
        <p className="mt-1 text-[10px] text-nexus-text-secondary">{output.message}</p>
      )}
      {isError && part.errorText && (
        <p className="mt-1 text-[10px] text-red-400">{part.errorText}</p>
      )}
    </NxCard>
  );
}

export function ChatMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

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

        {message.parts.map((part, i) => {
          if (part.type === "text" && part.text) {
            return (
              <div
                key={i}
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

          if (part.type === "file") {
            const isImage = part.mediaType?.startsWith("image/");
            if (isImage) {
              return (
                <img
                  key={i}
                  src={part.url}
                  alt={part.filename ?? "附件"}
                  className="mt-1 max-h-40 rounded-md border border-white/[0.06]"
                />
              );
            }
            return (
              <NxBadge key={i} variant="info" className="mt-1">
                {part.filename ?? "文件附件"}
              </NxBadge>
            );
          }

          if (part.type === "reasoning" && part.text) {
            return (
              <details key={i} className="mt-1">
                <summary className="cursor-pointer text-[10px] text-nexus-text-muted hover:text-nexus-text-secondary">
                  思考过程
                </summary>
                <p className="mt-1 rounded-md bg-white/[0.02] p-2 text-[10px] italic text-nexus-text-muted">
                  {part.text}
                </p>
              </details>
            );
          }

          if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
            return <ToolCallCard key={i} part={part as unknown as ToolPartProps} />;
          }

          return null;
        })}
      </div>
    </div>
  );
}
