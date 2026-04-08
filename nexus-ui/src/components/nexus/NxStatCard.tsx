"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export interface NxStatCardProps {
  icon?: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  trend?: "up" | "down" | "flat";
  change?: string;
  highlight?: boolean;
  className?: string;
}

export function NxStatCard({ icon, label, value, sub, trend, change, highlight, className }: NxStatCardProps) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor =
    trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : "text-nexus-text-muted";

  return (
    <div className={cn("rounded-md border border-white/[0.06] bg-white/[0.02] p-3", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {icon && <span className={highlight ? "text-orange-400" : "text-nexus-text-muted"}>{icon}</span>}
          <span className="text-[10px] text-nexus-text-muted">{label}</span>
        </div>
        {trend && change && (
          <div className={cn("flex items-center gap-0.5 text-[10px]", trendColor)}>
            <TrendIcon size={10} />
            <span>{change}</span>
          </div>
        )}
      </div>
      <div className="mt-1.5 font-mono text-xl font-bold tracking-tight text-nexus-text-primary">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-nexus-text-muted">{sub}</div>}
    </div>
  );
}
