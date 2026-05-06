"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useDockStore, type PanelId } from "@/stores/dock-store";
import { cn } from "@/lib/utils";
import { BotMessageSquare, ExternalLink } from "lucide-react";
import type { RightPanelTab } from "@/stores/app-store";
import { getWindowConfig } from "@/components/dock/windowRegistry";

const TABS: { id: RightPanelTab; icon: typeof BotMessageSquare; label: string }[] = [
  { id: "chat", icon: BotMessageSquare, label: "AI Assistant" },
];

export function RightSidebar() {
  const MIN_RIGHT_WIDTH = 360;
  const MAX_RIGHT_WIDTH = 720;
  const rightSidebarOpen = useDockStore((s) => s.rightSidebarOpen);
  const toggleRightSidebar = useDockStore((s) => s.toggleRightSidebar);
  const rightSidebarWidth = useDockStore((s) => s.rightSidebarWidth);
  const setRightSidebarWidth = useDockStore((s) => s.setRightSidebarWidth);
  const rightPartitions = useDockStore((s) => s.rightPartitions);
  const assignPanelToPartition = useDockStore((s) => s.assignPanelToPartition);
  const handlePanelClick = useDockStore((s) => s.handlePanelClick);
  const panelRegistry = useDockStore((s) => s.panelRegistry);

  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  useEffect(() => {
    const sync = () => {
      const state = useDockStore.getState();
      if (useAppStore.getState().rightSidebarOpen !== state.rightSidebarOpen) {
        useAppStore.setState({ rightSidebarOpen: state.rightSidebarOpen });
      }
      const docked =
        state.rightPartitions.find((p) => p.id === "right-0")?.currentPanelId ??
        null;
      if (docked === "chat") {
        useAppStore.setState({ rightPanelTab: "chat" });
      }
    };
    sync();
    return useDockStore.subscribe(sync);
  }, []);

  useEffect(() => {
    if (!isResizingSidebar) return;
    const onMove = (e: MouseEvent) => {
      const width = window.innerWidth - e.clientX;
      const next = Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, width));
      setRightSidebarWidth(next);
    };
    const onUp = () => setIsResizingSidebar(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isResizingSidebar, setRightSidebarWidth]);

  const part0 = rightPartitions.find((p) => p.id === "right-0");
  const dockedId = (part0?.currentPanelId ?? "chat") as PanelId;
  const Active =
    dockedId && panelRegistry[dockedId]?.component
      ? panelRegistry[dockedId].component
      : null;

  const handleChatTabClick = () => {
    if (dockedId === "chat" && rightSidebarOpen) {
      toggleRightSidebar();
      return;
    }
    assignPanelToPartition("chat", "right-0");
    useDockStore.setState({ rightSidebarOpen: true });
    setRightPanelTab("chat");
  };

  const showDockHeader = !dockedId.startsWith("electro-optical");

  return (
    <aside
      className={cn(
        "relative flex h-full shrink-0 border-l border-nexus-border transition-all duration-300",
        rightSidebarOpen ? "" : "w-12",
      )}
      style={rightSidebarOpen ? { width: `${rightSidebarWidth}px`, backgroundColor: "#19191D" } : { backgroundColor: "#19191D" }}
    >
      {rightSidebarOpen && Active ? (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {showDockHeader ? (
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-nexus-border px-2 py-1.5">
              <span className="truncate text-xs font-medium text-nexus-text-secondary">
                {getWindowConfig(dockedId)?.title ?? dockedId}
              </span>
              <button
                type="button"
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-nexus-accent hover:bg-nexus-bg-elevated"
                title="Pop out"
                onClick={() => handlePanelClick(dockedId)}
                aria-label="Pop out"
              >
                <ExternalLink size={14} />
              </button>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-hidden">
            <Active />
          </div>
        </div>
      ) : null}

      <div
        className="flex w-12 shrink-0 flex-col items-center gap-1 border-l border-nexus-border py-2"
        style={{ backgroundColor: "#19191D" }}
      >
        {TABS.map((tab) => {
          const isActive = dockedId === "chat" && rightSidebarOpen && tab.id === "chat";
          return (
            <button
              key={tab.id}
              type="button"
              onClick={handleChatTabClick}
              className={cn(
                "group relative flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                isActive
                  ? "border border-nexus-border-accent bg-nexus-accent-glow text-nexus-text-primary"
                  : "text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-secondary",
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
      {rightSidebarOpen ? (
        <div
          role="separator"
          aria-label="Resize right sidebar"
          className="absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-nexus-accent/40"
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizingSidebar(true);
          }}
        />
      ) : null}
    </aside>
  );
}
