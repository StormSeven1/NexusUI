"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { MessageSquare, Trash2, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { NxIconButton } from "@/components/nexus";
import {
  listConversations,
  deleteConversation,
  type ConversationSummary,
} from "@/lib/chat-api";

interface ConversationListProps {
  activeId: string | null;
  onSelect: (conv: ConversationSummary) => void;
  onNew: () => void;
  refreshKey?: number;
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

export function ConversationList({ activeId, onSelect, onNew, refreshKey }: ConversationListProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listConversations(30);
      setConversations(list);
    } catch {
      /* 后端未启动时静默 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch { /* ignore */ }
  };

  if (!expanded) {
    return (
      <div className="flex items-center gap-1 border-b border-white/[0.06] px-2 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex flex-1 items-center gap-1.5 text-[10px] text-nexus-text-muted hover:text-nexus-text-secondary transition-colors"
        >
          <MessageSquare size={11} />
          <span>对话记录 ({conversations.length})</span>
          <ChevronDown size={10} />
        </button>
        <NxIconButton size="xs" onClick={onNew} title="新建对话">
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
          className="flex flex-1 items-center gap-1.5 text-[10px] text-nexus-text-muted hover:text-nexus-text-secondary transition-colors"
        >
          <MessageSquare size={11} />
          <span>对话记录</span>
          <ChevronUp size={10} />
        </button>
        <NxIconButton size="xs" onClick={onNew} title="新建对话">
          <Plus size={11} />
        </NxIconButton>
      </div>

      <div className="max-h-40 overflow-y-auto px-1 pb-1.5">
        {loading && conversations.length === 0 && (
          <p className="px-2 py-3 text-center text-[10px] text-nexus-text-muted">加载中...</p>
        )}
        {!loading && conversations.length === 0 && (
          <p className="px-2 py-3 text-center text-[10px] text-nexus-text-muted">暂无对话记录</p>
        )}
        {conversations.map((conv) => (
          <button
            key={conv.id}
            type="button"
            onClick={() => { onSelect(conv); setExpanded(false); }}
            className={cn(
              "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
              conv.id === activeId
                ? "bg-sky-500/10 text-sky-400"
                : "text-nexus-text-secondary hover:bg-white/[0.04] hover:text-nexus-text-primary"
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-medium leading-tight">{conv.title}</p>
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
