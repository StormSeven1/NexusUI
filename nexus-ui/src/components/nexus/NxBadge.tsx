"use client";

import { cn } from "@/lib/utils";

export type NxBadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "muted";

const VARIANT_CLASSES: Record<NxBadgeVariant, string> = {
  default: "bg-white/[0.06] text-nexus-text-secondary border-white/[0.08]",
  success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  warning: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  danger: "bg-red-500/15 text-red-400 border-red-500/30",
  info: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  muted: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

export interface NxBadgeProps {
  variant?: NxBadgeVariant;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function NxBadge({ variant = "default", dot, children, className }: NxBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider",
        VARIANT_CLASSES[variant],
        className
      )}
    >
      {dot && (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      )}
      {children}
    </span>
  );
}

export function NxStatusDot({
  status,
  animate,
  className,
}: {
  status: "online" | "warning" | "offline" | "neutral";
  animate?: boolean;
  className?: string;
}) {
  const colors = {
    online: "bg-emerald-400",
    warning: "bg-amber-400",
    offline: "bg-red-400",
    neutral: "bg-zinc-400",
  };

  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 rounded-full",
        colors[status],
        animate && "animate-blink",
        className
      )}
    />
  );
}
