import { create } from "zustand";
import {
  EO_ACTIVE_MAIN_STREAM_STORAGE_PREFIX,
  EO_PIP_STREAM_STORAGE_PREFIX,
} from "@/lib/eo-video/eoStreamSelectionKeys";

type State = {
  mainBySyncKey: Record<string, string>;
  pipBySyncKey: Record<string, string>;
  /** 主画面流：写 localStorage + 通知同 syncKey 的其它 `EoVideoPanel` 实例 */
  setMainFromPanel: (syncKey: string, streamId: string) => void;
  /** 画中画流 */
  setPipFromPanel: (syncKey: string, streamId: string) => void;
};

export const useEoVideoStreamSelectionSyncStore = create<State>((set, get) => ({
  mainBySyncKey: {},
  pipBySyncKey: {},
  setMainFromPanel(syncKey, streamId) {
    const id = streamId.trim();
    if (!syncKey || !id) return;
    if (get().mainBySyncKey[syncKey] === id) return;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(EO_ACTIVE_MAIN_STREAM_STORAGE_PREFIX + syncKey, id);
      } catch {
        /* noop */
      }
    }
    set((s) => ({ mainBySyncKey: { ...s.mainBySyncKey, [syncKey]: id } }));
  },
  setPipFromPanel(syncKey, streamId) {
    const id = streamId.trim();
    if (!syncKey || !id) return;
    if (get().pipBySyncKey[syncKey] === id) return;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(EO_PIP_STREAM_STORAGE_PREFIX + syncKey, id);
      } catch {
        /* noop */
      }
    }
    set((s) => ({ pipBySyncKey: { ...s.pipBySyncKey, [syncKey]: id } }));
  },
}));
