"use client";

import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";
import { BotMessageSquare } from "lucide-react";
import { ChatPanel } from "@/components/panels/ChatPanel";
import type { RightPanelTab } from "@/stores/app-store";

const TABS: { id: RightPanelTab; icon: typeof BotMessageSquare; label: string }[] = [
  { id: "chat", icon: BotMessageSquare, label: "AI 助手" },
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
        "flex h-full shrink-0 border-l border-nexus-border transition-all duration-300",
        rightSidebarOpen ? "w-[440px]" : "w-12"
      )}
      style={{ backgroundColor: rightSidebarOpen ? '#19191D' : '#19191D' }}
    >
      {/* 面板内容区 */}
      {rightSidebarOpen && (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {rightPanelTab === "chat" && <ChatPanel />}
        </div>
      )}

      {/* 图标轨道 */}
      <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-l border-nexus-border py-2" style={{ backgroundColor: '#19191D' }}>
        {TABS.map((tab) => {
          const isActive = rightPanelTab === tab.id && rightSidebarOpen;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={cn(
                "group relative flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                isActive
                  ? "bg-nexus-accent-glow text-nexus-text-primary border border-nexus-border-accent"
                  : "text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-secondary"
              )}
              title={tab.label}
            >
              <tab.icon size={18} />
              {isActive && (
                <span className="absolute right-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-l bg-nexus-accent" />
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
