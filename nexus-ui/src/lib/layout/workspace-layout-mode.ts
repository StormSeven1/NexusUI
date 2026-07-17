import { toast } from "sonner";
import type { DockLayoutSnapshot } from "@/lib/dock/dock-layout-snapshot";
import {
  applyDockLayoutSnapshot,
  captureDockLayoutSnapshot,
} from "@/lib/dock/dock-layout-snapshot";
import type { WorkspaceLayoutMode } from "@/lib/layout/classic-layout-config";
import {
  CLASSIC_MAIN_EO_PANEL_ID,
  CLASSIC_RIGHT_DEFAULT_ROW_RATIO,
  classicRightWidthFromRow,
} from "@/lib/layout/classic-layout-config";
import { useDockStore } from "@/stores/dock-store";
import { useEoVideoPanelFocusStore } from "@/stores/eo-video-panel-focus-store";

const MODE_LABEL: Record<WorkspaceLayoutMode, string> = {
  free: "自由布局",
  classic: "经典布局",
};

function estimateClassicRowWidth(): number {
  if (typeof window === "undefined") return 1600;
  const state = useDockStore.getState();
  const leftW = state.leftSidebarOpen ? state.leftSidebarWidth : 48;
  return Math.max(800, window.innerWidth - leftW);
}

/** 切换工作区布局模式；切到经典时保存当前自由布局快照，切回时恢复 */
export function setWorkspaceLayoutMode(mode: WorkspaceLayoutMode): void {
  const state = useDockStore.getState();
  if (state.layoutMode === mode) return;

  if (mode === "classic") {
    const snapshot = captureDockLayoutSnapshot();
    const rowWidth = estimateClassicRowWidth();
    const ratio = state.classicRightWidthRatio || CLASSIC_RIGHT_DEFAULT_ROW_RATIO;
    useDockStore.setState({
      layoutMode: "classic",
      freeLayoutSnapshot: snapshot,
      leftSidebarOpen: false,
      classicRightWidthRatio: ratio,
      rightSidebarWidth: classicRightWidthFromRow(rowWidth, ratio),
    });
    useEoVideoPanelFocusStore.getState().setFocusedDockPanel(CLASSIC_MAIN_EO_PANEL_ID);
    toast.success(`已切换为${MODE_LABEL.classic}`);
    return;
  }

  const saved: DockLayoutSnapshot | null = state.freeLayoutSnapshot;
  useDockStore.setState({ layoutMode: "free", freeLayoutSnapshot: null });
  if (saved) {
    applyDockLayoutSnapshot(saved);
  }
  toast.success(`已切换为${MODE_LABEL.free}`);
}
