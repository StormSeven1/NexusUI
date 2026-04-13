import { create } from "zustand";

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

export interface FlyToRequest {
  lat: number;
  lng: number;
  zoom?: number;
  /** 每次请求递增，用于区分同坐标的多次飞行 */
  seq: number;
}

interface AppState {
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  leftPanelTab: LeftPanelTab;
  rightPanelTab: RightPanelTab;
  topTab: TopTab;
  mapViewMode: MapViewMode;
  selectedTrackId: string | null;
  mouseCoords: { lat: number; lng: number } | null;
  zoomLevel: number;
  mapCenter: { lat: number; lng: number } | null;

  highlightedTrackIds: string[];
  routeLines: RouteLine[];
  flyToRequest: FlyToRequest | null;

  // 智能体行为相关
  agentMessages: AgentMessage[];
  selectedAgentMessage: AgentMessage | null;

  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setLeftPanelTab: (tab: LeftPanelTab) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setTopTab: (tab: TopTab) => void;
  setMapViewMode: (mode: MapViewMode) => void;
  selectTrack: (id: string | null) => void;
  setMouseCoords: (coords: { lat: number; lng: number } | null) => void;
  setZoomLevel: (level: number) => void;
  setMapCenter: (center: { lat: number; lng: number }) => void;

  setHighlightedTrackIds: (ids: string[]) => void;
  addRouteLine: (route: RouteLine) => void;
  clearAnnotations: () => void;
  requestFlyTo: (lat: number, lng: number, zoom?: number) => void;

  // 智能体行为方法
  addAgentMessage: (message: Omit<AgentMessage, "id" | "timestamp">) => void;
  markAgentMessageAsRead: (id: string) => void;
  markAllAgentMessagesAsRead: () => void;
  clearAgentMessages: () => void;
  setSelectedAgentMessage: (message: AgentMessage | null) => void;
}

let _flyToSeq = 0;

export const useAppStore = create<AppState>((set) => ({
  leftSidebarOpen: true,
  rightSidebarOpen: true,
  leftPanelTab: "tracks",
  rightPanelTab: "overview",
  topTab: "situation",
  mapViewMode: "2d",
  selectedTrackId: null,
  mouseCoords: null,
  zoomLevel: 8,
  mapCenter: null,

  highlightedTrackIds: [],
  routeLines: [],
  flyToRequest: null,

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
  setMouseCoords: (coords) => set({ mouseCoords: coords }),
  setZoomLevel: (level) => set({ zoomLevel: level }),
  setMapCenter: (center) => set({ mapCenter: center }),

  setHighlightedTrackIds: (ids) => set({ highlightedTrackIds: ids }),
  addRouteLine: (route) =>
    set((s) => ({ routeLines: [...s.routeLines, route] })),
  clearAnnotations: () =>
    set({ highlightedTrackIds: [], routeLines: [] }),
  requestFlyTo: (lat, lng, zoom) =>
    set({ flyToRequest: { lat, lng, zoom, seq: ++_flyToSeq }, mapCenter: { lat, lng } }),

  // 智能体行为方法
  addAgentMessage: (message) =>
    set((s) => ({
      agentMessages: [
        ...s.agentMessages,
        {
          ...message,
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date(),
        },
      ].slice(-50), // 保留最新的50条消息
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
