import { create } from "zustand";
import type { Track } from "@/lib/mock-data";

interface TrackState {
  tracks: Track[];
  connected: boolean;
  lastUpdate: string | null;
  setTracks: (tracks: Track[]) => void;
  setConnected: (v: boolean) => void;
  setLastUpdate: (ts: string) => void;
}

export const useTrackStore = create<TrackState>((set) => ({
  tracks: [],
  connected: false,
  lastUpdate: null,
  setTracks: (tracks) => set({ tracks }),
  setConnected: (v) => set({ connected: v }),
  setLastUpdate: (ts) => set({ lastUpdate: ts }),
}));
