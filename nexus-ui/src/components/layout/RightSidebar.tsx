"use client";

import { useEffect } from "react";
import { BotMessageSquare } from "lucide-react";
import type { ComponentType } from "react";

import { ChatPanel } from "@/components/panels/ChatPanel";
import { TaskPanel } from "@/components/panels/TaskPanel";
import { cn } from "@/lib/utils";
import { useAppStore, type RightPanelTab } from "@/stores/app-store";

type TabIcon = ComponentType<{ size?: number; className?: string }>;

function TaskPlanIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block bg-current", className)}
      style={{
        width: size,
        height: size,
        mask: 'url("/icons/任务方案.svg") center / contain no-repeat',
        WebkitMask: 'url("/icons/任务方案.svg") center / contain no-repeat',
      }}
    />
  );
}

const TABS: { id: RightPanelTab; icon: TabIcon; label: string }[] = [
  { id: "chat", icon: BotMessageSquare, label: "AI 助手" },
  { id: "taskPanel", icon: TaskPlanIcon, label: "任务面板" },
];

export function RightSidebar() {
  const {
    rightSidebarOpen,
    toggleRightSidebar,
    rightPanelTab,
    setRightPanelTab,
    taskPanelHasNewPlan,
    setTaskPanelHasNewPlan,
  } = useAppStore();

  const handleTabClick = (tabId: RightPanelTab) => {
    if (tabId === "taskPanel") setTaskPanelHasNewPlan(false);
    if (rightPanelTab === tabId && rightSidebarOpen) {
      toggleRightSidebar();
    } else {
      setRightPanelTab(tabId);
      if (!rightSidebarOpen) toggleRightSidebar();
    }
  };

  useEffect(() => {
    const onCurrentPlanUpdated = () => {
      if (rightPanelTab !== "taskPanel" || !rightSidebarOpen) {
        setTaskPanelHasNewPlan(true);
      }
    };
    window.addEventListener("current-disposal-plan-updated", onCurrentPlanUpdated);
    return () => window.removeEventListener("current-disposal-plan-updated", onCurrentPlanUpdated);
  }, [rightPanelTab, rightSidebarOpen, setTaskPanelHasNewPlan]);

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 border-l border-nexus-border transition-all duration-300",
        rightSidebarOpen ? "w-[440px]" : "w-12",
      )}
      style={{ backgroundColor: "#19191D" }}
    >
      {rightSidebarOpen && (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {rightPanelTab === "chat" && <ChatPanel />}
          {rightPanelTab === "taskPanel" && <TaskPanel />}
        </div>
      )}

      <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-l border-nexus-border py-2" style={{ backgroundColor: "#19191D" }}>
        {TABS.map((tab) => {
          const isActive = rightPanelTab === tab.id && rightSidebarOpen;
          const hasNewPlan = tab.id === "taskPanel" && taskPanelHasNewPlan && !isActive;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={cn(
                "group relative flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                isActive
                  ? "border border-nexus-border-accent bg-nexus-accent-glow text-nexus-text-primary"
                  : "text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-secondary",
                hasNewPlan && "animate-pulse border border-amber-400/50 bg-amber-400/10 text-amber-300",
              )}
              title={tab.label}
            >
              <tab.icon size={18} />
              {hasNewPlan && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)]" />
              )}
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
