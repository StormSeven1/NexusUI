"use client";

import type { LangGraphInterruptUiPayload } from "@/lib/langgraph-chat-sse";
import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
 * 与 Qt `WorkflowInterruptDialog` 对齐：任务流 interrupt 时确认，
 * 用户选择后 POST `interrupt_feedback` + `interrupt_id` + `thread_id` 到同一 chat 接口。
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

  const handleBackdrop = () => {
    if (submitting) return;
    resetDetails();
    onDismiss();
  };

  return (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={handleBackdrop} aria-hidden />
      <div
        className="relative z-10 w-full max-w-[520px] overflow-hidden rounded-xl border border-white/[0.1] bg-[#1e2430]/95 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="langgraph-interrupt-title"
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <h2 id="langgraph-interrupt-title" className="text-sm font-semibold text-nexus-text-primary">
            任务执行确认
          </h2>
          <button
            type="button"
            disabled={submitting}
            onClick={handleBackdrop}
            className="flex h-8 w-8 items-center justify-center rounded-md text-nexus-text-muted hover:bg-white/10 disabled:opacity-40"
            title="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[min(60vh,420px)] space-y-3 overflow-y-auto px-4 py-3">
          <div className="rounded-lg bg-white/[0.05] px-3 py-2.5 text-[12px] leading-relaxed text-nexus-text-primary">
            {payload.message}
          </div>
          {payload.nodeName ? (
            <p className="text-[10px] text-nexus-text-muted">
              节点：<span className="text-nexus-text-secondary">{payload.nodeName}</span>
            </p>
          ) : null}

          {detailsOpen ? (
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-nexus-text-muted">请提供更多详细信息</label>
              <textarea
                value={detailsText}
                onChange={(e) => setDetailsText(e.target.value)}
                placeholder="请输入详细信息…"
                rows={4}
                disabled={submitting}
                className="w-full resize-y rounded-md border border-white/[0.08] bg-black/30 px-2.5 py-2 text-[11px] text-nexus-text-primary placeholder:text-nexus-text-muted focus:border-sky-500/40 focus:outline-none focus:ring-1 focus:ring-sky-500/30 disabled:opacity-50"
              />
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.06] bg-black/20 px-4 py-3">
          <button
            type="button"
            disabled={submitting}
            onClick={() => {
              resetDetails();
              onConfirm();
            }}
            className="rounded-md bg-emerald-600/90 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:opacity-45"
          >
            继续执行
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => {
              resetDetails();
              onCancelTask();
            }}
            className="rounded-md bg-red-600/85 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-red-600 disabled:opacity-45"
          >
            取消任务
          </button>
          {!detailsOpen ? (
            <button
              type="button"
              disabled={submitting}
              onClick={() => setDetailsOpen(true)}
              className="rounded-md bg-sky-600/90 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-sky-600 disabled:opacity-45"
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
              className="rounded-md bg-sky-600/90 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-sky-600 disabled:opacity-45"
            >
              提交详细信息
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
