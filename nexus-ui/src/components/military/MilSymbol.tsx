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

const TYPE_SHAPE_CLASS = {
  air: "rounded-sm rotate-45",
  sea: "rounded-md",
  underwater: "rounded-[40%]",
} as const;

const TYPE_ICON_CLASS = {
  air: "-rotate-45",
  sea: "",
  underwater: "",
} as const;

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
        "flex items-center justify-center border border-current/15",
        sizeClasses[size],
        TYPE_SHAPE_CLASS[type],
        DISPOSITION_BG[disposition],
        className
      )}
    >
      <Icon
        className={cn(DISPOSITION_RING[disposition], TYPE_ICON_CLASS[type])}
        size={iconSizes[size]}
      />
    </div>
  );
}
