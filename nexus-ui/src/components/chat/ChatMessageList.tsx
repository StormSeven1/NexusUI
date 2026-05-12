"use client";

import { useRef, useEffect, useMemo, useCallback } from "react";
import { ChatMessage } from "./ChatMessage";
import { SchemeRow } from "./DisposalPlanFeed";
import { useDisposalPlanStore, type DisposalPlanBlock } from "@/stores/disposal-plan-store";
import { useTrackAliasStore } from "@/stores/track-alias-store";
import { formatTargetKindPhraseFromTargetInfo, formatTargetIdForUi } from "@/lib/disposal/normalize-disposal-plans";
import { getRenderCache } from "@/stores/track-store";
import { useAppStore } from "@/stores/app-store";
import { NxCard } from "@/components/nexus";
import type { UIMessage } from "ai";
import { Bot, Sparkles, Crosshair } from "lucide-react";

/* ──── 处置方案：以对话消息样式渲染 ──── */

function DisposalBlockMessage({ block }: { block: DisposalPlanBlock }) {
  const executeScheme = useDisposalPlanStore((s) => s.executeScheme);
  const aliases = useTrackAliasStore((s) => s.aliases);
  const requestFlyTo = useAppStore((s) => s.requestFlyTo);

  const handleHoverTarget = useCallback((tid: string) => {
    if (!tid) return;
    const cache = getRenderCache();
    const t = cache.get(tid);
    if (t) { requestFlyTo(t.lat, t.lng, 14); return; }
    for (const [, tr] of cache) {
      if (tr.trackId === tid) { requestFlyTo(tr.lat, tr.lng, 14); return; }
    }
  }, [requestFlyTo]);

  return (
    <div className="flex gap-2 px-3 py-2 animate-fade-in">
      {/* 头像 —— 与 ChatMessage assistant 一致 */}
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sky-500/15 text-sky-400">
        <Bot size={13} />
      </div>
      <div className="min-w-0 flex-1 max-w-[80%] space-y-1">
        <span className="text-[10px] font-medium text-nexus-text-muted">Nexus AI</span>
        {block.items.map((row) => {
          const targetId = String(row.inputParams?.targetId ?? "").trim();
          const alias = targetId ? aliases[targetId] : undefined;
          const kindPhrase = formatTargetKindPhraseFromTargetInfo(row.inputParams as unknown as Record<string, unknown>);
          const displayId = formatTargetIdForUi(targetId, row.inputParams?.targetType);
          return (
            <NxCard key={row.cardInstanceId} padding="none" className="my-1 p-2">
              {/* 醒目标题：别名 + 目标类型（大），真实ID（小）；悬停飞到目标 */}
              <div
                className="mb-1 flex items-center gap-1.5 cursor-pointer rounded px-1 -mx-1 transition-colors hover:bg-white/[0.04]"
                onMouseEnter={() => handleHoverTarget(targetId)}
              >
                <Crosshair size={13} className="shrink-0 text-amber-400" />
                <div>
                  <div className="text-[12px] font-bold leading-tight text-nexus-text-primary">
                    {alias ? <span className="text-amber-400">{alias}</span> : `目标 ${displayId}`}
                    {kindPhrase && <span className="text-nexus-text-secondary"> · {kindPhrase}</span>}
                  </div>
                  {alias && displayId && (
                    <div className="text-[9px] leading-tight text-nexus-text-muted">ID: {displayId}</div>
                  )}
                </div>
              </div>
              {row.noPlansReason && (
                <p className="mb-1 text-[10px] text-amber-400/90">{row.noPlansReason}</p>
              )}
              {row.mappedSchemes.length === 0 && !row.noPlansReason && (
                <p className="text-[10px] text-nexus-text-muted">暂无可用方案</p>
              )}
              <div className="space-y-1.5">
                {row.mappedSchemes.map((sch) => {
                  const executed = row.executedSchemeIds.includes(sch.schemeId);
                  const busy = row.executingSchemeIds.includes(sch.schemeId);
                  return (
                    <SchemeRow
                      key={sch.schemeId}
                      scheme={sch}
                      executed={executed}
                      disabled={busy}
                      onExecute={() => void executeScheme(block.blockId, row.cardInstanceId, sch)}
                    />
                  );
                })}
              </div>
              {row.lastError && <p className="mt-1 text-[10px] text-red-400/90">{row.lastError}</p>}
            </NxCard>
          );
        })}
      </div>
    </div>
  );
}

/** 方案块首次出现时的消息数量，用于在时间线中定位（模块级，单实例安全） */
const _blockInsertPos = new Map<string, number>();

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
  const disposalBlocks = useDisposalPlanStore((s) => s.blocks);
  const hasContent = messages.length > 0 || disposalBlocks.length > 0;

  const timeline = useMemo(() => {
    type TItem =
      | { kind: "msg"; msg: UIMessage; idx: number; order: number }
      | { kind: "disposal"; block: DisposalPlanBlock; order: number };

    // 首次看到某方案块时，记住当前消息数量，保证后续新消息排在方案块之后
    for (const b of disposalBlocks) {
      if (!_blockInsertPos.has(b.blockId)) _blockInsertPos.set(b.blockId, messages.length);
    }

    const items: TItem[] = [];
    messages.forEach((msg, i) => {
      items.push({ kind: "msg", msg, idx: i, order: i });
    });
    disposalBlocks.forEach((b, di) => {
      const pos = _blockInsertPos.get(b.blockId) ?? messages.length;
      items.push({ kind: "disposal", block: b, order: pos - 0.5 + di * 0.0001 });
    });
    items.sort((a, b) => a.order - b.order);
    return items;
  }, [messages, disposalBlocks]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming, disposalBlocks.length]);

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
      {!hasContent
        ? emptyState
        : timeline.map((item) =>
            item.kind === "msg" ? (
              <ChatMessage
                key={item.msg.id}
                message={item.msg}
                isStreaming={
                  item.msg.role === "assistant" &&
                  item.idx === messages.length - 1 &&
                  isStreaming
                }
              />
            ) : (
              <DisposalBlockMessage key={item.block.blockId} block={item.block} />
            ),
          )}
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
