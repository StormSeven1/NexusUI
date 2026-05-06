"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, PanelLeftClose } from "lucide-react";
import { useDockStore } from "@/stores/dock-store";
import type { PanelId } from "@/stores/dock-store";
import { useAppStore, type LeftPanelTab } from "@/stores/app-store";
import { useAlertStore } from "@/stores/alert-store";
import { cn } from "@/lib/utils";
import { getWindowConfig } from "@/components/dock/windowRegistry";

/** Keep original 4 tools; EO appears only when docked back. */
const LEFT_TOOLS = ["tracks", "assets", "layers", "alerts"] as const satisfies readonly PanelId[];

export function DockLeftSidebar() {
  const MIN_LEFT_WIDTH = 260;
  const MAX_LEFT_WIDTH = 560;
  const leftSidebarOpen = useDockStore((s) => s.leftSidebarOpen);
  const toggleLeftSidebar = useDockStore((s) => s.toggleLeftSidebar);
  const leftPartitions = useDockStore((s) => s.leftPartitions);
  const assignPanelToPartition = useDockStore((s) => s.assignPanelToPartition);
  const adjustPartitionHeight = useDockStore((s) => s.adjustPartitionHeight);
  const leftSidebarWidth = useDockStore((s) => s.leftSidebarWidth);
  const setLeftSidebarWidth = useDockStore((s) => s.setLeftSidebarWidth);
  const handlePanelClick = useDockStore((s) => s.handlePanelClick);
  const panels = useDockStore((s) => s.panels);
  const panelRegistry = useDockStore((s) => s.panelRegistry);
  const alertTotal = useAlertStore((s) => s.alerts.length);
  const contentRef = useRef<HTMLDivElement>(null);
  const [draggingDividerFor, setDraggingDividerFor] = useState<string | null>(null);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  const modeOf = (id: PanelId) => panels.find((p) => p.id === id)?.mode;
  const isDocked = (id: PanelId) => modeOf(id) === "docked";

  const part0 = leftPartitions.find((p) => p.id === "left-0");
  const currentId = (part0?.currentPanelId ?? "tracks") as PanelId;
  const sortedPartitions = [...leftPartitions].sort((a, b) => a.index - b.index);
  const activeDockedIds = new Set(
    sortedPartitions
      .map((p) => p.currentPanelId)
      .filter((id): id is PanelId => !!id),
  );

  /** 与 app-store 同步：其它模块仍读 leftPanelTab / leftSidebarOpen */
  useEffect(() => {
    const sync = () => {
      const state = useDockStore.getState();
      const id = state.leftPartitions.find((p) => p.id === "left-0")?.currentPanelId;
      if (id && (LEFT_TOOLS as readonly string[]).includes(id)) {
        useAppStore.getState().setLeftPanelTab(id as LeftPanelTab);
      }
      if (useAppStore.getState().leftSidebarOpen !== state.leftSidebarOpen) {
        useAppStore.setState({ leftSidebarOpen: state.leftSidebarOpen });
      }
    };
    sync();
    return useDockStore.subscribe(sync);
  }, []);

  useEffect(() => {
    if (!draggingDividerFor) return;
    const onMove = (e: MouseEvent) => {
      const container = contentRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.height <= 0) return;

      const idx = sortedPartitions.findIndex((p) => p.id === draggingDividerFor);
      if (idx < 0 || idx >= sortedPartitions.length - 1) return;

      const sumBefore = sortedPartitions
        .slice(0, idx)
        .reduce((acc, p) => acc + p.heightRatio, 0);
      const cursorRatio = (e.clientY - rect.top) / rect.height;
      const newRatio = cursorRatio - sumBefore;
      adjustPartitionHeight(draggingDividerFor, newRatio);
    };
    const onUp = () => setDraggingDividerFor(null);

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [adjustPartitionHeight, draggingDividerFor, sortedPartitions]);

  useEffect(() => {
    if (!isResizingSidebar) return;
    const onMove = (e: MouseEvent) => {
      const next = Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, e.clientX));
      setLeftSidebarWidth(next);
    };
    const onUp = () => setIsResizingSidebar(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isResizingSidebar, setLeftSidebarWidth]);

  /**
   * - Docked panel in left side: click again to pop out.
   * - Otherwise: assign into its current left partition (or left-0 fallback).
   */
  const handleTabClick = (tabId: PanelId) => {
    const mode = modeOf(tabId);
    const panel = panels.find((p) => p.id === tabId);
    const leftLocation =
      panel?.location && panel.location.startsWith("left") ? panel.location : "left-0";
    if (activeDockedIds.has(tabId) && leftSidebarOpen && mode === "docked") {
      handlePanelClick(tabId);
      return;
    }
    assignPanelToPartition(tabId, leftLocation);
    useDockStore.setState({ leftSidebarOpen: true });
  };

  const hasVisiblePartition = sortedPartitions.some(
    (p) => !!p.currentPanelId && !!panelRegistry[p.currentPanelId]?.component,
  );

  return (
    <aside
      className={cn(
        "relative flex h-full shrink-0 border-r border-nexus-border transition-all duration-300",
        leftSidebarOpen ? "" : "w-12",
      )}
      style={leftSidebarOpen ? { width: `${leftSidebarWidth}px`, backgroundColor: "#19191D" } : { backgroundColor: "#19191D" }}
    >
      <div
        className="relative flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r border-nexus-border py-2"
        style={{ backgroundColor: "#19191D" }}
      >
        <div className="flex h-full w-full flex-col">
          {sortedPartitions.map((partition) => {
            const ratio = Math.max(0.08, partition.heightRatio);
            if (partition.id === "left-0") {
              const left0Current = partition.currentPanelId as PanelId | null;
              const left0Extra =
                left0Current &&
                !LEFT_TOOLS.includes(left0Current as (typeof LEFT_TOOLS)[number]) &&
                isDocked(left0Current)
                  ? [left0Current]
                  : [];
              const left0Buttons: PanelId[] = [
                ...LEFT_TOOLS.filter((tid) => isDocked(tid)),
                ...left0Extra,
              ];
              return (
                <div
                  key={partition.id}
                  className="flex min-h-0 w-full flex-col items-center gap-1 pt-1"
                  style={{ flexBasis: `${ratio * 100}%`, flexGrow: 0, flexShrink: 0 }}
                >
                  {left0Buttons.map((tid) => {
                    const cfg = getWindowConfig(tid);
                    const Icon = cfg?.icon;
                    const isActive = activeDockedIds.has(tid) && leftSidebarOpen && modeOf(tid) === "docked";
                    return (
                      <button
                        key={`${partition.id}:${tid}`}
                        type="button"
                        onClick={() => handleTabClick(tid)}
                        className={cn(
                          "group relative flex h-9 w-9 items-center justify-center rounded-md transition-all duration-200",
                          isActive
                            ? "bg-nexus-accent-glow text-nexus-text-primary"
                            : "text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-secondary",
                        )}
                        title={(cfg?.menuLabel ?? tid) + (isActive ? " · click again to pop out" : "")}
                      >
                        {Icon ? <Icon size={18} /> : null}
                        {isActive && (
                          <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-nexus-accent" />
                        )}
                        {tid === "alerts" && alertTotal > 0 && (
                          <span className="absolute -right-0.5 -top-0.5 flex min-h-3.5 min-w-3.5 items-center justify-center rounded-full bg-nexus-error px-0.5 text-[8px] font-bold leading-none text-nexus-text-inverse">
                            {alertTotal > 99 ? "99+" : alertTotal}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            }

            const tid = partition.currentPanelId as PanelId | null;
            if (!tid || !isDocked(tid)) {
              return (
                <div
                  key={partition.id}
                  className="min-h-0 w-full"
                  style={{ flexBasis: `${ratio * 100}%`, flexGrow: 0, flexShrink: 0 }}
                />
              );
            }

            const cfg = getWindowConfig(tid);
            const Icon = cfg?.icon;
            const isActive = activeDockedIds.has(tid) && leftSidebarOpen && modeOf(tid) === "docked";
            return (
              <div
                key={`${partition.id}:${tid}`}
                className="flex min-h-0 w-full items-start justify-center pt-1"
                style={{ flexBasis: `${ratio * 100}%`, flexGrow: 0, flexShrink: 0 }}
              >
                <button
                  type="button"
                  onClick={() => handleTabClick(tid)}
                  className={cn(
                    "group relative flex h-9 w-9 items-center justify-center rounded-md transition-all duration-200",
                    isActive
                      ? "bg-nexus-accent-glow text-nexus-text-primary"
                      : "text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-secondary",
                  )}
                  title={(cfg?.menuLabel ?? tid) + (isActive ? " · click again to pop out" : "")}
                >
                  {Icon ? <Icon size={18} /> : null}
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-nexus-accent" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="absolute bottom-2 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-md text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-secondary"
          title="Collapse sidebar"
          onClick={() => toggleLeftSidebar()}
        >
          <PanelLeftClose size={18} />
        </button>
      </div>

      {leftSidebarOpen && hasVisiblePartition ? (
        <div ref={contentRef} className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {sortedPartitions.map((partition, idx) => {
            const panelId = partition.currentPanelId as PanelId | null;
            const PanelComp =
              panelId && panelRegistry[panelId]?.component
                ? panelRegistry[panelId].component
                : null;
            return (
              <section
                key={partition.id}
                className={cn(
                  "flex min-h-0 min-w-0 flex-col overflow-hidden",
                  idx > 0 && "border-t border-nexus-border",
                )}
                style={{ flexBasis: `${Math.max(0.08, partition.heightRatio) * 100}%`, flexGrow: 0, flexShrink: 0 }}
              >
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-nexus-border px-2 py-1.5">
                  <span className="truncate text-xs font-medium text-nexus-text-secondary">
                    {panelId ? getWindowConfig(panelId)?.title ?? panelId : "Empty"}
                  </span>
                  {panelId ? (
                    <button
                      type="button"
                      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-nexus-accent hover:bg-nexus-bg-elevated"
                      title="Pop out"
                      onClick={() => handlePanelClick(panelId)}
                      aria-label="Pop out"
                    >
                      <ExternalLink size={14} />
                    </button>
                  ) : null}
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {PanelComp ? (
                    <PanelComp />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-nexus-text-muted">
                      Empty partition
                    </div>
                  )}
                </div>
                {idx < sortedPartitions.length - 1 ? (
                  <div
                    role="separator"
                    aria-label="Resize partitions"
                    className="h-1 cursor-row-resize bg-nexus-border/70 hover:bg-nexus-accent/70"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setDraggingDividerFor(partition.id);
                    }}
                  />
                ) : null}
              </section>
            );
          })}
        </div>
      ) : null}
      {leftSidebarOpen ? (
        <div
          role="separator"
          aria-label="Resize left sidebar"
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-nexus-accent/40"
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizingSidebar(true);
          }}
        />
      ) : null}
    </aside>
  );
}
