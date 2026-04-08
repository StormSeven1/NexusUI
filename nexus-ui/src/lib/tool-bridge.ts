import { useAppStore } from "@/stores/app-store";
import { MOCK_TRACKS } from "@/lib/mock-data";
import type { LeftPanelTab, RightPanelTab } from "@/stores/app-store";

/**
 * 前端工具注册表：LLM tool call 在客户端直接执行的操作集合。
 * 每个工具返回一个 JSON-serializable 结果供 LLM 后续推理使用。
 */

export interface ToolDefinition {
  execute: (params: Record<string, unknown>) => unknown;
}

const toolRegistry: Record<string, ToolDefinition> = {
  navigate_to_location: {
    execute: (params) => {
      const { lat, lng, zoom } = params as { lat: number; lng: number; zoom?: number };
      const store = useAppStore.getState();
      store.setMapCenter({ lat, lng });
      if (zoom) store.setZoomLevel(zoom);
      return { success: true, message: `已导航至 ${lat.toFixed(4)}, ${lng.toFixed(4)}${zoom ? `，缩放级别 ${zoom}` : ""}` };
    },
  },

  select_track: {
    execute: (params) => {
      const { trackId } = params as { trackId: string };
      const track = MOCK_TRACKS.find((t) => t.id === trackId);
      if (!track) {
        return { success: false, message: `未找到目标 ${trackId}` };
      }
      const store = useAppStore.getState();
      store.selectTrack(trackId);
      store.setMapCenter({ lat: track.lat, lng: track.lng });
      return {
        success: true,
        message: `已选中 ${track.name} (${trackId})`,
        track: {
          id: track.id,
          name: track.name,
          type: track.type,
          disposition: track.disposition,
          lat: track.lat,
          lng: track.lng,
          speed: track.speed,
          heading: track.heading,
        },
      };
    },
  },

  switch_map_mode: {
    execute: (params) => {
      const { mode } = params as { mode: "2d" | "3d" };
      useAppStore.getState().setMapViewMode(mode);
      return { success: true, message: `地图已切换至 ${mode.toUpperCase()} 模式` };
    },
  },

  open_panel: {
    execute: (params) => {
      const { panel, side } = params as { panel: string; side: "left" | "right" };
      const store = useAppStore.getState();
      if (side === "right") {
        store.setRightPanelTab(panel as RightPanelTab);
        if (!store.rightSidebarOpen) store.toggleRightSidebar();
      } else {
        store.setLeftPanelTab(panel as LeftPanelTab);
        if (!store.leftSidebarOpen) store.toggleLeftSidebar();
      }
      return { success: true, message: `已打开${side === "right" ? "右侧" : "左侧"}面板: ${panel}` };
    },
  },

  query_tracks: {
    execute: (params) => {
      const { type, disposition } = params as { type?: string; disposition?: string };
      let tracks = MOCK_TRACKS;
      if (type && type !== "all") {
        tracks = tracks.filter((t) => t.type === type);
      }
      if (disposition && disposition !== "all") {
        tracks = tracks.filter((t) => t.disposition === disposition);
      }
      return {
        success: true,
        count: tracks.length,
        tracks: tracks.map((t) => ({
          id: t.id,
          name: t.name,
          type: t.type,
          disposition: t.disposition,
          lat: t.lat,
          lng: t.lng,
          speed: t.speed,
          heading: t.heading,
        })),
      };
    },
  },
};

/**
 * 执行前端工具调用，由 useChat 的 onToolCall 回调触发
 */
export function executeClientTool(toolName: string, args: Record<string, unknown>): unknown {
  const tool = toolRegistry[toolName];
  if (!tool) return { success: false, message: `未知工具: ${toolName}` };
  return tool.execute(args);
}
