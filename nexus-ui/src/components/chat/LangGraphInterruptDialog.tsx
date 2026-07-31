"use client";

import type { LangGraphInterruptUiPayload } from "@/lib/langgraph-chat-sse";
import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  payload: LangGraphInterruptUiPayload | null;
  submitting: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
  onCancelTask: () => void;
  onSubmitDetails: (details: string) => void;
};

/**
 * 任务流 interrupt：在智能助手面板内嵌确认按钮（不再弹窗）。
 * 用户选择后 POST `interrupt_feedback` + `interrupt_id` + `thread_id`。
 */
export function LangGraphInterruptDialog({
  open,
  payload,
  submitting,
  onDismiss,
  onConfirm,
  onCancelTask,
  onSubmitDetails,
}: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsText, setDetailsText] = useState("");

  useEffect(() => {
    if (!open) {
      setDetailsOpen(false);
      setDetailsText("");
    }
  }, [open]);

  const resetDetails = useCallback(() => {
    setDetailsOpen(false);
    setDetailsText("");
  }, []);

  if (!open || !payload) return null;

  const handleDismiss = () => {
    if (submitting) return;
    resetDetails();
    onDismiss();
  };

  return (
    <div
      className={cn(
        "shrink-0 border-t border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-2",
        "shadow-[inset_0_1px_0_0_rgba(251,191,36,0.08)]",
      )}
      role="region"
      aria-label="任务执行确认"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-300/90">
              需要确认
            </span>
            {payload.nodeName ? (
              <span className="text-[10px] text-nexus-text-muted">
                节点：<span className="text-nexus-text-secondary">{payload.nodeName}</span>
              </span>
            ) : null}
          </div>
          <p className="text-[12px] leading-relaxed text-nexus-text-primary">{payload.message}</p>

          {detailsOpen ? (
            <div className="space-y-1.5 pt-0.5">
              <label className="text-[10px] font-medium text-nexus-text-muted">请提供更多详细信息</label>
              <textarea
                value={detailsText}
                onChange={(e) => setDetailsText(e.target.value)}
                placeholder="请输入详细信息…"
                rows={3}
                disabled={submitting}
                className="w-full resize-y rounded-md border border-white/[0.08] bg-black/30 px-2.5 py-2 text-[11px] text-nexus-text-primary placeholder:text-nexus-text-muted focus:border-sky-500/40 focus:outline-none focus:ring-1 focus:ring-sky-500/30 disabled:opacity-50"
              />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                resetDetails();
                onConfirm();
              }}
              className="rounded-md bg-emerald-600/90 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:opacity-45"
            >
              {submitting ? "提交中…" : "继续执行"}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                resetDetails();
                onCancelTask();
              }}
              className="rounded-md bg-red-600/85 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-600 disabled:opacity-45"
            >
              取消任务
            </button>
            {!detailsOpen ? (
              <button
                type="button"
                disabled={submitting}
                onClick={() => setDetailsOpen(true)}
                className="rounded-md bg-sky-600/90 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-600 disabled:opacity-45"
              >
                提供更多细节
              </button>
            ) : (
              <button
                type="button"
                disabled={submitting || !detailsText.trim()}
                onClick={() => {
                  onSubmitDetails(detailsText.trim());
                  resetDetails();
                }}
                className="rounded-md bg-sky-600/90 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-600 disabled:opacity-45"
              >
                提交详细信息
              </button>
            )}
          </div>
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
