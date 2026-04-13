"use client";

import { useAppStore } from "@/stores/app-store";
import {
  Map,
  Package,
  ClipboardList,
  BarChart3,
  FolderOpen,
  Search,
  Settings
} from "lucide-react";
import { cn } from "@/lib/utils";

// 顶部Tab配置
const TOP_TABS = [
  {
    id: "situation" as const,
    label: "态势",
    icon: Map,
    description: "战场态势与目标监控"
  },
  {
    id: "assets" as const,
    label: "资产",
    icon: Package,
    description: "物资与装备管理"
  },
  {
    id: "tasks" as const,
    label: "任务",
    icon: ClipboardList,
    description: "任务规划与执行"
  },
  {
    id: "layers" as const,
    label: "图层",
    icon: FolderOpen,
    description: "图层管理与显示"
  },
  {
    id: "analytics" as const,
    label: "分析",
    icon: BarChart3,
    description: "数据分析与可视化"
  },
  {
    id: "search" as const,
    label: "搜索",
    icon: Search,
    description: "全局搜索功能"
  },
  {
    id: "settings" as const,
    label: "设置",
    icon: Settings,
    description: "系统设置与配置"
  },
] as const;

export function TopNav() {
  const { topTab, setTopTab } = useAppStore();

  // 点击Tab的处理函数
  const handleTabClick = (tabId: typeof topTab) => {
    setTopTab(tabId);
  };

  return (
    <header
      className="flex h-12 shrink-0 items-center border-b border-nexus-border"
      style={{ backgroundColor: "#2F2F3A" }}
    >
      {/* Logo + 左侧折叠按钮 */}
      <div className="flex h-full items-center gap-2 border-r border-nexus-border px-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md nexus-glass text-nexus-text-primary">
            <Map size={16} />
          </div>
          <span className="text-sm font-semibold tracking-wide nexus-text-gradient">
            Nexus<span className="text-nexus-text-secondary">UI</span>
          </span>
        </div>
      </div>

      {/* 主要导航标签 - 4个主要tab */}
      <nav className="flex h-full flex-1 items-center gap-0.5 px-2">
        {TOP_TABS.slice(0, 4).map((tab) => {
          const isActive = topTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={cn(
                "group relative flex h-full items-center gap-2 px-4 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-nexus-accent-glow text-nexus-text-primary border-b-2 border-nexus-accent"
                  : "text-nexus-text-muted hover:bg-white/5 hover:text-nexus-text-secondary"
              )}
              title={tab.description}
            >
              <tab.icon size={16} />
              <span>{tab.label}</span>

            </button>
          );
        })}
      </nav>

      {/* 3个图标tab */}
      <div className="flex h-full items-center gap-2 px-3">
        {TOP_TABS.slice(4).map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
              topTab === tab.id
                ? "bg-nexus-accent-glow text-nexus-text-primary"
                : "text-nexus-text-muted hover:bg-white/10 hover:text-nexus-text-secondary"
            )}
            title={tab.description}
          >
            <tab.icon size={14} />
          </button>
        ))}
      </div>

      {/* 右侧功能区 */}
      <div className="flex h-full items-center gap-3 border-l border-nexus-border px-4">
        {/* 时间显示 */}
        <div className="font-mono text-xs text-nexus-text-secondary">
          12:00:00 UTC
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
