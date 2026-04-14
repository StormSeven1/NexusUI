"use client";

import { NxCard } from "@/components/nexus";
import { cn } from "@/lib/utils";
import { ListTodo, CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";

interface TaskStep {
  index: number;
  action: string;
  status: string;
  result?: string | null;
}

interface TaskCardProps {
  taskId: string;
  title: string;
  taskType: string;
  status: string;
  steps: TaskStep[];
  progress?: string;
}

const TYPE_LABELS: Record<string, string> = {
  recon: "侦查",
  patrol: "巡逻",
  assess: "评估",
  monitor: "监控",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待执行",
  active: "执行中",
  completed: "已完成",
  failed: "失败",
};

const STEP_ICONS: Record<string, { Icon: typeof Circle; color: string }> = {
  pending:   { Icon: Circle, color: "text-zinc-500" },
  active:    { Icon: Loader2, color: "text-sky-400" },
  completed: { Icon: CheckCircle2, color: "text-emerald-400" },
  failed:    { Icon: XCircle, color: "text-red-400" },
};

export function TaskCard({ title, taskType, status, steps, progress }: TaskCardProps) {
  const completedCount = steps.filter((s) => s.status === "completed").length;
  const pct = steps.length > 0 ? (completedCount / steps.length) * 100 : 0;

  return (
    <NxCard padding="sm" className="my-1.5">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded bg-sky-500/10">
          <ListTodo size={11} className="text-sky-400" />
        </div>
        <span className="text-[10px] font-semibold tracking-wider text-nexus-text-secondary uppercase">
          {TYPE_LABELS[taskType] ?? taskType}任务
        </span>
        <span className={cn(
          "ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold",
          status === "completed" ? "bg-emerald-500/10 text-emerald-400" :
          status === "active" ? "bg-sky-500/10 text-sky-400" :
          status === "failed" ? "bg-red-500/10 text-red-400" :
          "bg-zinc-500/10 text-zinc-400"
        )}>
          {STATUS_LABELS[status] ?? status}
        </span>
      </div>

      <p className="mb-2 text-[11px] font-medium text-nexus-text-primary">{title}</p>

      {/* 进度条 */}
      <div className="mb-2">
        <div className="flex items-center justify-between text-[10px] text-nexus-text-muted">
          <span>进度</span>
          <span>{progress ?? `${completedCount}/${steps.length}`}</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-sky-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* 步骤列表 */}
      <div className="space-y-1">
        {steps.map((step) => {
          const { Icon, color } = STEP_ICONS[step.status] ?? STEP_ICONS.pending;
          const isActive = step.status === "active";
          return (
            <div key={step.index} className="flex items-start gap-1.5">
              <Icon
                size={12}
                className={cn("mt-0.5 shrink-0", color, isActive && "animate-spin")}
              />
              <div className="min-w-0 flex-1">
                <span className={cn(
                  "text-[10px]",
                  step.status === "completed" ? "text-nexus-text-secondary line-through" : "text-nexus-text-primary",
                )}>
                  {step.action}
                </span>
                {step.result && (
                  <p className="text-[9px] text-nexus-text-muted">{step.result}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </NxCard>
  );
}
