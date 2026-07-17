import type { PanelId } from "@/stores/dock-store";
import { getDockInitialLayoutSnapshot, useDockStore } from "@/stores/dock-store";
import { useAppStore } from "@/stores/app-store";
import { getWindowConfig } from "@/components/dock/windowRegistry";
import { LEFT_DOCK_TOOL_IDS } from "@/components/layout/dock-sidebar-utils";

/** 面板是否处于打开状态（停靠或弹出） */
export function isDockPanelOpen(panelId: PanelId): boolean {
  const state = useDockStore.getState();
  if (state.layoutMode === "classic") {
    if (panelId === "target-profile" || panelId === "chat") return true;
    if (panelId.startsWith("electro-optical")) {
      return (
        panelId === "electro-optical-1" ||
        panelId === "electro-optical-2" ||
        panelId === "electro-optical-3" ||
        panelId === "electro-optical-4"
      );
    }
    if ((LEFT_DOCK_TOOL_IDS as readonly string[]).includes(panelId)) {
      const open = state.leftSidebarOpen;
      const current = state.leftPartitions.find((p) => p.id === "left-0")?.currentPanelId;
      return open && current === panelId;
    }
    return false;
  }
  const panel = state.panels.find((p) => p.id === panelId);
  return panel?.mode === "docked" || panel?.mode === "popup";
}

function normalizeMenuPartitionId(location: string): string {
  if (location === "left-default") return "left-0";
  if (location === "right-default") return "right-0";
  return location;
}

function resolvePartitionId(panelId: PanelId): string {
  const state = useDockStore.getState();
  const panel = state.panels.find((p) => p.id === panelId);
  if (panel?.location?.startsWith("left")) {
    return normalizeMenuPartitionId(panel.location);
  }
  if (panel?.location?.startsWith("right")) {
    return normalizeMenuPartitionId(panel.location);
  }

  const defaultPanel = getDockInitialLayoutSnapshot().panels.find((p) => p.id === panelId);
  if (defaultPanel?.location) return defaultPanel.location;

  const cfg = getWindowConfig(panelId);
  const loc = cfg?.defaultLocation;
  if (loc === "right-top") return "right-0";
  if (loc === "right-bottom") return "right-1";
  if (loc === "left-bottom") return "left-1";
  return "left-0";
}

/** 从顶栏菜单打开/聚焦 dock 面板 */
export function openDockPanelFromMenu(panelId: PanelId): void {
  const state = useDockStore.getState();

  if (state.layoutMode === "classic") {
    if (
      panelId === "target-profile" ||
      panelId === "chat" ||
      panelId.startsWith("electro-optical")
    ) {
      return;
    }
    if ((LEFT_DOCK_TOOL_IDS as readonly string[]).includes(panelId)) {
      state.assignPanelToPartition(panelId, "left-0");
      useDockStore.setState({ leftSidebarOpen: true });
    }
    return;
  }

  const panel = state.panels.find((p) => p.id === panelId);
  if (!panel) return;

  if (panel.mode === "popup") {
    state.bringToFront(panelId);
    return;
  }

  const partitionId = resolvePartitionId(panelId);
  const side = partitionId.startsWith("left") ? "left" : "right";

  state.assignPanelToPartition(panelId, partitionId);
  if (side === "left") {
    useDockStore.setState({ leftSidebarOpen: true });
  } else {
    useDockStore.setState({ rightSidebarOpen: true });
    if (panelId === "chat") {
      useAppStore.getState().setRightPanelTab("chat");
    }
  }
}
