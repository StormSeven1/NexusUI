import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { ALL_DATA_LAYER_IDS, LYR_DB_AREAS, LYR_RADAR_COVERAGE } from "@/lib/map-entity-model";
import type { VectorLayerPanelItem } from "@/lib/map-2d-basemap-layer-panel";
import type { RasterLayerPanelItem } from "@/lib/map-2d-raster-layers";

/**
 * app-store — 全局 UI / 地图相关 Zustand 状态
 *
 * 【导航状态】
 *   - topTab: 顶部主 Tab（态势/资产/任务/图层/分析/搜索/设置）
 *   - leftPanelTab: 左面板子 Tab（航迹/资产/图层/告警）
 *   - rightPanelTab: 右面板子 Tab（概览/仪表/通信/环境/日志/数据/对话）
 *   - mapViewMode: 地图模式（2d/3d）
 *
 * 【航迹选中与高亮】
 *   - selectedTrackId: 当前选中的航迹 showID（属性框展示用）
 *   - highlightedTrackIds: 高亮航迹 ID 列表（地图上特殊渲染）
 *   - selectTrack(id): 设置选中+高亮，传 null 清除
 *   - 消灭操作后：若当前选中的是被消灭航迹 → selectTrack(null)
 *
 * 【地图飞行】
 *   - requestFlyTo(lat, lng, zoom): 写入 flyToRequest（不直接改 mapCenter）
 *   - Map2D / Map3D 监听 flyToRequest，用 seq 去重后执行 flyTo
 *   - 对话侧经 chat-tool-bridge 调用 requestFlyTo
 *
 * 【地图标注】
 *   - routeLines: 航路/路线标注
 *   - clearAnnotations(): 清除高亮与路线标注
 *
 * 【底图】
 *   - Map2D 用 style（如 Carto）；Map3D 用 UrlTemplateImageryProvider
 */

export type MapViewMode = "2d" | "3d";
export type LeftPanelTab = "tracks" | "assets" | "layers" | "alerts" | "track-display";
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

  /**
   * 日常查证（与 Qt 顶栏 + `ThreatListTable::sendDailyHandleTask` 对齐）：
   * 开启时 POST `http.chat.quickWorkflowUrl` 启动 `auto_duty_workflow-quick-1`（可配），
   * 关闭时对 `dailyVerificationThreadIds` 依次 POST `…/workflows/{threadId}/terminate`。
   */
  dailyVerificationEnabled: boolean;
  /** 当前会话内已启动的日常查证 thread_id 列表（用于终止；不入持久化） */
  dailyVerificationThreadIds: string[];

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
  /** 可选栅格 XYZ 底图（图层面板与矢量底图并列） */
  basemapRasterLayers: RasterLayerPanelItem[];
  /** 各栅格底图显隐，键为 `basemapRasterLayers[].id` */
  basemapRasterVisibility: Record<string, boolean>;

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
  setDailyVerificationEnabled: (enabled: boolean) => void;
  pushDailyVerificationThreadId: (id: string) => void;
  clearDailyVerificationThreads: () => void;
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
  /** 清空高亮与航线标注 */
  clearAnnotations: () => void;
  /** 请求飞行到指定经纬度；递增 `seq` 并写入 `mapCenter` */
  requestFlyTo: (lat: number, lng: number, zoom?: number) => void;

  /** 切换数据图层（`lyr-*`）显隐 */
  toggleLayerVisibility: (layerId: string) => void;
  /** 设置数据图层显隐 */
  setLayerVisibility: (layerId: string, visible: boolean) => void;
  /** Map2D load 后写入底图名称与矢量图层列表 */
  setBasemapVectorInfo: (payload: { name: string; layers: VectorLayerPanelItem[] }) => void;
  /** 切换底图矢量组总开关 */
  toggleBasemapGroupVisible: () => void;
  /** 设置底图矢量组总开关 */
  setBasemapGroupVisible: (visible: boolean) => void;
  /** 批量设置底图矢量子图层显隐 */
  setBasemapVectorLayersVisible: (visible: boolean, layerIds?: string[]) => void;
  /** 切换单条底图矢量子图层 */
  toggleBasemapVectorLayer: (layerId: string) => void;
  /** Map2D load 后写入栅格底图列表与默认显隐 */
  setBasemapRasterInfo: (payload: {
    layers: RasterLayerPanelItem[];
    defaultVisibility: Record<string, boolean>;
  }) => void;
  /** 切换单条栅格底图 */
  toggleBasemapRasterLayer: (layerId: string) => void;
  /** 设置单条栅格底图显隐 */
  setBasemapRasterLayerVisible: (layerId: string, visible: boolean) => void;

  /** 追加一条智能体消息（自动生成 id、时间，最多保留 50 条） */
  addAgentMessage: (message: Omit<AgentMessage, "id" | "timestamp">) => void;
  markAgentMessageAsRead: (id: string) => void;
  markAllAgentMessagesAsRead: () => void;
  clearAgentMessages: () => void;
  /** 选中某条消息以展示详情 */
  setSelectedAgentMessage: (message: AgentMessage | null) => void;
}

