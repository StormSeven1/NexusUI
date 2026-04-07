"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import {
  Crosshair,
  Layers,
  Search,
  BarChart3,
  Settings,
  Bell,
  User,
  Radio,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { id: "tracks", label: "航迹", icon: Crosshair },
  { id: "assets", label: "资产", icon: Radio },
  { id: "layers", label: "图层", icon: Layers },
  { id: "search", label: "搜索", icon: Search },
  { id: "analytics", label: "分析", icon: BarChart3 },
  { id: "settings", label: "设置", icon: Settings },
] as const;

export function TopToolbar() {
  const { leftSidebarOpen, toggleLeftSidebar, leftPanelTab, setLeftPanelTab } =
    useAppStore();
  const [utcTime, setUtcTime] = useState("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setUtcTime(
        now.toISOString().slice(0, 19).replace("T", " ") + " UTC"
      );
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center border-b border-white/[0.06] bg-nexus-bg-surface/90 backdrop-blur-md">
      {/* Logo + 折叠 */}
      <div className="flex h-full items-center gap-2 border-r border-white/[0.06] px-3">
        <button
          onClick={toggleLeftSidebar}
          className="flex h-7 w-7 items-center justify-center rounded text-nexus-text-secondary hover:bg-white/5 hover:text-nexus-text-primary"
        >
          {leftSidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] text-nexus-text-secondary">
            <Radar size={16} />
          </div>
          <span className="text-sm font-semibold tracking-wide text-nexus-text-primary">
            Nexus<span className="text-nexus-accent">UI</span>
          </span>
        </div>
      </div>

      {/* 导航标签 */}
      <nav className="flex h-full flex-1 items-center gap-0.5 px-2">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.id === "tracks" && leftPanelTab === "tracks" ||
            item.id === "assets" && leftPanelTab === "assets" ||
            item.id === "layers" && leftPanelTab === "layers";

          return (
            <button
              key={item.id}
              onClick={() => {
                const panelIds = ["tracks", "assets", "layers", "alerts"];
                if (panelIds.includes(item.id)) {
                  setLeftPanelTab(item.id as "tracks" | "assets" | "layers" | "alerts");
                  if (!leftSidebarOpen) toggleLeftSidebar();
                }
              }}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
                isActive
                  ? "bg-white/[0.08] text-nexus-text-primary"
                  : "text-nexus-text-muted hover:bg-white/[0.04] hover:text-nexus-text-secondary"
              )}
            >
              <item.icon size={14} />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* 时间 + 操作 */}
      <div className="flex h-full items-center gap-3 border-l border-white/[0.06] px-4">
        <span className="font-mono text-xs text-nexus-text-muted">
          {utcTime}
        </span>
        <div className="h-4 w-px bg-white/[0.06]" />
        <button className="relative flex h-7 w-7 items-center justify-center rounded text-nexus-text-muted hover:bg-white/5 hover:text-nexus-text-primary">
          <Bell size={15} />
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 animate-blink" />
        </button>
        <button className="flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-nexus-text-muted hover:bg-white/[0.08] hover:text-nexus-text-primary">
          <User size={14} />
        </button>
      </div>
    </header>
  );
}
