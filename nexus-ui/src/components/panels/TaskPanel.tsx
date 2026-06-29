"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Clock, Radio, SquarePen, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConversationList } from "@/components/chat/ConversationList";
import { DisposalPlanFeed } from "@/components/chat/DisposalPlanFeed";
import { NxIconButton, NxPanelHeader } from "@/components/nexus";
import type { ConversationSummary } from "@/lib/chat-api";
import { DISPOSAL_PLAN_HISTORY_TYPE } from "@/lib/conversation-history-client";
import { DisposalPlanWsClient } from "@/lib/disposal/disposal-ws-client";
import { useAppConfigStore } from "@/stores/app-config-store";
import { useAppStore } from "@/stores/app-store";
import { useDisposalPlanStore, type DisposalPlanBlock } from "@/stores/disposal-plan-store";

type TaskPanelMode = "current" | "history";

function extractHistoryBlocks(messages: Array<{ content: string }>): DisposalPlanBlock[] {
  const blocks: DisposalPlanBlock[] = [];
  for (const msg of messages) {
    try {
      const parsed = JSON.parse(msg.content);
      if (parsed?.type === DISPOSAL_PLAN_HISTORY_TYPE && parsed.block) {
        blocks.push(parsed.block as DisposalPlanBlock);
      }
    } catch {
      /* ignore non-plan messages */
    }
  }
  return blocks;
}

export function TaskPanel() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [mode, setMode] = useState<TaskPanelMode>("current");
  const [historyBlocks, setHistoryBlocks] = useState<DisposalPlanBlock[]>([]);
  const [historyTitle, setHistoryTitle] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const blocks = useDisposalPlanStore((s) => s.blocks);
  const appendDisposalFromWs = useDisposalPlanStore((s) => s.appendFromNormalized);
  const setDisposalWsStatus = useDisposalPlanStore((s) => s.setWsStatus);
  const clearBlocks = useDisposalPlanStore((s) => s.clearBlocks);
  const setTaskPanelHasNewPlan = useAppStore((s) => s.setTaskPanelHasNewPlan);
  const disposalWsRef = useRef<DisposalPlanWsClient | null>(null);

  const showCurrent = useCallback(() => {
    setMode("current");
    setConversationId(null);
    setHistoryBlocks([]);
    setHistoryTitle("");
    setTaskPanelHasNewPlan(false);
  }, [setTaskPanelHasNewPlan]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await useAppConfigStore.getState().ensureLoaded();
      if (cancelled) return;
      setDisposalWsStatus("connecting");
      const client = new DisposalPlanWsClient({
        handlers: {
          onConnect: () => setDisposalWsStatus("open"),
          onDisconnect: (intentional) => {
            if (!intentional) {
              setDisposalWsStatus("error");
              toast.error("处置方案连接断开", { description: "WebSocket 连接意外断开，将自动重连" });
            }
          },
          onConnectTimeout: () => {
            setDisposalWsStatus("error");
            toast.error("处置方案连接超时", { description: "无法连接方案服务，请检查网络" });
          },
          onPlanReady: (n) => {
            appendDisposalFromWs(n, "ws");
            setRefreshKey((k) => k + 1);
          },
        },
      });
      client.start();
      disposalWsRef.current = client;
    })();
    return () => {
      cancelled = true;
      disposalWsRef.current?.stop();
      disposalWsRef.current = null;
    };
  }, [appendDisposalFromWs, setDisposalWsStatus]);

  useEffect(() => {
    const onCurrentUpdated = () => {
      const state = useAppStore.getState();
      if (mode === "history" || state.rightPanelTab !== "taskPanel" || !state.rightSidebarOpen) {
        setTaskPanelHasNewPlan(true);
      } else {
        showCurrent();
      }
      setRefreshKey((k) => k + 1);
    };
    window.addEventListener("current-disposal-plan-updated", onCurrentUpdated);
    return () => window.removeEventListener("current-disposal-plan-updated", onCurrentUpdated);
  }, [mode, setTaskPanelHasNewPlan, showCurrent]);

  const handleNewTask = useCallback(() => {
    showCurrent();
    clearBlocks();
  }, [clearBlocks, showCurrent]);

  const handleSelectConversation = useCallback(async (conv: ConversationSummary) => {
    setConversationId(conv.id);
    setMode("history");
    setHistoryTitle(conv.title);
    try {
      const res = await fetch(`/api/backend/conversations/${conv.id}`);
      if (!res.ok) {
        setHistoryBlocks([]);
        return;
      }
      const detail = await res.json();
      setHistoryBlocks(extractHistoryBlocks((detail.messages ?? []) as Array<{ content: string }>));
    } catch {
      setHistoryBlocks([]);
    }
  }, []);

  const handleClear = useCallback(() => {
    if (mode === "history" && conversationId) {
      fetch(`/api/backend/conversations/${conversationId}/messages`, { method: "DELETE" }).catch(() => {});
      setHistoryBlocks([]);
      setRefreshKey((k) => k + 1);
      return;
    }
    clearBlocks();
  }, [clearBlocks, conversationId, mode]);

  const visibleBlocks = mode === "history" ? historyBlocks : blocks;
  const hasVisibleBlocks = visibleBlocks.length > 0;

  return (
    <div className="flex h-full flex-col">
      <NxPanelHeader
        title="任务面板"
        right={
          <div className="flex items-center gap-1">
            {hasVisibleBlocks && (
              <NxIconButton size="xs" onClick={handleClear} title="清空任务">
                <Trash2 size={12} />
              </NxIconButton>
            )}
            <NxIconButton size="xs" onClick={handleNewTask} title="新任务">
              <SquarePen size={12} />
            </NxIconButton>
          </div>
        }
      />

      <ConversationList
        category="plans"
        activeId={conversationId}
        onSelect={handleSelectConversation}
        onNew={handleNewTask}
        refreshKey={refreshKey}
        currentLabel="当前方案"
        onCurrent={showCurrent}
        currentActive={mode === "current"}
        currentCount={blocks.length}
        activeBadgeLabel="正在查看"
      />

      {mode === "history" && (
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2 text-[10px] text-nexus-text-muted">
          <Clock size={11} className="text-amber-400" />
          <span className="min-w-0 flex-1 truncate">历史方案：{historyTitle || conversationId}</span>
          <button
            type="button"
            onClick={showCurrent}
            className="inline-flex items-center gap-1 rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-300 transition hover:bg-sky-500/15"
          >
            <Radio size={10} />
            当前方案
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasVisibleBlocks ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10">
              <Bot size={20} className="text-sky-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-nexus-text-secondary">
                {mode === "history" ? "该历史记录暂无处置方案" : "暂无处置方案"}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-nexus-text-muted">
                {mode === "history" ? "点击当前方案可回到实时方案流" : "自动推送和一键处置生成的方案会显示在这里"}
              </p>
            </div>
          </div>
        ) : (
          <DisposalPlanFeed blocks={visibleBlocks} readOnly={mode === "history"} />
        )}
      </div>
    </div>
  );
}
