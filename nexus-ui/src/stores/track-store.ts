import { create } from "zustand";
import type { Track } from "@/lib/map-entity-model";
import { maxStoredTrailPointsPerTrack } from "@/lib/ws-track-normalize";
import { filterTracksByTimeout } from "@/lib/map-app-config";
import { useDisposedStore } from "@/stores/disposed-store";

const _renderCache = new Map<string, Track>();

export function getRenderCache(): ReadonlyMap<string, Track> {
  return _renderCache;
}

interface TrackState {
  tracks: Track[];
  connected: boolean;
  lastUpdate: string | null;
  setTracks: (incoming: Track[]) => void;
  setConnected: (v: boolean) => void;
  setLastUpdate: (ts: string) => void;
  pruneStaleTracks: () => boolean;
  updateTrackImage: (showID: string, imageUrl: string | null) => boolean;
  removeDisposedTracks: (uniqueID?: string, businessTrackId?: string) => boolean;
  clearAllTracks: () => void;
}

export const useTrackStore = create<TrackState>((set, get) => ({
  tracks: [],
  connected: false,
  lastUpdate: null,

  setTracks: (incoming) => {
    const trailCap = maxStoredTrailPointsPerTrack();
    const disposedState = useDisposedStore.getState();

    for (const t of incoming) {
      if (disposedState.isTrackDisposed(t.showID)) continue;
      if (t.trackId && disposedState.isBusinessTrackDisposed(t.trackId)) continue;

      const existing = _renderCache.get(t.showID);
      if (!existing) {
        _renderCache.set(t.showID, { ...t, historyTrail: undefined });
        continue;
      }

      let historyTrail = existing.historyTrail ? [...existing.historyTrail] : [];
      const moved = existing.lat !== t.lat || existing.lng !== t.lng;
      if (moved) {
        historyTrail.push([existing.lng, existing.lat] as [number, number]);
        if (historyTrail.length > trailCap) historyTrail = historyTrail.slice(-trailCap);
      }
      _renderCache.set(t.showID, historyTrail.length ? { ...t, historyTrail } : { ...t });
    }

    set({ tracks: [..._renderCache.values()] });
  },

  setConnected: (v) => set({ connected: v }),
  setLastUpdate: (ts) => set({ lastUpdate: ts }),

  pruneStaleTracks: () => {
    const before = [..._renderCache.values()];
    const kept = filterTracksByTimeout(before);
    if (kept.length === before.length) return false;

    const keepIds = new Set(kept.map((track) => track.showID));
    for (const showID of [..._renderCache.keys()]) {
      if (!keepIds.has(showID)) {
        _renderCache.delete(showID);
      }
    }

    set({ tracks: [..._renderCache.values()] });
    return true;
  },

  updateTrackImage: (showID, imageUrl) => {
    const track = _renderCache.get(showID);
    if (!track) return false;
    if (track.verificationImage === imageUrl) return false;
    _renderCache.set(showID, { ...track, verificationImage: imageUrl ?? undefined });
    set({ tracks: [..._renderCache.values()] });
    return true;
  },

  removeDisposedTracks: (uniqueID, businessTrackId) => {
    const uid = typeof uniqueID === "string" ? uniqueID.trim() : "";
    const tid = typeof businessTrackId === "string" ? businessTrackId.trim() : "";
    let changed = false;
    for (const [showID, track] of [..._renderCache.entries()]) {
      if ((uid && showID === uid) || (tid && track.trackId === tid)) {
        _renderCache.delete(showID);
        changed = true;
      }
    }
    if (changed) set({ tracks: [..._renderCache.values()] });
    return changed;
  },

  clearAllTracks: () => {
    _renderCache.clear();
    set({ tracks: [] });
  },
}));
