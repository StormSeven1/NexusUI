"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useDockStore, type PanelId } from "@/stores/dock-store";
import { cn } from "@/lib/utils";
import { BotMessageSquare, Circle, ExternalLink, ScanLine } from "lucide-react";
import type { RightPanelTab } from "@/stores/app-store";
import { getWindowConfig } from "@/components/dock/windowRegistry";
import { dockedPanelsInPartition, RIGHT_DOCK_TOOL_IDS } from "@/components/layout/dock-sidebar-utils";
import {
  isElectroOpticalDockPanel,
  useEoVideoPanelFocusStore,
} from "@/stores/eo-video-panel-focus-store";
import { EoVideoSmartWindowToggle } from "@/components/eo-video/EoVideoSmartWindowToggle";

/** 右侧竖条：上目标档案、下系统评估 + 智能助手（与 `rightPartitions` 顺序一致） */
const RIGHT_TOOLS = RIGHT_DOCK_TOOL_IDS;
const rightToolSet = new Set<string>(RIGHT_TOOLS);

export function RightSidebar() {
  const MIN_RIGHT_WIDTH = 360;
  const MAX_RIGHT_WIDTH = 720;
  const rightSidebarOpen = useDockStore((s) => s.rightSidebarOpen);
  const toggleRightSidebar = useDockStore((s) => s.toggleRightSidebar);
  const rightSidebarWidth = useDockStore((s) => s.rightSidebarWidth);
  const setRightSidebarWidth = useDockStore((s) => s.setRightSidebarWidth);
  const rightPartitions = useDockStore((s) => s.rightPartitions);
  const adjustPartitionHeight = useDockStore((s) => s.adjustPartitionHeight);
  const assignPanelToPartition = useDockStore((s) => s.assignPanelToPartition);
  const handlePanelClick = useDockStore((s) => s.handlePanelClick);
  const panelRegistry = useDockStore((s) => s.panelRegistry);
  const panels = useDockStore((s) => s.panels);
  const eoFocusedDockId = useEoVideoPanelFocusStore((s) => s.focusedDockPanelId);
  const setEoFocusedDockPanel = useEoVideoPanelFocusStore((s) => s.setFocusedDockPanel);

  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [draggingDividerFor, setDraggingDividerFor] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const modeOf = (id: PanelId) => panels.find((p) => p.id === id)?.mode;

  useEffect(() => {
    const sync = () => {
      const state = useDockStore.getState();
      if (useAppStore.getState().rightSidebarOpen !== state.rightSidebarOpen) {
        useAppStore.setState({ rightSidebarOpen: state.rightSidebarOpen });
      }
      const docked =
        state.rightPartitions.find((p) => p.id === "right-1")?.currentPanelId ??
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

  useEffect(() => {
    if (!draggingDividerFor) return;
    const onMove = (e: MouseEvent) => {
      const container = contentRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.height <= 0) return;

      const sorted = [...rightPartitions].sort((a, b) => a.index - b.index);
      const idx = sorted.findIndex((p) => p.id === draggingDividerFor);
      if (idx < 0 || idx >= sorted.length - 1) return;

      const sumBefore = sorted.slice(0, idx).reduce((acc, p) => acc + p.heightRatio, 0);
      const cursorRatio = (e.clientY - rect.top) / rect.height;
      adjustPartitionHeight(draggingDividerFor, cursorRatio - sumBefore);
    };
    const onUp = () => setDraggingDividerFor(null);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [draggingDividerFor, rightPartitions, adjustPartitionHeight]);

  const sortedPartitions = [...rightPartitions].sort((a, b) => a.index - b.index);
  const activeDockedIds = new Set(
    sortedPartitions.map((p) => p.currentPanelId).filter((id): id is PanelId => !!id),
  );

  const handleRightToolClick = (tabId: PanelId) => {
    const mode = modeOf(tabId);
    const panel = panels.find((p) => p.id === tabId);
    const rightLocation =
      panel?.location && panel.location.startsWith("right")
        ? panel.location
        : tabId === "target-profile"
          ? "right-0"
          : "right-1";
    if (activeDockedIds.has(tabId) && rightSidebarOpen && mode === "docked") {
      handlePanelClick(tabId);
      return;
    }
    assignPanelToPartition(tabId, rightLocation);
    useDockStore.setState({ rightSidebarOpen: true });
    if (tabId === "chat") setRightPanelTab("chat" as RightPanelTab);
  };

  const hasVisiblePartition = sortedPartitions.some((p) => {
    const cid = p.currentPanelId;
    if (cid && panelRegistry[cid]?.component) return true;
    return dockedPanelsInPartition(panels, p.id).some((row) => !!panelRegistry[row.id]?.component);
  });

  return (
    <aside
      className={cn(
        "relative flex h-full shrink-0 border-l border-nexus-border transition-all duration-300",
        rightSidebarOpen ? "" : "w-12",
      )}
      style={
        rightSidebarOpen
          ? { width: `${rightSidebarWidth}px`, backgroundColor: "#19191D" }
          : { backgroundColor: "#19191D" }
      }
    >
      {rightSidebarOpen && hasVisiblePartition ? (
        <div ref={contentRef} className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {sortedPartitions.map((partition, idx) => {
            const panelId = partition.currentPanelId as PanelId | null;
            const PanelComp =
              panelId && panelRegistry[panelId]?.component ? panelRegistry[panelId].component : null;
            const eoDocked = panelId ? isElectroOpticalDockPanel(panelId) : false;
            const showDockHeader = panelId && !panelId.startsWith("electro-optical");
            const eoSidebarBarSelected = eoDocked && eoFocusedDockId === panelId;

            return (
              <section
                key={partition.id}
                className={cn(
                  "flex min-h-0 min-w-0 flex-col overflow-hidden",
                  idx > 0 && "border-t border-nexus-border",
                )}
                style={{
                  flexBasis: `${Math.max(0.08, partition.heightRatio) * 100}%`,
                  flexGrow: 0,
                  flexShrink: 0,
                }}
              >
                {eoDocked ? (
                  <div
                    className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-black/35 px-2 py-2"
                    onPointerDown={() => panelId && setEoFocusedDockPanel(panelId)}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {eoSidebarBarSelected ? (
                        <span className="shrink-0 text-sky-400" title="当前选中的光电窗口">
                          <Circle className="size-2.5 fill-current" strokeWidth={0} aria-hidden />
                        </span>
                      ) : (
                        <span className="inline-block w-2.5 shrink-0 opacity-0" aria-hidden />
                      )}
                      <span className="truncate text-xs font-medium text-nexus-text-secondary">
                        {panelId ? getWindowConfig(panelId)?.title ?? panelId : ""}
                      </span>
                    </div>
                    {panelId ? (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <EoVideoSmartWindowToggle panelId={panelId} />
                        <button
                          type="button"
                          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-nexus-accent hover:bg-nexus-bg-elevated"
                          title="弹出为独立窗口"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePanelClick(panelId);
                          }}
                          aria-label="弹出为独立窗口"
                        >
                          <ExternalLink size={14} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : showDockHeader && panelId ? (
                  <div className="flex shrink-0 items-center justify-between gap-2 border-b border-nexus-border px-2 py-1.5">
                    <span className="truncate text-xs font-medium text-nexus-text-secondary">
                      {getWindowConfig(panelId)?.title ?? panelId}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-nexus-accent hover:bg-nexus-bg-elevated"
                      title="Pop out"
                      onClick={() => handlePanelClick(panelId)}
                      aria-label="Pop out"
                    >
                      <ExternalLink size={14} />
                    </button>
                  </div>
                ) : null}
                <div
                  className="min-h-0 flex-1 overflow-hidden"
                  onPointerDownCapture={() => {
                    if (panelId && eoDocked) setEoFocusedDockPanel(panelId);
                  }}
                >
                  {PanelComp ? <PanelComp /> : null}
                </div>
                {idx < sortedPartitions.length - 1 ? (
                  <div
                    role="separator"
                    aria-label="Resize right sidebar partitions"
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

      <div
        className="flex w-12 shrink-0 flex-col items-center gap-1 border-l border-nexus-border py-2"
        style={{ backgroundColor: "#19191D" }}
      >
        <div className="flex h-full w-full flex-col">
          {sortedPartitions.map((partition) => {
            const ratio = Math.max(0.08, partition.heightRatio);
            const dockedHere = dockedPanelsInPartition(panels, partition.id);
            if (dockedHere.length === 0) {
              return (
                <div
                  key={partition.id}
                  className="min-h-0 w-full"
                  style={{ flexBasis: `${ratio * 100}%`, flexGrow: 0, flexShrink: 0 }}
                />
              );
            }
            const dockedIds = new Set(dockedHere.map((p) => p.id));
            const rightExtras = dockedHere
              .map((p) => p.id)
              .filter((id) => !rightToolSet.has(id));
            const rightButtons: PanelId[] = [
              ...RIGHT_TOOLS.filter((tid) => dockedIds.has(tid)),
              ...rightExtras,
            ];
            return (
              <div
                key={partition.id}
                className="flex min-h-0 w-full flex-col items-center justify-start gap-1 pt-1"
                style={{ flexBasis: `${ratio * 100}%`, flexGrow: 0, flexShrink: 0 }}
              >
                {rightButtons.map((tid) => {
                  const cfg = getWindowConfig(tid);
                  const Icon = tid === "target-profile" ? ScanLine : (cfg?.icon ?? BotMessageSquare);
                  const isActive =
                    partition.currentPanelId === tid &&
                    rightSidebarOpen &&
                    modeOf(tid) === "docked";
                  return (
                    <button
                      key={`${partition.id}:${tid}`}
                      type="button"
                      onClick={() => handleRightToolClick(tid)}
                      className={cn(
                        "group relative flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                        isActive
                          ? "border border-nexus-border-accent bg-nexus-accent-glow text-nexus-text-primary"
                          : "text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-secondary",
                      )}
                      title={(cfg?.menuLabel ?? tid) + (isActive ? " · 再点弹出" : "")}
                    >
                      <Icon size={18} />
                      {isActive && (
                        <span className="absolute right-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-l bg-nexus-accent" />
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
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
