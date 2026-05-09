"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Map,
  BarChart3,
  Settings
} from "lucide-react";

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

export function TopNav() {

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZoneName: "short",
      }),
    []
  );

  const [nowLabel, setNowLabel] = useState<string>("");

  useEffect(() => {
    // 避免 SSR/CSR 首屏时间不一致导致 hydration mismatch：
    // 首屏渲染时先输出占位符，挂载后再异步更新真实时间。
    // Avoid hydration mismatch by rendering a placeholder on first paint, then updating async after mount.
    const update = () => setNowLabel(formatNowLabel(new Date(), timeFormatter));

    const t0 = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 1000);
    return () => {
      window.clearTimeout(t0);
      window.clearInterval(timer);
    };
  }, [timeFormatter]);

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
