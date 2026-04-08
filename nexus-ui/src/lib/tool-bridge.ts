import { useAppStore } from "@/stores/app-store";
import type { LeftPanelTab, RightPanelTab } from "@/stores/app-store";

/**
 * 客户端工具副作用执行器
 * 工具的实际逻辑在服务端执行，
 * 这里仅根据工具输出的 action 字段触发对应的 UI 副作用（操作 Zustand store）。
 */

type ToolOutput = Record<string, unknown>;

let _routeIdSeq = 0;

const sideEffects: Record<string, (output: ToolOutput) => void> = {
  navigate_to_location: (output) => {
    const { lat, lng, zoom } = output as { lat: number; lng: number; zoom?: number };
    useAppStore.getState().requestFlyTo(lat, lng, zoom);
  },

  select_track: (output) => {
    if (!output.success) return;
    const { trackId, track } = output as { trackId: string; track?: { lat: number; lng: number } };
    const store = useAppStore.getState();
    store.selectTrack(trackId);
    if (track) store.requestFlyTo(track.lat, track.lng);
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

  highlight_tracks: (output) => {
    const { trackIds } = output as { trackIds: string[] };
    useAppStore.getState().setHighlightedTrackIds(trackIds ?? []);
  },

  fly_to_track: (output) => {
    if (!output.success) return;
    const { trackId, lat, lng, zoom } = output as { trackId: string; lat: number; lng: number; zoom?: number };
    const store = useAppStore.getState();
    store.selectTrack(trackId);
    store.requestFlyTo(lat, lng, zoom);
  },

  draw_route: (output) => {
    if (!output.success) return;
    const { points, color, label } = output as {
      points: Array<{ lat: number; lng: number }>;
      color?: string;
      label?: string;
    };
    useAppStore.getState().addRouteLine({
      id: `route-${++_routeIdSeq}`,
      points,
      color: (color as string) || "#38bdf8",
      label: label as string | undefined,
    });
  },

  measure_distance: () => {
    /* 纯信息型工具，无 UI 副作用 — 结果由 LLM 回复展示 */
  },

  clear_annotations: () => {
    useAppStore.getState().clearAnnotations();
  },
};

/**
 * 根据工具输出的 action 字段执行对应的客户端副作用
 */
export function applyToolSideEffect(action: string, output: ToolOutput) {
  const handler = sideEffects[action];
  if (handler) handler(output);
}

/**
 * 兼容旧命名：早期版本使用 executeClientTool
 * @deprecated 请使用 applyToolSideEffect
 */
export const executeClientTool = applyToolSideEffect;
