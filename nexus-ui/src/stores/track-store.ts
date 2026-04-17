/**
 * ============================================================================
 * track-store（Zustand）航迹「缓存层」 触发 UI 更新的信号源
 * ============================================================================
 *
 * 【谁写入】`useUnifiedWsFeed`：`track_snapshot` / `track_update` 在 `normalizeIncomingTrackList` 后经 **`mergeTrackWsPayloadWithHistory(prev, next)`**（`track-ws-normalize`）再 `setTracks`；超时剔除由同 hook 内定时任务 `filterTracksByTimeout` 直接 `setTracks`。**不是**单独「缓存库」：每条航迹的 `historyTrail` 就挂在 **`tracks[i]`** 上。 *
 * 【谁读取】 * - `TrackListPanel`：全量列表（含 `historyTrail`） * - `Map2D` / `Map3D`：`subscribe` 后把 **`tracks` 原样**推地图；`maxViewportPoints` 只在 `tracks-maplibre.buildTrackGeoJSON` / `trackMapDrawHistoryTrails` 里决定是否**画**折线，**不**改 store。 *
 * 【「缓存」含义】这里的 tracks 存在 **内存**（Zustand 单例）中，不是浏览器持久 DB * 断网或刷新后需 WS 再次推 snapshot *
 * 【更新如何「响应式」】Zustand `set` 会通知所有订阅者：
 * - `useTrackStore(selector)` selector 结果**按默认浅比较** 变了，对应组件调度更新 * - `store.subscribe(listener)` 每次 state 变化都会 listener（Map2D 用这种方式推 GeoJSON） * */

import { create } from "zustand";
import type { Track } from "@/lib/map-entity-model";

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
