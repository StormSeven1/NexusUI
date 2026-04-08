import { create } from "zustand";

export type MapViewMode = "2d" | "3d";
export type LeftPanelTab = "tracks" | "assets" | "layers" | "alerts";
export type RightPanelTab = "overview" | "dashboard" | "comm" | "environment" | "eventlog" | "datatable" | "chat";

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

  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setLeftPanelTab: (tab: LeftPanelTab) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setMapViewMode: (mode: MapViewMode) => void;
  selectTrack: (id: string | null) => void;
  setMouseCoords: (coords: { lat: number; lng: number } | null) => void;
  setZoomLevel: (level: number) => void;
  setMapCenter: (center: { lat: number; lng: number }) => void;
}

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
}));
