"use client";

import { cn } from "@/lib/utils";
import type { ForceDisposition } from "@/lib/colors";
import { Plane, Car, Ship, HelpCircle } from "lucide-react";

const ICON_MAP = {
  air: Plane,
  ground: Car,
  sea: Ship,
  unknown: HelpCircle,
} as const;

const DISPOSITION_RING: Record<ForceDisposition, string> = {
  hostile: "border-orange-400 text-orange-400",
  suspect: "border-amber-400 text-amber-400",
  unknown: "border-yellow-400 text-yellow-400",
  friendly: "border-sky-400 text-sky-400",
  "assumed-friend": "border-emerald-400 text-emerald-400",
  neutral: "border-zinc-400 text-zinc-400",
};

const DISPOSITION_BG: Record<ForceDisposition, string> = {
  hostile: "bg-orange-400/10",
  suspect: "bg-amber-400/10",
  unknown: "bg-yellow-400/10",
  friendly: "bg-sky-400/10",
  "assumed-friend": "bg-emerald-400/10",
  neutral: "bg-zinc-400/10",
};

interface MilSymbolProps {
  type: "air" | "ground" | "sea" | "unknown";
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
        "flex items-center justify-center rounded border-2",
        sizeClasses[size],
        DISPOSITION_RING[disposition],
        DISPOSITION_BG[disposition],
        className
      )}
    >
      <Icon size={iconSizes[size]} />
    </div>
  );
}
