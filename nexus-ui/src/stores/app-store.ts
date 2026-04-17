import { create } from "zustand";
import { ALL_DATA_LAYER_IDS } from "@/lib/map-entity-model";
import type { VectorLayerPanelItem } from "@/lib/map-2d-basemap-layer-panel";

/**
 * 全局 UI / 地图相关 Zustand 状态。
 *
 * 飞行：`requestFlyTo(lat, lng, zoom)` 写入 `flyToRequest`（不直接改 `mapCenter`）。
 * Map2D / Map3D 监听 `flyToRequest`，用 `seq` 去重后执行 `flyTo`。
 * 对话侧经 `chat-tool-bridge` 调用 `requestFlyTo`。
 *
 * 底图：Map2D 用 style（如 Carto）；Map3D 用 `UrlTemplateImageryProvider`。
 */

export type MapViewMode = "2d" | "3d";
export type LeftPanelTab = "tracks" | "assets" | "layers" | "alerts";
export type RightPanelTab = "overview" | "dashboard" | "comm" | "environment" | "eventlog" | "datatable" | "chat";
export type TopTab = "situation" | "assets" | "tasks" | "layers" | "analytics" | "search" | "settings";
export type AgentType = "core" | "data" | "tactical" | "analysis";

export interface AgentMessage {
  id: string;
  agentType: AgentType;
  agentName: string;
  title: string;
  content: string;
  timestamp: Date;
  status: "success" | "warning" | "error" | "info";
  read: boolean;
}

export interface RouteLine {
  id: string;
  points: Array<{ lat: number; lng: number }>;
  color: string;
  label?: string;
}

/**
 * 用户或工具在地图上叠加的闭合多边形（与 zone-store / WS 的「业务限制区」数据源不同，见 Map2D 中注释）。
 *
 * **颜色如何生效**：`Map2D` 在首次把条目同步为 MapLibre 图层时，把本结构里的 `color` / `fillColor` / `fillOpacity`
 * 原样写入 `paint`（线框、填充、标签字色）；之后除非改写 store 或删了重加，地图不会单独再「约束」调色。
 * - 手动画完确认：命名弹窗里可选描边/填充色与填充透明度，再 `commitPolyArea` 写入本结构。
 * - 智能体 `draw_area`：`chat-tool-bridge` 用工具返回值，缺省为琥珀色描边/填充与固定透明度。
 */
export interface DrawnArea {
  id: string;
  points: Array<{ lat: number; lng: number }>;
  /** 边线、虚线轮廓与标签 `text-color` */
  color: string;
  /** `fill-color`；可与 `color` 同系或带 alpha 的 rgba */
  fillColor: string;
  /** `fill-opacity`，与 `fillColor` 中的 alpha 相乘为最终填充透明度 */
  fillOpacity: number;
  label?: string;
}

export interface FlyToRequest {
  lat: number;
  lng: number;
  zoom?: number;
  seq: number;
}

interface AppState {
  /** 左侧边栏是否展开 */
  leftSidebarOpen: boolean;
  /** 右侧边栏是否展开 */
  rightSidebarOpen: boolean;
  /** 左侧面板当前子标签（航迹 / 资产 / 图层 / 告警等） */
  leftPanelTab: LeftPanelTab;
  /** 右侧面板当前子标签（概览 / 对话等） */
  rightPanelTab: RightPanelTab;
  /** 顶部主导航当前项 */
  topTab: TopTab;

  /** 地图视图：二维 MapLibre 或三维 Cesium */
  mapViewMode: MapViewMode;

  /** 当前选中的航迹 id（标牌、高亮等联动） */
  selectedTrackId: string | null;
  /** 当前选中的资产 id */
  selectedAssetId: string | null;

  /** 当前地图缩放级别（整数，与地图 zoomend 同步） */
  zoomLevel: number;
  /**
   * 地图中心点；`requestFlyTo` 时一并写入。
   * 相机飞行以 `flyToRequest` 为准，组件内用 `seq` 去重。
   */
  mapCenter: { lat: number; lng: number } | null;

