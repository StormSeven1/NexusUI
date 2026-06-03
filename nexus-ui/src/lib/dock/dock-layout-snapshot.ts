import type { PanelId, PanelWindowState, DockPartition } from "@/components/dock/types";
import {
  useDockStore,
  getDockInitialLayoutSnapshot,
  mergeMissingDefaultPanels,
} from "@/stores/dock-store";
import { useAppStore } from "@/stores/app-store";

/** 与 dock-store persist partialize 同构，用于布局预设 */
export interface DockLayoutSnapshot {
  panels: PanelWindowState[];
  activePanelId: PanelId | null;
  nextZIndex: number;
  leftUpperPanelTab: PanelId;
  leftLowerPanelTab: PanelId;
  rightUpperPanelTab: PanelId;
  rightLowerPanelTab: PanelId;
  leftPartitions: DockPartition[];
  rightPartitions: DockPartition[];
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  leftSidebarSplitRatio: number;
  rightSidebarSplitRatio: number;
  leftSidebarWidth: number;
  rightSidebarWidth: number;
}

export function pickDockLayoutSnapshot(
  state: Pick<
    ReturnType<typeof useDockStore.getState>,
    | "panels"
    | "activePanelId"
    | "nextZIndex"
    | "leftUpperPanelTab"
    | "leftLowerPanelTab"
    | "rightUpperPanelTab"
    | "rightLowerPanelTab"
    | "leftPartitions"
    | "rightPartitions"
    | "leftSidebarOpen"
    | "rightSidebarOpen"
    | "leftSidebarSplitRatio"
    | "rightSidebarSplitRatio"
    | "leftSidebarWidth"
    | "rightSidebarWidth"
  >,
): DockLayoutSnapshot {
  return {
    panels: structuredClone(state.panels),
    activePanelId: state.activePanelId,
    nextZIndex: state.nextZIndex,
    leftUpperPanelTab: state.leftUpperPanelTab,
    leftLowerPanelTab: state.leftLowerPanelTab,
    rightUpperPanelTab: state.rightUpperPanelTab,
    rightLowerPanelTab: state.rightLowerPanelTab,
    leftPartitions: structuredClone(state.leftPartitions),
    rightPartitions: structuredClone(state.rightPartitions),
    leftSidebarOpen: state.leftSidebarOpen,
    rightSidebarOpen: state.rightSidebarOpen,
    leftSidebarSplitRatio: state.leftSidebarSplitRatio,
    rightSidebarSplitRatio: state.rightSidebarSplitRatio,
    leftSidebarWidth: state.leftSidebarWidth,
    rightSidebarWidth: state.rightSidebarWidth,
  };
}

export function captureDockLayoutSnapshot(): DockLayoutSnapshot {
  return pickDockLayoutSnapshot(useDockStore.getState());
}

export function getDefaultDockLayoutSnapshot(): DockLayoutSnapshot {
  return getDockInitialLayoutSnapshot();
}

function syncAppStoreFromSnapshot(snapshot: DockLayoutSnapshot) {
  useAppStore.setState({
    leftSidebarOpen: snapshot.leftSidebarOpen,
    rightSidebarOpen: snapshot.rightSidebarOpen,
  });
  const docked =
    snapshot.rightPartitions.find((p) => p.id === "right-1")?.currentPanelId ??
    snapshot.rightPartitions.find((p) => p.id === "right-0")?.currentPanelId ??
    null;
  if (docked === "chat") {
    useAppStore.setState({ rightPanelTab: "chat" });
  }
}

/** 应用布局快照（保留 panelRegistry / highlightedPanelId） */
export function applyDockLayoutSnapshot(snapshot: DockLayoutSnapshot) {
  const current = useDockStore.getState();
  const next = structuredClone(snapshot);
  useDockStore.setState({
    ...next,
    panelRegistry: current.panelRegistry,
    highlightedPanelId: null,
  });
  mergeMissingDefaultPanels();
  syncAppStoreFromSnapshot(next);
}
