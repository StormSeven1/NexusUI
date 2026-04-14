import { useAppStore } from "@/stores/app-store";
import type { LeftPanelTab, RightPanelTab } from "@/stores/app-store";

/**
 * 客户端工具副作用执行器
 * 工具的实际逻辑在服务端执行，
 * 这里仅根据工具输出的 action 字段触发对应的 UI 副作用（操作 Zustand store）。
 */

type ToolOutput = Record<string, unknown>;

let _routeIdSeq = 0;
let _areaIdSeq = 0;

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
      // 右侧仅保留 AI 助手：任何 open_panel 请求都统一落到 chat
      void panel;
      store.setRightPanelTab("chat" as RightPanelTab);
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
    const { points, color, label } = output as {
      points: Array<{ lat: number; lng: number }>;
      color?: string;
      label?: string;
    };
    if (!points?.length) return;
    useAppStore.getState().addRouteLine({
      id: `route-${++_routeIdSeq}`,
      points,
      color: (color as string) || "#38bdf8",
      label: label as string | undefined,
    });
  },

  measure_distance: () => {
    /* 纯信息型工具，无 UI 副作用 */
  },

  clear_annotations: () => {
    useAppStore.getState().clearAnnotations();
  },

  show_chart: () => {
    /* 图表在聊天面板内联渲染，无地图副作用 */
  },

  show_weather: () => {
    /* 天气卡片在聊天面板内联渲染，无地图副作用 */
  },

  query_map_context: () => {
    /* 纯信息型工具，供 LLM 空间推理使用，无 UI 副作用 */
  },

  query_assets: () => {
    /* 纯信息型工具，供 LLM 查询资产使用，无 UI 副作用 */
  },

  draw_area: (output) => {
    if (!output.success) return;
    const { zone_id, points, color, fillColor, fillOpacity, label } = output as {
      zone_id?: string;
      points: Array<{ lat: number; lng: number }>;
      color?: string;
      fillColor?: string;
      fillOpacity?: number;
      label?: string;
    };
    if (!points?.length) return;
    useAppStore.getState().addDrawnArea({
      id: zone_id ?? `area-${++_areaIdSeq}`,
      points,
      color: color ?? "#f59e0b",
      fillColor: fillColor ?? color ?? "#f59e0b",
      fillOpacity: fillOpacity ?? 0.15,
      label,
    });
    import("@/stores/zone-store").then((m) => m.useZoneStore.getState().fetchZones()).catch(() => {});
  },

  plan_route: () => {
    /* plan_route 返回 action: "draw_route"，由 draw_route handler 处理 */
  },

  // ── 新增工具副作用 ──

  show_threats: (output) => {
    if (!output.success) return;
    const threats = output.threats as Array<{ trackId: string; level: string }> | undefined;
    if (!threats?.length) return;
    const criticalIds = threats.filter((t) => t.level === "critical" || t.level === "high").map((t) => t.trackId);
    if (criticalIds.length > 0) {
      useAppStore.getState().setHighlightedTrackIds(criticalIds);
    }
  },

  assign_asset: (output) => {
    if (!output.success) return;
    import("@/stores/asset-store").then((m) => m.useAssetStore.getState().fetchAssets()).catch(() => {});
    const store = useAppStore.getState();
    store.addAgentMessage({
      agentType: "tactical",
      agentName: "战术智能体",
      title: "资产已分配",
      content: output.message as string,
      status: "success",
      read: false,
    });
  },

  recall_asset: (output) => {
    if (!output.success) return;
    import("@/stores/asset-store").then((m) => m.useAssetStore.getState().fetchAssets()).catch(() => {});
  },

  command_asset: (output) => {
    if (!output.success) return;
    import("@/stores/asset-store").then((m) => m.useAssetStore.getState().fetchAssets()).catch(() => {});
  },

  show_task: () => {
    /* 任务卡片在聊天面板内联渲染 */
  },

  get_task_status: () => {
    /* 纯信息型 */
  },

  update_task: () => {
    /* 任务卡片在聊天面板内联渲染 */
  },

  show_sensor_feed: () => {
    /* 传感器画面在聊天面板内联渲染 */
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
