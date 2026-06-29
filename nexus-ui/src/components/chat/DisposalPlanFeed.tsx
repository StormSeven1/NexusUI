"use client";

import { useRef, useEffect } from "react";
import { NxCard } from "@/components/nexus";
import { cn } from "@/lib/utils";
import { useDisposalPlanStore, type DisposalPlanBlock, type DisposalPlanCardRow } from "@/stores/disposal-plan-store";
import type { MappedDisposalScheme } from "@/lib/disposal/disposal-types";
import { Loader2, Radio, CheckCircle2, Zap } from "lucide-react";

/**
 * 单个方案卡片行：展示方案名称 + P0/P1/P2 优先级徽章 + 描述 + 任务列表 + 执行按钮。
 * priority 由 rankSchemesByRecommendationScore 按 recommendationScore 降序排名赋值。
 */
export function SchemeRow({
  scheme,
  disabled,
  executed,
  readOnly = false,
  onExecute,
}: {
  scheme: MappedDisposalScheme;
  disabled: boolean;
  executed: boolean;
  readOnly?: boolean;
  onExecute: () => void;
}) {
  const tasks = scheme.tasks || [];
  const visibleTasks = tasks.slice(0, 3);
  const taskLines = visibleTasks.map((t) => (
    <div key={`${scheme.schemeId}-${t.deviceId}`} className="text-[10px] text-nexus-text-secondary">
      <span className="text-nexus-text-muted">{t.deviceName}</span>
      <span className="mx-1 text-nexus-text-muted/60">·</span>
      <span>{t.actionName}</span>
    </div>
  ));

  return (
    <div
      className={cn(
        "rounded-lg border border-white/[0.06] bg-white/[0.02] p-2",
        executed && "border-emerald-500/20 bg-emerald-500/5",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[11px] font-medium text-nexus-text-primary">{scheme.schemeName}</span>
            <span className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold",
              scheme.priority === 0
                ? "bg-amber-500/15 text-amber-400"
                : scheme.priority === 1
                  ? "bg-sky-500/15 text-sky-400"
                  : "bg-white/[0.06] text-nexus-text-muted",
            )}>
              P{scheme.priority}
            </span>
          </div>
          <div className="mt-1 space-y-0.5">{taskLines}</div>
          {tasks.length > visibleTasks.length && (
            <p className="mt-0.5 text-[9px] text-nexus-text-muted">还有 {tasks.length - visibleTasks.length} 条任务</p>
          )}
        </div>
        <div className="shrink-0">
          {executed ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-400">
              <CheckCircle2 size={12} />
              已执行
            </span>
          ) : readOnly ? (
            <span className="inline-flex items-center rounded border border-white/[0.06] px-1.5 py-0.5 text-[10px] text-nexus-text-muted">
              历史
            </span>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={onExecute}
              className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[10px] font-semibold text-sky-300 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {disabled ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
              执行
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 方案块卡片：一次方案生成（DisposalPlanBlock）的 UI 容器。
 * 包含来源标签（实时/一键）、taskId、摘要、以及各 DisposalPlanCardRow。
 */
function DisposalCardBlock({
  block,
  readOnly = false,
  onExecute,
}: {
  block: DisposalPlanBlock;
  readOnly?: boolean;
  onExecute: (row: DisposalPlanCardRow, s: MappedDisposalScheme) => void;
}) {
  return (
    <NxCard padding="sm" className="mb-2 border-sky-500/10">
      {block.items.map((row, rowIndex) => (
        <div key={`${row.cardInstanceId}:${rowIndex}`} className="mb-2 last:mb-0">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-nexus-text-primary">
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 bg-amber-400 opacity-90"
              style={{
                mask: 'url("/icons/任务方案.svg") center / contain no-repeat',
                WebkitMask: 'url("/icons/任务方案.svg") center / contain no-repeat',
              }}
            />
            <span>{row.userQuery}</span>
          </div>
          {row.noPlansReason && (
            <p className="mb-1 text-[10px] text-amber-400/90">{row.noPlansReason}</p>
          )}
          {row.mappedSchemes.length === 0 && !row.noPlansReason && (
            <p className="text-[10px] text-nexus-text-muted">暂无可用方案</p>
          )}
          <div className="space-y-1.5">
            {row.mappedSchemes.map((sch, schemeIndex) => {
              const executed = row.executedSchemeIds.includes(sch.schemeId);
              const busy = row.executingSchemeIds.includes(sch.schemeId);
              return (
                <SchemeRow
                  key={`${sch.schemeId}:${schemeIndex}`}
                  scheme={sch}
                  executed={executed}
                  disabled={busy}
                  readOnly={readOnly}
                  onExecute={() => onExecute(row, sch)}
                />
              );
            })}
          </div>
          {row.lastError && <p className="mt-1 text-[10px] text-red-400/90">{row.lastError}</p>}
        </div>
      ))}
    </NxCard>
  );
}

/**
 * 处置方案信息流：消费 disposalPlanStore.blocks，渲染所有方案块。
 * 数据流：后端 WS/HTTP → normalizeDisposalPlans → store.appendFromNormalized → 本组件
 * 执行流：用户点击「执行」→ store.executeScheme → postDisposalExecute → applySchemeSideEffects
 */
export function DisposalPlanFeed({
  blocks: overrideBlocks,
  readOnly = false,
}: {
  blocks?: DisposalPlanBlock[];
  readOnly?: boolean;
} = {}) {
  const storeBlocks = useDisposalPlanStore((s) => s.blocks);
  const blocks = overrideBlocks ?? storeBlocks;
  const wsStatus = useDisposalPlanStore((s) => s.wsStatus);
  const executeScheme = useDisposalPlanStore((s) => s.executeScheme);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 新方案追加到底部时自动滚动
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [blocks.length]);

  if (blocks.length === 0) return null;

  return (
    <div className="px-3 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-nexus-text-muted">
        <Radio size={10} className={wsStatus === "open" ? "text-emerald-400" : "text-zinc-500"} />
        <span>
          处置方案
          {wsStatus === "connecting" && " · 连接中…"}
          {wsStatus === "open" && " · 实时"}
          {wsStatus === "error" && " · 未连接"}
        </span>
      </div>
      <div className="space-y-2">
        {blocks.map((b, index) => (
          <DisposalCardBlock
            key={`${b.blockId}:${index}`}
            block={b}
            readOnly={readOnly}
            onExecute={(row, sch) => {
              if (readOnly) return;
              void executeScheme(b.blockId, row.cardInstanceId, sch);
            }}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
