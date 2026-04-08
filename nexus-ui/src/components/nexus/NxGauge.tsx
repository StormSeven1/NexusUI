"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function useAnimatedValue(target: number, duration = 1500) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let start: number | null = null;
    const initial = value;
    const animate = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      setValue(initial + (target - initial) * easeOut(p));
      if (p < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [target]);
  return value;
}

export interface NxGaugeProps {
  value: number;
  max?: number;
  label: string;
  icon?: React.ReactNode;
  ringColor?: string;
  className?: string;
}

export function NxGauge({ value, max = 100, label, icon, ringColor = "stroke-white/30", className }: NxGaugeProps) {
  const animValue = useAnimatedValue(value);
  const pct = animValue / max;
  const circumference = 2 * Math.PI * 36;
  const offset = circumference - pct * circumference;

  return (
    <div className={cn("flex flex-col items-center rounded-md border border-white/[0.06] bg-white/[0.02] p-3", className)}>
      <div className="relative h-20 w-20">
        <svg className="h-20 w-20 -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="36" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="4" />
          <circle
            cx="40" cy="40" r="36" fill="none"
            className={ringColor}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 1.5s ease-out" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {icon}
          <span className="mt-0.5 font-mono text-lg font-bold text-nexus-text-primary">
            {Math.round(animValue)}
          </span>
        </div>
      </div>
      <span className="mt-1.5 text-[10px] text-nexus-text-muted">{label}</span>
    </div>
  );
}

export interface NxProgressProps {
  value: number;
  max?: number;
  color?: string;
  className?: string;
}

export function NxProgress({ value, max = 100, color = "bg-white/30", className }: NxProgressProps) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-white/[0.04]", className)}>
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}
