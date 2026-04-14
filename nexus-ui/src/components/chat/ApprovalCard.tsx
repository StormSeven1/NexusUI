"use client";

import { useState, useCallback } from "react";
import { NxCard } from "@/components/nexus";
import { cn } from "@/lib/utils";
import {
  ShieldQuestion, Check, X, Loader2, Clock,
  Plane, Radio, RotateCcw,
} from "lucide-react";

export interface ApprovalCardProps {
  approvalId: string;
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  description: string;
}

export interface ApprovalResultProps {
  approvalId: string;
  approved: boolean;
  reason?: string | null;
}

const TOOL_ICON: Record<string, typeof Plane> = {
  assign_asset: Plane,
  command_asset: Radio,
  recall_asset: RotateCcw,
};

export function ApprovalCard({ approvalId, toolName, description }: ApprovalCardProps) {
  const [status, setStatus] = useState<"pending" | "approving" | "approved" | "rejected">("pending");
  const Icon = TOOL_ICON[toolName] ?? ShieldQuestion;

  const handleDecision = useCallback(async (approved: boolean) => {
    setStatus("approving");
    try {
      const res = await fetch("/api/chat/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approval_id: approvalId, approved }),
      });
      if (res.ok) {
        setStatus(approved ? "approved" : "rejected");
      } else {
        setStatus("pending");
      }
    } catch {
      setStatus("pending");
    }
  }, [approvalId]);

  return (
    <NxCard padding="sm" className="my-1.5 border border-amber-500/20 bg-amber-500/[0.03]">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded bg-amber-500/10">
          <ShieldQuestion size={11} className="text-amber-400" />
        </div>
        <span className="text-[10px] font-semibold tracking-wider text-amber-400 uppercase">
          需要审批
        </span>
        {status === "pending" && (
          <span className="ml-auto flex items-center gap-1 text-[9px] text-amber-400/60">
            <Clock size={8} />
            等待确认
          </span>
        )}
      </div>

      <div className="mb-3 flex items-start gap-2 rounded-md bg-white/[0.02] px-2.5 py-2">
        <Icon size={14} className="mt-0.5 shrink-0 text-amber-400/70" />
        <p className="text-[11px] leading-relaxed text-nexus-text-primary">
          {description}
        </p>
      </div>

      {status === "pending" && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleDecision(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-500/15 px-3 py-1.5 text-[10px] font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/25"
          >
            <Check size={11} />
            批准
          </button>
          <button
            type="button"
            onClick={() => handleDecision(false)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-red-500/15 px-3 py-1.5 text-[10px] font-semibold text-red-400 transition-colors hover:bg-red-500/25"
          >
            <X size={11} />
            拒绝
          </button>
        </div>
      )}

      {status === "approving" && (
        <div className="flex items-center justify-center gap-1.5 py-1.5 text-[10px] text-nexus-text-muted">
          <Loader2 size={11} className="animate-spin" />
          处理中...
        </div>
      )}

      {status === "approved" && (
        <div className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-3 py-1.5 text-[10px] font-semibold text-emerald-400">
          <Check size={11} />
          已批准 — 正在执行
        </div>
      )}

      {status === "rejected" && (
        <div className="flex items-center gap-1.5 rounded-md bg-red-500/10 px-3 py-1.5 text-[10px] font-semibold text-red-400">
          <X size={11} />
          已拒绝
        </div>
      )}
    </NxCard>
  );
}

export function ApprovalResultCard({ approved, reason }: ApprovalResultProps) {
  return (
    <NxCard padding="sm" className={cn(
      "my-1.5 border",
      approved ? "border-emerald-500/20 bg-emerald-500/[0.03]" : "border-red-500/20 bg-red-500/[0.03]",
    )}>
      <div className="flex items-center gap-2">
        {approved ? (
          <>
            <Check size={12} className="text-emerald-400" />
            <span className="text-[10px] font-semibold text-emerald-400">操作已批准</span>
          </>
        ) : (
          <>
            <X size={12} className="text-red-400" />
            <span className="text-[10px] font-semibold text-red-400">
              操作被拒绝{reason ? `：${reason}` : ""}
            </span>
          </>
        )}
      </div>
    </NxCard>
  );
}
