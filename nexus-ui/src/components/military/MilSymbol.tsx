"use client";

import { cn } from "@/lib/utils";
import type { ForceDisposition } from "@/lib/colors";
import { Plane, Ship, Anchor } from "lucide-react";

const ICON_MAP = {
  air: Plane,
  sea: Ship,
  underwater: Anchor,
} as const;

const DISPOSITION_RING: Record<ForceDisposition, string> = {
  hostile: "text-blue-400",
  friendly: "text-orange-400",
  neutral: "border-zinc-400 text-zinc-400",
};

const DISPOSITION_BG: Record<ForceDisposition, string> = {
  hostile: "bg-blue-400/10",
  friendly: "bg-orange-400/10",
  neutral: "bg-zinc-400/10",
};

interface MilSymbolProps {
  type: "air" | "sea" | "underwater";
  disposition: ForceDisposition;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function MilSymbol({ type, disposition, size = "md", className }: MilSymbolProps) {
  const Icon = ICON_MAP[type];
  const sizeClasses = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-10 w-10",
  };
  const iconSizes = { sm: 12, md: 16, lg: 20 };

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded",
        sizeClasses[size],
        DISPOSITION_BG[disposition],
        className
      )}
    >
      <Icon className={DISPOSITION_RING[disposition]} size={iconSizes[size]} />
    </div>
  );
}
