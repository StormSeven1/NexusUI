"use client";

import { cn } from "@/lib/utils";

export interface NxCardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  padding?: "none" | "sm" | "md";
  onClick?: () => void;
}

export function NxCard({ children, className, hover, padding = "md", onClick }: NxCardProps) {
  const paddings = { none: "", sm: "p-2.5", md: "p-3" };
  const Comp = onClick ? "button" : "div";

  return (
    <Comp
      onClick={onClick}
      className={cn(
        "rounded-md border border-white/[0.06] bg-white/[0.02]",
        paddings[padding],
        hover && "transition-colors hover:border-white/[0.10] hover:bg-white/[0.04]",
        onClick && "w-full text-left cursor-pointer",
        className
      )}
    >
      {children}
    </Comp>
  );
}

export function NxSectionHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h4 className={cn("text-[10px] font-semibold tracking-widest text-nexus-text-muted", className)}>
      {children}
    </h4>
  );
}

export function NxPanelHeader({
  title,
  right,
  className,
}: {
  title: string;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between border-b border-white/[0.06] p-3", className)}>
      <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">{title}</span>
      {right}
    </div>
  );
}
