"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, MessageSquare, Plus, Radio, Trash2 } from "lucide-react";

import { NxIconButton } from "@/components/nexus";
import { deleteConversation, listConversations, type ConversationSummary } from "@/lib/chat-api";
import { cn } from "@/lib/utils";

interface ConversationListProps {
  category?: "chat" | "plans";
  activeId: string | null;
  onSelect: (conv: ConversationSummary) => void;
  onNew: () => void;
  refreshKey?: number;
  currentLabel?: string;
  onCurrent?: () => void;
  currentActive?: boolean;
  currentCount?: number;
  activeBadgeLabel?: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export function ConversationList({
  category = "chat",
  activeId,
  onSelect,
  onNew,
  refreshKey,
  currentLabel,
  onCurrent,
  currentActive = false,
  currentCount,
  activeBadgeLabel,
}: ConversationListProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const title = category === "plans" ? "方案记录" : "对话记录";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listConversations(30, 0, category);
      setConversations(list);
    } catch {
      /* backend may be offline */
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  useEffect(() => {
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ category?: string }>).detail;
      if (detail?.category && detail.category !== category) return;
      void refresh();
    };
    window.addEventListener("conversation-history-updated", onUpdated);
    return () => window.removeEventListener("conversation-history-updated", onUpdated);
  }, [category, refresh]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch {
      /* ignore */
    }
  };

  const currentCountText =
    currentCount == null ? "" : category === "plans" ? `${currentCount} 条方案` : `${currentCount} 条消息`;

  const currentBadge = currentLabel ? (
    onCurrent ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onCurrent();
        }}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-medium transition",
          currentActive
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            : "border-white/[0.08] bg-white/[0.03] text-nexus-text-muted hover:border-sky-500/20 hover:text-sky-300",
        )}
      >
        <Radio size={9} />
        {currentLabel}
      </button>
    ) : (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-medium",
          currentActive
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            : "border-white/[0.08] bg-white/[0.03] text-nexus-text-muted",
        )}
      >
        <Radio size={9} />
        {currentLabel}
      </span>
    )
  ) : null;

  if (!expanded) {
    return (
      <div className="flex items-center gap-1 border-b border-white/[0.06] px-2 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[10px] text-nexus-text-muted transition-colors hover:text-nexus-text-secondary"
        >
          <MessageSquare size={11} className="shrink-0" />
          <span className="truncate">
            {title} ({conversations.length})
          </span>
          <ChevronDown size={10} className="shrink-0" />
        </button>
        {currentBadge}
        <NxIconButton size="xs" onClick={onNew} title={category === "plans" ? "新任务" : "新对话"}>
          <Plus size={11} />
        </NxIconButton>
      </div>
    );
  }

  return (
    <div className="border-b border-white/[0.06]">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex flex-1 items-center gap-1.5 text-[10px] text-nexus-text-muted transition-colors hover:text-nexus-text-secondary"
        >
          <MessageSquare size={11} />
          <span>{title}</span>
          <ChevronUp size={10} />
        </button>
        <NxIconButton size="xs" onClick={onNew} title={category === "plans" ? "新任务" : "新对话"}>
          <Plus size={11} />
        </NxIconButton>
      </div>

      <div className="max-h-40 overflow-y-auto px-1 pb-1.5">
        {onCurrent && currentLabel && (
          <button
            type="button"
            onClick={() => {
              onCurrent();
              setExpanded(false);
            }}
            className={cn(
              "mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
              currentActive
                ? "bg-sky-500/10 text-sky-400"
                : "text-nexus-text-secondary hover:bg-white/[0.04] hover:text-nexus-text-primary",
            )}
          >
            <Radio size={10} className={currentActive ? "text-emerald-400" : "text-nexus-text-muted"} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <p className="truncate text-[10px] font-medium leading-tight">{currentLabel}</p>
                <span className="shrink-0 rounded border border-emerald-500/20 bg-emerald-500/10 px-1 text-[8px] text-emerald-300">
                  当前
                </span>
              </div>
              {currentCountText && <p className="text-[9px] text-nexus-text-muted">{currentCountText}</p>}
            </div>
          </button>
        )}
        {loading && conversations.length === 0 && (
          <p className="px-2 py-3 text-center text-[10px] text-nexus-text-muted">加载中...</p>
        )}
        {!loading && conversations.length === 0 && (
          <p className="px-2 py-3 text-center text-[10px] text-nexus-text-muted">暂无{title}</p>
        )}
        {conversations.map((conv) => (
          <button
            key={conv.id}
            type="button"
            onClick={() => {
              onSelect(conv);
              setExpanded(false);
            }}
            className={cn(
              "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
              conv.id === activeId
                ? "bg-sky-500/10 text-sky-400"
                : "text-nexus-text-secondary hover:bg-white/[0.04] hover:text-nexus-text-primary",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <p className="truncate text-[10px] font-medium leading-tight">{conv.title}</p>
                {conv.id === activeId && activeBadgeLabel && (
                  <span className="shrink-0 rounded border border-emerald-500/20 bg-emerald-500/10 px-1 text-[8px] text-emerald-300">
                    {activeBadgeLabel}
                  </span>
                )}
              </div>
              <p className="text-[9px] text-nexus-text-muted">{formatTime(conv.updated_at)}</p>
            </div>
            <span
              onClick={(e) => handleDelete(e, conv.id)}
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Trash2 size={10} className="text-nexus-text-muted hover:text-red-400" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