  /** 需要高亮的多条航迹 id（如批量关注） */
  highlightedTrackIds: string[];
  /** 在地图上叠加绘制的航线列表 */
  routeLines: RouteLine[];
  /** 用户绘制的闭合区域（多边形）列表 */
  drawnAreas: DrawnArea[];

  /** 待执行的飞行请求；含 `seq`，Map2D/Map3D 消费后按序 `flyTo` */
  flyToRequest: FlyToRequest | null;

  /** 数据图层显隐，键由 `ALL_DATA_LAYER_IDS` 初始化；量算分组 `lyr-measure` 仅 Map2D 用 `?? true`，不写入此初始表 */
  layerVisibility: Record<string, boolean>;

  /**
   * 当前底图 style 名称（与 `layerVisibility` 键空间独立）。
   * 在 Map2D load 时由 parseVectorLayersForPanel → setBasemapVectorInfo 设置。
   */
  basemapStyleName: string | null;
  /** id 为 MapLibre layer.id，面板见 `map-basemap-layer-panel.ts` */
  basemapVectorLayers: VectorLayerPanelItem[];
  /** 底图矢量图层组总开关（与 `basemapVectorVisibility` 配合） */
  basemapGroupVisible: boolean;
  /** 各底图矢量子图层显隐，键为 `basemapVectorLayers[].id` */
  basemapVectorVisibility: Record<string, boolean>;

  /** 智能体 / 助手消息列表（右侧等消费） */
  agentMessages: AgentMessage[];
  /** 当前选中的单条智能体消息（详情展示） */
  selectedAgentMessage: AgentMessage | null;

  /** 切换左侧边栏展开/收起 */
  toggleLeftSidebar: () => void;
  /** 切换右侧边栏展开/收起 */
  toggleRightSidebar: () => void;
  /** 设置左侧面板子标签 */
  setLeftPanelTab: (tab: LeftPanelTab) => void;
  /** 设置右侧面板子标签 */
  setRightPanelTab: (tab: RightPanelTab) => void;
  /** 设置顶部主导航 */
  setTopTab: (tab: TopTab) => void;
  setMapViewMode: (mode: MapViewMode) => void;
  /** 设置当前选中航迹 */
  selectTrack: (id: string | null) => void;
  /** 设置当前选中资产 */
  selectAsset: (id: string | null) => void;
  /** 地图缩放变化时更新 */
  setZoomLevel: (level: number) => void;
  /** 更新地图中心（常与飞行、工具联动） */
  setMapCenter: (center: { lat: number; lng: number }) => void;

  /** 批量设置需要高亮的航迹 id */
  setHighlightedTrackIds: (ids: string[]) => void;
  /** 追加一条叠加航线 */
  addRouteLine: (route: RouteLine) => void;
  /** 追加一块用户绘制区域 */
  addDrawnArea: (area: DrawnArea) => void;
  /** 清空高亮、航线与绘制区域 */
  clearAnnotations: () => void;
  /** 请求飞行到指定经纬度；递增 `seq` 并写入 `mapCenter` */
  requestFlyTo: (lat: number, lng: number, zoom?: number) => void;

  /** 切换数据图层（`lyr-*`）显隐 */
  toggleLayerVisibility: (layerId: string) => void;
  /** Map2D load 后写入底图名称与矢量图层列表 */
  setBasemapVectorInfo: (payload: { name: string; layers: VectorLayerPanelItem[] }) => void;
  /** 切换底图矢量组总开关 */
  toggleBasemapGroupVisible: () => void;
  /** 切换单条底图矢量子图层 */
  toggleBasemapVectorLayer: (layerId: string) => void;

