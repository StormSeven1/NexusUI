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
  updateTrackImage: (targetID: string, imageUrl: string | null) => boolean;
  removeDisposedTracks: (targetID?: string, businessExternalTargetId?: string) => boolean;
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
      if (disposedState.isTrackDisposed(t.targetID)) continue;
      if (t.external_target_id && disposedState.isBusinessTrackDisposed(t.external_target_id)) continue;

      const existing = _renderCache.get(t.targetID);
      if (!existing) {
        _renderCache.set(t.targetID, { ...t, historyTrail: undefined });
        continue;
      }

      let historyTrail = existing.historyTrail ? [...existing.historyTrail] : [];
      const moved = existing.lat !== t.lat || existing.lng !== t.lng;
      if (moved) {
        historyTrail.push([existing.lng, existing.lat] as [number, number]);
        if (historyTrail.length > trailCap) historyTrail = historyTrail.slice(-trailCap);
      }
      _renderCache.set(t.targetID, historyTrail.length ? { ...t, historyTrail } : { ...t });
    }

    set({ tracks: [..._renderCache.values()] });
  },

  setConnected: (v) => set({ connected: v }),
  setLastUpdate: (ts) => set({ lastUpdate: ts }),

  pruneStaleTracks: () => {
    const before = [..._renderCache.values()];
    const kept = filterTracksByTimeout(before);
    if (kept.length === before.length) return false;

    const keepIds = new Set(kept.map((track) => track.targetID));
    for (const targetID of [..._renderCache.keys()]) {
      if (!keepIds.has(targetID)) {
        _renderCache.delete(targetID);
      }
    }

    set({ tracks: [..._renderCache.values()] });
    return true;
  },

  updateTrackImage: (targetID, imageUrl) => {
    const track = _renderCache.get(targetID);
    if (!track) return false;
    if (track.verificationImage === imageUrl) return false;
    _renderCache.set(targetID, { ...track, verificationImage: imageUrl ?? undefined });
    set({ tracks: [..._renderCache.values()] });
    return true;
  },

  removeDisposedTracks: (targetID, businessExternalTargetId) => {
    const targetKey = typeof targetID === "string" ? targetID.trim() : "";
    const externalKey = typeof businessExternalTargetId === "string" ? businessExternalTargetId.trim() : "";
    let changed = false;
    for (const [targetID, track] of [..._renderCache.entries()]) {
      if ((targetKey && targetID === targetKey) || (externalKey && track.external_target_id === externalKey)) {
        _renderCache.delete(targetID);
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
