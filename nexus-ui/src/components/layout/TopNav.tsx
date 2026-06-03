"use client";

import { useEffect, useState } from "react";
import {
  Map,
  BarChart3,
  Settings
} from "lucide-react";
import { useDisposalPlanStore, type DisposalRunMode } from "@/stores/disposal-plan-store";
import { cn } from "@/lib/utils";

/**
 * 获取当前时间的展示文本（本地时间 + 时区）。
 * Get a human-readable clock label (local time + timezone).
 *
 * @param now - 当前时间 / Current time
 * @param formatter - Intl 时间格式化器 / Intl time formatter
 * @returns 格式化后的时间字符串 / Formatted time string
 */
function formatNowLabel(now: Date, formatter: Intl.DateTimeFormat): string {
  return formatter.format(now);
}

const DISPOSAL_MODE_OPTIONS: Array<{ mode: DisposalRunMode; label: string }> = [
  { mode: "auto", label: "全自动处置" },
  { mode: "manual", label: "半自动处置" },
];

export function TopNav() {
  const runMode = useDisposalPlanStore((s) => s.runMode);
  const setRunMode = useDisposalPlanStore((s) => s.setRunMode);

  const [nowLabel, setNowLabel] = useState<string>("");

  useEffect(() => {
    const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "short",
    });
    // 避免 SSR/CSR 首屏时间不一致导致 hydration mismatch：
    // 首屏渲染时先输出占位符，挂载后再异步更新真实时间。
    // Avoid hydration mismatch by rendering a placeholder on first paint, then updating async after mount.
    const update = () => {
      const nextLabel = formatNowLabel(new Date(), timeFormatter);
      setNowLabel((prev) => (prev === nextLabel ? prev : nextLabel));
    };

    const t0 = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 1000);
    return () => {
      window.clearTimeout(t0);
      window.clearInterval(timer);
    };
  }, []);

  return (
    <header
      className="flex h-8 shrink-0 items-center border-b border-nexus-border"
      style={{ backgroundColor: "#2F2F3A" }}
    >
      {/* Logo */}
      <div className="flex h-full items-center gap-2 border-r border-nexus-border px-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md nexus-glass text-nexus-text-primary">
            <Map size={16} />
          </div>
          <span className="text-sm font-semibold tracking-wide nexus-text-gradient">
            作战管理<span className="text-nexus-text-secondary">系统</span>
          </span>
        </div>
      </div>

      {/* 中间留空 */}
      <div className="flex-1" />

      {/* 右侧功能区 */}
      <div className="flex h-full items-center gap-3 border-l border-nexus-border px-4">
        <div className="flex items-center gap-1 rounded border border-white/[0.08] bg-black/10 p-0.5">
          {DISPOSAL_MODE_OPTIONS.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              onClick={() => setRunMode(mode)}
              className={cn(
                "h-5 rounded px-2 text-[10px] font-medium transition-colors",
                runMode === mode
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-nexus-text-muted hover:bg-white/[0.06] hover:text-nexus-text-secondary",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 时间显示 */}
        <div
          className="font-mono text-xs text-nexus-text-secondary"
          aria-label="local-time"
        >
          {nowLabel || "--:--:--"}
        </div>

        {/* 通知和用户 */}
        <div className="h-4 w-px bg-nexus-border" />
        <button className="relative flex h-7 w-7 items-center justify-center rounded text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-primary transition-colors">
          <BarChart3 size={15} />
        </button>
        <button className="flex h-7 w-7 items-center justify-center rounded-full border border-nexus-border bg-nexus-glass text-nexus-text-muted hover:bg-nexus-accent hover:text-nexus-text-primary transition-all">
          <Settings size={14} />
        </button>
      </div>
    </header>
  );
}