  /** 追加一条智能体消息（自动生成 id、时间，最多保留 50 条） */
  addAgentMessage: (message: Omit<AgentMessage, "id" | "timestamp">) => void;
  markAgentMessageAsRead: (id: string) => void;
  markAllAgentMessagesAsRead: () => void;
  clearAgentMessages: () => void;
  /** 选中某条消息以展示详情 */
  setSelectedAgentMessage: (message: AgentMessage | null) => void;
}

let _flyToSeq = 0;

export const useAppStore = create<AppState>((set) => ({
  leftSidebarOpen: true,
  rightSidebarOpen: true,
  leftPanelTab: "tracks",
  rightPanelTab: "chat",
  topTab: "situation",
  mapViewMode: "2d",
  selectedTrackId: null,
  selectedAssetId: null,
  zoomLevel: 8,
  mapCenter: null,

  highlightedTrackIds: [],
  routeLines: [],
  drawnAreas: [],
  flyToRequest: null,

  layerVisibility: Object.fromEntries(ALL_DATA_LAYER_IDS.map((id) => [id, true])),

  basemapStyleName: null,
  basemapVectorLayers: [],
  basemapGroupVisible: true,
  basemapVectorVisibility: {},

  agentMessages: [],
  selectedAgentMessage: null,

  toggleLeftSidebar: () =>
    set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
  toggleRightSidebar: () =>
    set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
  setLeftPanelTab: (tab) => set({ leftPanelTab: tab }),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  setTopTab: (tab) => set({ topTab: tab }),
  setMapViewMode: (mode) => set({ mapViewMode: mode }),
  selectTrack: (id) => set({ selectedTrackId: id }),
  selectAsset: (id) => set({ selectedAssetId: id }),
  setZoomLevel: (level) => set({ zoomLevel: level }),
  setMapCenter: (center) => set({ mapCenter: center }),

  setHighlightedTrackIds: (ids) => set({ highlightedTrackIds: ids }),
  addRouteLine: (route) =>
    set((s) => ({ routeLines: [...s.routeLines, route] })),
  addDrawnArea: (area) =>
    set((s) => ({ drawnAreas: [...s.drawnAreas, area] })),
  clearAnnotations: () =>
    set({ highlightedTrackIds: [], routeLines: [], drawnAreas: [] }),

  requestFlyTo: (lat, lng, zoom) =>
    set({ flyToRequest: { lat, lng, zoom, seq: ++_flyToSeq }, mapCenter: { lat, lng } }),

  toggleLayerVisibility: (layerId) =>
    set((s) => ({
      layerVisibility: { ...s.layerVisibility, [layerId]: !s.layerVisibility[layerId] },
    })),

  setBasemapVectorInfo: ({ name, layers }) =>
    set(() => ({
      basemapStyleName: name,
      basemapVectorLayers: layers,
      basemapVectorVisibility: Object.fromEntries(layers.map((l) => [l.id, true])),
      basemapGroupVisible: true,
    })),

  toggleBasemapGroupVisible: () =>
    set((s) => ({ basemapGroupVisible: !s.basemapGroupVisible })),

  toggleBasemapVectorLayer: (layerId) =>
    set((s) => {
      const cur = s.basemapVectorVisibility[layerId] !== false;
      const next = !cur;
      return {
        basemapVectorVisibility: { ...s.basemapVectorVisibility, [layerId]: next },
      };
    }),

  addAgentMessage: (message) =>
    set((s) => ({
      agentMessages: [
        ...s.agentMessages,
        {
          ...message,
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date(),
        },
      ].slice(-50),
    })),
  markAgentMessageAsRead: (id) =>
    set((s) => ({
      agentMessages: s.agentMessages.map((msg) =>
        msg.id === id ? { ...msg, read: true } : msg
      ),
    })),
  markAllAgentMessagesAsRead: () =>
    set((s) => ({
      agentMessages: s.agentMessages.map((msg) => ({ ...msg, read: true })),
    })),
  clearAgentMessages: () => set({ agentMessages: [] }),
  setSelectedAgentMessage: (message) => set({ selectedAgentMessage: message }),
}));
