"use client";

import { NxCard } from "@/components/nexus";
import { cn } from "@/lib/utils";
import {
  Circle, Loader2, CheckCircle2, XCircle, Ban,
  ListChecks,
} from "lucide-react";

export interface PlanStep {
  index: number;
  toolName: string;
  label: string;
  status: "pending" | "running" | "done" | "error" | "rejected";
  result?: string;
}

export interface AgentPlanCardProps {
  planId: string;
  steps: PlanStep[];
  currentStep: number;
}

const STEP_ICONS: Record<string, { Icon: typeof Circle; color: string; animate?: string }> = {
  pending:  { Icon: Circle, color: "text-zinc-500" },
  running:  { Icon: Loader2, color: "text-sky-400", animate: "animate-spin" },
  done:     { Icon: CheckCircle2, color: "text-emerald-400" },
  error:    { Icon: XCircle, color: "text-red-400" },
  rejected: { Icon: Ban, color: "text-amber-400" },
};

export function AgentPlanCard({ steps, currentStep }: AgentPlanCardProps) {
  const completedCount = steps.filter((s) => s.status === "done").length;
  const totalSteps = steps.length;
  const pct = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0;
  const allDone = completedCount === totalSteps && totalSteps > 0;
  const hasError = steps.some((s) => s.status === "error" || s.status === "rejected");

  return (
    <NxCard padding="sm" className="my-1.5">
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded bg-sky-500/10">
          <ListChecks size={11} className="text-sky-400" />
        </div>
        <span className="text-[10px] font-semibold tracking-wider text-nexus-text-secondary uppercase">
          执行计划
        </span>
        <span className="ml-auto text-[10px] text-nexus-text-muted">
          {completedCount}/{totalSteps}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            hasError ? "bg-amber-400" : allDone ? "bg-emerald-400" : "bg-sky-400",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Steps */}
      <div className="space-y-1">
        {steps.map((step) => {
          const style = STEP_ICONS[step.status] ?? STEP_ICONS.pending;
          const Icon = style.Icon;
          const isCurrent = step.index === currentStep && step.status === "running";

          return (
            <div
              key={step.index}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1 transition-colors",
                isCurrent && "bg-sky-500/5",
              )}
            >
              <Icon
                size={12}
                className={cn("shrink-0", style.color, style.animate)}
              />
              <span className={cn(
                "flex-1 text-[10px]",
                step.status === "done" ? "text-nexus-text-secondary" :
                step.status === "running" ? "text-nexus-text-primary font-medium" :
                step.status === "error" || step.status === "rejected" ? "text-red-400" :
                "text-nexus-text-muted",
              )}>
                {step.label}
              </span>
              {step.result && step.status !== "pending" && step.status !== "running" && (
                <span className="max-w-[120px] truncate text-[9px] text-nexus-text-muted">
                  {step.result}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </NxCard>
  );
}
