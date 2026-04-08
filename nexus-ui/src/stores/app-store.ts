import { create } from "zustand";

export type MapViewMode = "2d" | "3d";
export type LeftPanelTab = "tracks" | "assets" | "layers" | "alerts";
export type RightPanelTab = "overview" | "dashboard" | "comm" | "environment" | "eventlog" | "datatable" | "chat";

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
  mapViewMode: MapViewMode;
  selectedTrackId: string | null;
  mouseCoords: { lat: number; lng: number } | null;
  zoomLevel: number;
  mapCenter: { lat: number; lng: number } | null;

  highlightedTrackIds: string[];
  routeLines: RouteLine[];
  flyToRequest: FlyToRequest | null;

  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setLeftPanelTab: (tab: LeftPanelTab) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setMapViewMode: (mode: MapViewMode) => void;
  selectTrack: (id: string | null) => void;
  setMouseCoords: (coords: { lat: number; lng: number } | null) => void;
  setZoomLevel: (level: number) => void;
  setMapCenter: (center: { lat: number; lng: number }) => void;

  setHighlightedTrackIds: (ids: string[]) => void;
  addRouteLine: (route: RouteLine) => void;
  clearAnnotations: () => void;
  requestFlyTo: (lat: number, lng: number, zoom?: number) => void;
}

let _flyToSeq = 0;

export const useAppStore = create<AppState>((set) => ({
  leftSidebarOpen: true,
  rightSidebarOpen: true,
  leftPanelTab: "tracks",
  rightPanelTab: "overview",
  mapViewMode: "2d",
  selectedTrackId: null,
  mouseCoords: null,
  zoomLevel: 8,
  mapCenter: null,

  highlightedTrackIds: [],
  routeLines: [],
  flyToRequest: null,

  toggleLeftSidebar: () =>
    set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
  toggleRightSidebar: () =>
    set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
  setLeftPanelTab: (tab) => set({ leftPanelTab: tab }),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
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
}));
