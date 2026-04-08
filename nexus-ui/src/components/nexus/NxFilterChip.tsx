"use client";

import { cn } from "@/lib/utils";

export interface NxFilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  dotColor?: string;
  count?: number;
  className?: string;
}

export function NxFilterChip({ label, active, onClick, dotColor, count, className }: NxFilterChipProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors",
        active
          ? "border-white/[0.12] bg-white/[0.08] text-nexus-text-primary"
          : "border-white/[0.06] bg-white/[0.02] text-nexus-text-muted hover:bg-white/[0.04]",
        className
      )}
    >
      {dotColor && <span className={cn("h-1.5 w-1.5 rounded-full", dotColor)} />}
      {label}
      {count !== undefined && (
        <span className={cn("font-mono", active ? "text-nexus-text-secondary" : "text-nexus-text-muted/60")}>
          {count}
        </span>
      )}
    </button>
  );
}
