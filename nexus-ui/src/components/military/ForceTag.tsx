"use client";

import { cn } from "@/lib/utils";
import { FORCE_LABELS, type ForceDisposition } from "@/lib/colors";

const TAG_STYLES: Record<ForceDisposition, string> = {
  hostile: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  suspect: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  unknown: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  friendly: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  "assumed-friend": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  neutral: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

const TAG_DOT: Record<ForceDisposition, string> = {
  hostile: "bg-orange-400",
  suspect: "bg-amber-400",
  unknown: "bg-yellow-400",
  friendly: "bg-sky-400",
  "assumed-friend": "bg-emerald-400",
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
