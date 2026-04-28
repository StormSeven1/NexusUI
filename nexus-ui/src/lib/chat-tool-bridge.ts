import { useAppStore } from "@/stores/app-store";
import type { LeftPanelTab, RightPanelTab } from "@/stores/app-store";

/**
 * ============================================================================
 * chat-tool-bridge.ts：AI 工具返回的 action → 前端副作用（给新手看的说明）
 * ============================================================================
 *
 * AI 聊天里会调用「工具」（例如：让地图飞到某地）。真正算经纬度、查业务数据，
 * 一般在 **Python 后端** 里完成；算完后后端要把结果以 JSON 还给前端。
 *
 * 前端 **不会** 自动猜你要飞地图还是画线——需要约定：工具返回的 JSON 里必须带一个字段
 * **`action`**（字符串），用来表示「浏览器这边要执行哪一种界面动作」。
 *
 * 本文件就是一张 **「action 字符串 → 前端要执行的函数」** 对照表。
 * 例如 `action` 为 `"navigate_to_location"` 时，就执行下面 `sideEffects.navigate_to_location`，
 * 里面会调用 `useAppStore.getState().requestFlyTo(...)`，地图才会动。
 *
 * ----------------------------------------------------------------------------
 * 「navigate_to_location」字符串怎么和代码对应上的？
 * ----------------------------------------------------------------------------
 *
 * 下面 `sideEffects` 是一个普通 JavaScript 对象，写法等价于：
 *   { navigate_to_location: (output) => { ... }, draw_route: (output) => { ... }, ... }
 *
 * - 左边的 **键名**（如 `navigate_to_location`）必须和 JSON 里的 **`output.action`** 完全一致。
 * - `applyToolSideEffect(action, output)` 内部就是：`sideEffects[action](output)`。
 * - 若拼错一个字（例如 `Navigate_To_Location`），就找不到函数，地图不会飞（且不会报错，只是没反应）。
 *
 * ----------------------------------------------------------------------------
 * 从用户发消息到地图飞行的完整流程（简化）
 * ----------------------------------------------------------------------------
 *
 * 1. 用户在右侧 ChatPanel 输入问题 → `useChat` 发 POST 到 `/api/chat`（见 `src/app/api/chat/route.ts`）。
 * 2. Next 把请求转发到 FastAPI；模型可能触发工具调用；工具执行完后通过 SSE 把 **tool_result** 推回来。
 * 3. AI SDK 把流拼成 assistant 消息；其中某条 **tool** 片段在完成后带有 `output`（即后端返回的 result）。
 * 4. `ChatPanel.tsx` 里的 `extractCompletedTools` 会扫消息，找出 `output.action` 存在的那几条。
 * 5. 对每个工具调用只执行一次：`applyToolSideEffect(action, output)` → 进本文件的 `sideEffects[action]`。
 *
 * ----------------------------------------------------------------------------
 * 后端工具返回 JSON 示例（飞地图）
 * ----------------------------------------------------------------------------
 *
 * 工具执行结束后，请让 **result / output 对象** 长这样（字段名可再加，但 `action` 建议保留）：
 *
 * ```json
 * {
 *   "action": "navigate_to_location",
 *   "lat": 31.23,
 *   "lng": 121.47,
 *   "zoom": 12
 * }
 * ```
 *
 * 本文件里 `navigate_to_location` 对应的函数会读出 `lat`、`lng`、`zoom` 并调用 `requestFlyTo`。
 *
 * 再举一个画航线的例子（注意 `action` 换成另一个键名，就会走另一段逻辑）：
 *
 * ```json
 * {
 *   "action": "draw_route",
 *   "points": [
 *     { "lat": 31.0, "lng": 121.0 },
 *     { "lat": 31.1, "lng": 121.1 }
 *   ],
 *   "color": "#38bdf8",
 *   "label": "规划航线"
 * }
 * ```
 *
 * ----------------------------------------------------------------------------
 * 和 MCP 的关系
 * ----------------------------------------------------------------------------
 *
 * MCP 是「模型怎么连外部工具」的一套协议；本文件不管协议，只管浏览器收到 **带 action 的 JSON**
 * 之后怎么改界面。可以把它理解成：**MCP/后端链路末尾，专门负责前端 UI 的那一小截。**
 */

type ToolOutput = Record<string, unknown>;

let _routeIdSeq = 0;
let _areaIdSeq = 0;

/**
 * action 字符串 → 客户端副作用函数。
 * 键名必须与工具输出里的 `output.action` 完全一致（区分大小写）。
 */
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

  /* 写入 `app-store.drawnAreas`；颜色由工具输出决定，缺省琥珀色（与 `Map2D.commitPolyArea` 手写蓝色不同） */
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
  },

  command_asset: (output) => {
    if (!output.success) return;
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

  show_plan: () => {
    /* 执行计划在聊天面板内联渲染 */
  },

  show_approval_result: () => {
    /* 审批结果在聊天面板内联渲染 */
  },
};

/**
 * 执行与 `action` 匹配的客户端副作用。
 *
 * @param action - 与 `sideEffects` 某个键相同，通常来自工具输出里的 `output.action`
 * @param output - 该次工具返回的完整对象（除 `action` 外还可含 lat、points 等，各 handler 自己解构）
 */
export function applyToolSideEffect(action: string, output: ToolOutput) {
  const handler = sideEffects[action];
  if (handler) handler(output);
}