let _flyToSeq = 0;

const MAP_LAYER_PREFS_STORAGE_KEY = "nexus-ui-map-layer-preferences-v1";

function defaultLayerVisibilityRecord(): Record<string, boolean> {
  const record = Object.fromEntries(ALL_DATA_LAYER_IDS.map((id) => [id, true]));
  record[LYR_DB_AREAS] = false;
  record[LYR_RADAR_COVERAGE] = false;
  return record;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
  leftSidebarOpen: true,
  rightSidebarOpen: true,
  leftPanelTab: "tracks",
  rightPanelTab: "chat",
  topTab: "situation",
  dailyVerificationEnabled: false,
  dailyVerificationThreadIds: [],
  mapViewMode: "2d",
  selectedTrackId: null,
  selectedAssetId: null,
  zoomLevel: 8,
  mapCenter: null,

  highlightedTrackIds: [],
  routeLines: [],
  flyToRequest: null,

  layerVisibility: defaultLayerVisibilityRecord(),

  basemapStyleName: null,
  basemapVectorLayers: [],
  basemapGroupVisible: true,
  basemapVectorVisibility: {},
  basemapRasterLayers: [],
  basemapRasterVisibility: {},

  agentMessages: [],
  selectedAgentMessage: null,

  toggleLeftSidebar: () =>
    set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
  toggleRightSidebar: () =>
    set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
  setLeftPanelTab: (tab) => set({ leftPanelTab: tab }),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  setTopTab: (tab) => set({ topTab: tab }),
  setDailyVerificationEnabled: (enabled) => set({ dailyVerificationEnabled: enabled }),
  pushDailyVerificationThreadId: (id) =>
    set((s) => ({
      dailyVerificationThreadIds: id.trim() ? [...s.dailyVerificationThreadIds, id.trim()] : s.dailyVerificationThreadIds,
    })),
  clearDailyVerificationThreads: () => set({ dailyVerificationThreadIds: [] }),
  setMapViewMode: (mode) => set({ mapViewMode: mode }),
  selectTrack: (id) => set({ selectedTrackId: id, highlightedTrackIds: id ? [id] : [] }),
  selectAsset: (id) => set({ selectedAssetId: id }),
  setZoomLevel: (level) => set({ zoomLevel: level }),
  setMapCenter: (center) => set({ mapCenter: center }),

  setHighlightedTrackIds: (ids) => set({ highlightedTrackIds: ids }),
  addRouteLine: (route) =>
    set((s) => ({ routeLines: [...s.routeLines, route] })),
  clearAnnotations: () =>
    set({ highlightedTrackIds: [], routeLines: [] }),

  requestFlyTo: (lat, lng, zoom) =>
    set({ flyToRequest: { lat, lng, zoom, seq: ++_flyToSeq }, mapCenter: { lat, lng } }),

  toggleLayerVisibility: (layerId) =>
    set((s) => ({
      layerVisibility: { ...s.layerVisibility, [layerId]: !s.layerVisibility[layerId] },
    })),

  setLayerVisibility: (layerId, visible) =>
    set((s) => ({
      layerVisibility: { ...s.layerVisibility, [layerId]: visible },
    })),

  setBasemapVectorInfo: ({ name, layers }) =>
    set((s) => {
      const prev = s.basemapVectorVisibility;
      const nextVis: Record<string, boolean> = {};
      for (const l of layers) {
        nextVis[l.id] = prev[l.id] !== false;
      }
      return {
        basemapStyleName: name,
        basemapVectorLayers: layers,
        basemapVectorVisibility: nextVis,
        basemapGroupVisible: s.basemapGroupVisible,
      };
    }),

  toggleBasemapGroupVisible: () =>
    set((s) => ({ basemapGroupVisible: !s.basemapGroupVisible })),

  setBasemapGroupVisible: (visible) => set({ basemapGroupVisible: visible }),

  setBasemapVectorLayersVisible: (visible, layerIds) =>
    set((s) => {
      const ids = layerIds ?? s.basemapVectorLayers.map((l) => l.id);
      const next = { ...s.basemapVectorVisibility };
      for (const id of ids) next[id] = visible;
      return { basemapVectorVisibility: next };
    }),

  toggleBasemapVectorLayer: (layerId) =>
    set((s) => {
      const cur = s.basemapVectorVisibility[layerId] !== false;
      const next = !cur;
      return {
        basemapVectorVisibility: { ...s.basemapVectorVisibility, [layerId]: next },
      };
    }),

  setBasemapRasterInfo: ({ layers, defaultVisibility }) =>
    set((s) => {
      const prev = s.basemapRasterVisibility;
      const nextVis: Record<string, boolean> = {};
      for (const l of layers) {
        nextVis[l.id] = prev[l.id] ?? defaultVisibility[l.id] ?? false;
      }
      return {
        basemapRasterLayers: layers,
        basemapRasterVisibility: nextVis,
      };
    }),

  toggleBasemapRasterLayer: (layerId) =>
    set((s) => {
      const cur = s.basemapRasterVisibility[layerId] !== false;
      return {
        basemapRasterVisibility: { ...s.basemapRasterVisibility, [layerId]: !cur },
      };
    }),

  setBasemapRasterLayerVisible: (layerId, visible) =>
    set((s) => ({
      basemapRasterVisibility: { ...s.basemapRasterVisibility, [layerId]: visible },
    })),

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
    }),
    {
      name: MAP_LAYER_PREFS_STORAGE_KEY,
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            }
          : window.localStorage,
      ),
      partialize: (s) => ({
        layerVisibility: s.layerVisibility,
        basemapGroupVisible: s.basemapGroupVisible,
        basemapVectorVisibility: s.basemapVectorVisibility,
        basemapRasterVisibility: s.basemapRasterVisibility,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<
          Pick<
            AppState,
            "layerVisibility" | "basemapGroupVisible" | "basemapVectorVisibility" | "basemapRasterVisibility"
          >
        >;
        return {
          ...current,
          layerVisibility: {
            ...defaultLayerVisibilityRecord(),
            ...(p.layerVisibility ?? {}),
          },
          basemapGroupVisible: p.basemapGroupVisible ?? current.basemapGroupVisible,
          basemapVectorVisibility: {
            ...current.basemapVectorVisibility,
            ...(p.basemapVectorVisibility ?? {}),
          },
          basemapRasterVisibility: {
            ...current.basemapRasterVisibility,
            ...(p.basemapRasterVisibility ?? {}),
          },
        };
      },
    },
  ),
);
