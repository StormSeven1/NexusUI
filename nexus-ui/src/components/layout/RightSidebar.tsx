"use client";

import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Gauge,
  MessageSquare,
  CloudSun,
  ScrollText,
  Table2,
  BotMessageSquare,
} from "lucide-react";
import { SituationOverview } from "@/components/panels/SituationOverview";
import { DashboardPanel } from "@/components/panels/DashboardPanel";
import { CommPanel } from "@/components/panels/CommPanel";
import { EnvironmentPanel } from "@/components/panels/EnvironmentPanel";
import { EventLogPanel } from "@/components/panels/EventLogPanel";
import { DataTablePanel } from "@/components/panels/DataTablePanel";
import { ChatPanel } from "@/components/panels/ChatPanel";
import type { RightPanelTab } from "@/stores/app-store";

const TABS: { id: RightPanelTab; icon: typeof LayoutDashboard; label: string }[] = [
  { id: "chat", icon: BotMessageSquare, label: "AI 助手" },
  { id: "overview", icon: LayoutDashboard, label: "概览" },
  { id: "dashboard", icon: Gauge, label: "仪表" },
  { id: "comm", icon: MessageSquare, label: "通信" },
  { id: "environment", icon: CloudSun, label: "环境" },
  { id: "eventlog", icon: ScrollText, label: "日志" },
  { id: "datatable", icon: Table2, label: "数据" },
];

export function RightSidebar() {
  const { rightSidebarOpen, toggleRightSidebar, rightPanelTab, setRightPanelTab } = useAppStore();

  const handleTabClick = (tabId: RightPanelTab) => {
    if (rightPanelTab === tabId && rightSidebarOpen) {
      toggleRightSidebar();
    } else {
      setRightPanelTab(tabId);
      if (!rightSidebarOpen) toggleRightSidebar();
    }
  };

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 border-l border-white/[0.06] bg-nexus-bg-surface/90 backdrop-blur-md transition-all duration-300",
        rightSidebarOpen ? "w-[360px]" : "w-12"
      )}
    >
      {/* 面板内容区 */}
      {rightSidebarOpen && (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {rightPanelTab === "chat" && <ChatPanel />}
          {rightPanelTab === "overview" && <SituationOverview />}
          {rightPanelTab === "dashboard" && <DashboardPanel />}
          {rightPanelTab === "comm" && <CommPanel />}
          {rightPanelTab === "environment" && <EnvironmentPanel />}
          {rightPanelTab === "eventlog" && <EventLogPanel />}
          {rightPanelTab === "datatable" && <DataTablePanel />}
        </div>
      )}

      {/* 图标轨道 */}
      <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-l border-white/[0.06] py-2">
        {TABS.map((tab) => {
          const isActive = rightPanelTab === tab.id && rightSidebarOpen;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={cn(
                "group relative flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                isActive
                  ? "bg-white/[0.08] text-nexus-text-primary"
                  : "text-nexus-text-muted hover:bg-white/[0.04] hover:text-nexus-text-secondary"
              )}
              title={tab.label}
            >
              <tab.icon size={18} />
              {isActive && (
                <span className="absolute right-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-l bg-nexus-text-primary" />
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
