import { create } from "zustand";

/**
 * DDS → Custombackend → WS `Camera` 消息的任务字段旁路缓存。
 *
 * `useUnifiedWsFeed` 里地图显隐会 `filterAssetsForDisplay` 剔除 EXCLUDE_CAMERA_IDS，
 * 被拉黑的相机不会进入 asset-store，但光电页仍需显示 taskType / executionState 等。
 * 本 store 按 entityId 全量接收，与地图过滤无关。
 */
export interface EoCameraDdsStatusRow {
  taskType?: unknown;
  executionState?: unknown;
  online?: boolean;
  trackID?: unknown;
  executionTimeMs?: unknown;
  updatedAt: number;
}

interface EoCameraDdsStatusState {
  byEntityId: Record<string, EoCameraDdsStatusRow>;
  /** 每条 Camera / optoelectronic WS 在分发入口调用一次 */
  ingestCameraPayload: (d: Record<string, unknown>) => void;
}

export const useEoCameraDdsStatusStore = create<EoCameraDdsStatusState>((set, get) => ({
  byEntityId: {},
  ingestCameraPayload: (d) => {
    const entityId = String(d.entityId ?? "").trim();
    if (!entityId) return;
    const prev = get().byEntityId[entityId];
    const next: EoCameraDdsStatusRow = {
      taskType: d.taskType !== undefined ? d.taskType : prev?.taskType,
      executionState: d.executionState !== undefined ? d.executionState : prev?.executionState,
      online: d.online !== undefined ? Boolean(d.online) : prev?.online,
      trackID:
        d.trackID !== undefined
          ? d.trackID
          : d.track_id !== undefined
            ? d.track_id
            : prev?.trackID,
      executionTimeMs: d.executionTimeMs !== undefined ? d.executionTimeMs : prev?.executionTimeMs,
      updatedAt: Date.now(),
    };
    set((s) => ({
      byEntityId: { ...s.byEntityId, [entityId]: next },
    }));
  },
}));
