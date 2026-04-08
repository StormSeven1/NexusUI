import { useAppStore } from "@/stores/app-store";
import type { LeftPanelTab, RightPanelTab } from "@/stores/app-store";

/**
 * 客户端工具副作用执行器
 * 工具的实际逻辑在服务端执行（route.ts 中 tool.execute），
 * 这里仅根据工具输出的 action 字段触发对应的 UI 副作用（操作 Zustand store）。
 */

type ToolOutput = Record<string, unknown>;

const sideEffects: Record<string, (output: ToolOutput) => void> = {
  navigate_to_location: (output) => {
    const { lat, lng, zoom } = output as { lat: number; lng: number; zoom?: number };
    const store = useAppStore.getState();
    store.setMapCenter({ lat, lng });
    if (zoom) store.setZoomLevel(zoom);
  },

  select_track: (output) => {
    if (!output.success) return;
    const { trackId, track } = output as { trackId: string; track?: { lat: number; lng: number } };
    const store = useAppStore.getState();
    store.selectTrack(trackId);
    if (track) store.setMapCenter({ lat: track.lat, lng: track.lng });
  },

  switch_map_mode: (output) => {
    const { mode } = output as { mode: "2d" | "3d" };
    useAppStore.getState().setMapViewMode(mode);
  },

  open_panel: (output) => {
    const { panel, side } = output as { panel: string; side: "left" | "right" };
    const store = useAppStore.getState();
    if (side === "right") {
      store.setRightPanelTab(panel as RightPanelTab);
      if (!store.rightSidebarOpen) store.toggleRightSidebar();
    } else {
      store.setLeftPanelTab(panel as LeftPanelTab);
      if (!store.leftSidebarOpen) store.toggleLeftSidebar();
    }
  },
};

/**
 * 根据工具输出的 action 字段执行对应的客户端副作用
 */
export function applyToolSideEffect(action: string, output: ToolOutput) {
  const handler = sideEffects[action];
  if (handler) handler(output);
}
