import { create } from "zustand";

export type MapViewMode = "2d" | "3d";
export type LeftPanelTab = "tracks" | "assets" | "layers" | "alerts";

interface AppState {
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  leftPanelTab: LeftPanelTab;
  mapViewMode: MapViewMode;
  selectedTrackId: string | null;
  mouseCoords: { lat: number; lng: number } | null;
  zoomLevel: number;

  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setLeftPanelTab: (tab: LeftPanelTab) => void;
  setMapViewMode: (mode: MapViewMode) => void;
  selectTrack: (id: string | null) => void;
  setMouseCoords: (coords: { lat: number; lng: number } | null) => void;
  setZoomLevel: (level: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  leftSidebarOpen: true,
  rightSidebarOpen: false,
  leftPanelTab: "tracks",
  mapViewMode: "2d",
  selectedTrackId: null,
  mouseCoords: null,
  zoomLevel: 8,

  toggleLeftSidebar: () =>
    set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
  toggleRightSidebar: () =>
    set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
  setLeftPanelTab: (tab) => set({ leftPanelTab: tab }),
  setMapViewMode: (mode) => set({ mapViewMode: mode }),
  selectTrack: (id) =>
    set({ selectedTrackId: id, rightSidebarOpen: id !== null }),
  setMouseCoords: (coords) => set({ mouseCoords: coords }),
  setZoomLevel: (level) => set({ zoomLevel: level }),
}));
