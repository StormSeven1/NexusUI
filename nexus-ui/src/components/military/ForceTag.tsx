"use client";

import { cn } from "@/lib/utils";
import { FORCE_LABELS, type ForceDisposition } from "@/lib/colors";

const TAG_STYLES: Record<ForceDisposition, string> = {
  hostile: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  friendly: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  neutral: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

const TAG_DOT: Record<ForceDisposition, string> = {
  hostile: "bg-blue-400",
  friendly: "bg-orange-400",
  neutral: "bg-zinc-400",
};

interface ForceTagProps {
  disposition: ForceDisposition;
  className?: string;
  showDot?: boolean;
}

export function ForceTag({ disposition, className, showDot = true }: ForceTagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider",
        TAG_STYLES[disposition],
        className
      )}
    >
      {showDot && (
        <span className={cn("h-1.5 w-1.5 rounded-full", TAG_DOT[disposition])} />
      )}
      {FORCE_LABELS[disposition]}
    </span>
  );
}
