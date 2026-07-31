"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  KnowledgeBaseInterruptNode,
  KnowledgeBasePendingInterrupt,
} from "@/lib/knowledge-base-chat-sse";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  pending: KnowledgeBasePendingInterrupt | null;
  submitting: boolean;
  /** 恢复请求断流/网络异常后进入结果未知，禁止再次提交同一令牌 */
  resultUnknown?: boolean;
  onDismiss: () => void;
  onSubmit: (selectedValues: Record<string, string>) => void;
};

/**
 * 知识库 interrupt：内嵌于对话面板（与智能助手确认区同风格），
 * 由服务端 `interrupt.data.nodes[]` / `options[]` 驱动，不硬编码 confirm/cancel。
 */
export function KnowledgeBaseInterruptDialog({
  open,
  pending,
  submitting,
  resultUnknown = false,
  onDismiss,
  onSubmit,
}: Props) {
  const [selected, setSelected] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !pending) {
      setSelected({});
      return;
    }
    setSelected({});
  }, [open, pending?.interruptId]);

  const nodes = pending?.nodes ?? [];
  const allSelected = useMemo(() => {
    if (nodes.length === 0) return false;
    return nodes.every((n) => Boolean(selected[n.interrupt_id]?.trim()));
  }, [nodes, selected]);

  if (!open || !pending) return null;

  const locked = submitting || resultUnknown;

  const handleDismiss = () => {
    if (submitting) return;
    onDismiss();
  };

  const pickOption = (node: KnowledgeBaseInterruptNode, value: string) => {
    if (locked) return;
    const next = { ...selected, [node.interrupt_id]: value };
    setSelected(next);
    // 单节点：点选即提交；多节点需点「提交选择」
    if (nodes.length === 1) onSubmit(next);
  };

  const optionTone = (value: string) => {
    const v = value.trim().toLowerCase();
    if (v === "confirm" || v === "[confirm]") {
      return "bg-emerald-600/90 text-white hover:bg-emerald-600";
    }
    if (v === "cancel" || v === "[cancel]") {
      return "bg-red-600/85 text-white hover:bg-red-600";
    }
    return "bg-sky-600/90 text-white hover:bg-sky-600";
  };

  return (
    <div
      className={cn(
        "shrink-0 border-t border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-2",
        "shadow-[inset_0_1px_0_0_rgba(251,191,36,0.08)]",
      )}
      role="region"
      aria-label="知识库确认"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-300/90">
              需要确认
            </span>
            {submitting ? (
              <span className="text-[10px] text-nexus-text-muted">提交中…</span>
            ) : null}
          </div>

          {resultUnknown ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-100">
              恢复请求结果状态不确定。请勿重复提交同一确认；请通过设备或任务平台状态核对后再决定是否重新发起自然语言指令。
            </div>
          ) : null}

          {nodes.map((node) => {
            const current = selected[node.interrupt_id];
            return (
              <div key={node.interrupt_id} className="space-y-1.5">
                <p className="text-[12px] leading-relaxed text-nexus-text-primary">{node.message}</p>
                <p className="text-[10px] text-nexus-text-muted">
                  节点：<span className="text-nexus-text-secondary">{node.node_name}</span>
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {node.options.map((opt) => {
                    const active = current === opt.value;
                    return (
                      <button
                        key={`${node.interrupt_id}:${opt.value}`}
                        type="button"
                        disabled={locked}
                        onClick={() => pickOption(node, opt.value)}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-[11px] font-medium disabled:opacity-45",
                          optionTone(opt.value),
                          active && "ring-2 ring-white/40",
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {nodes.length > 1 && !resultUnknown ? (
            <div className="pt-0.5">
              <button
                type="button"
                disabled={locked || !allSelected}
                onClick={() => onSubmit(selected)}
                className="rounded-md bg-emerald-600/90 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:opacity-45"
              >
                {submitting ? "提交中…" : "提交选择"}
              </button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          disabled={submitting}
          onClick={handleDismiss}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-nexus-text-muted hover:bg-white/10 disabled:opacity-40"
          title="收起确认区（不终止任务流；可用停止彻底取消）"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
