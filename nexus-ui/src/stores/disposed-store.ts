import { create } from "zustand";

interface DisposedState {
  disposedTargetIDs: Set<string>;
  disposedBusinessExternalTargetIds: Set<string>;

  addDisposedTrack: (targetID: string | undefined, businessExternalTargetId: string | undefined) => void;
  isTrackDisposed: (targetID: string) => boolean;
  isBusinessTrackDisposed: (businessExternalTargetId: string) => boolean;
  clear: () => void;
}

export const useDisposedStore = create<DisposedState>((set, get) => ({
  disposedTargetIDs: new Set<string>(),
  disposedBusinessExternalTargetIds: new Set<string>(),

  addDisposedTrack: (targetID, businessExternalTargetId) => {
    const targetKey = typeof targetID === "string" ? targetID.trim() : "";
    const externalKey = typeof businessExternalTargetId === "string" ? businessExternalTargetId.trim() : "";
    if (!targetKey && !externalKey) return;

    set((state) => {
      const targetIDs = new Set(state.disposedTargetIDs);
      const externalTargetIds = new Set(state.disposedBusinessExternalTargetIds);
      if (targetKey) targetIDs.add(targetKey);
      if (externalKey) externalTargetIds.add(externalKey);
      return {
        disposedTargetIDs: targetIDs,
        disposedBusinessExternalTargetIds: externalTargetIds,
      };
    });
  },

  isTrackDisposed: (targetID) => {
    const id = typeof targetID === "string" ? targetID.trim() : "";
    return id ? get().disposedTargetIDs.has(id) : false;
  },

  isBusinessTrackDisposed: (businessExternalTargetId) => {
    const id = typeof businessExternalTargetId === "string" ? businessExternalTargetId.trim() : "";
    return id ? get().disposedBusinessExternalTargetIds.has(id) : false;
  },

  clear: () =>
    set({
      disposedTargetIDs: new Set<string>(),
      disposedBusinessExternalTargetIds: new Set<string>(),
    }),
}));