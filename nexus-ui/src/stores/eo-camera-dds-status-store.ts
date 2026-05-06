import { create } from "zustand";
import { canonicalEntityId } from "@/lib/camera-entity-id";

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
  /** DDS 目标别名（与 Qt 标牌/DrawCircleTag 目标名同源字段，键名常见 trackAlias / track_alias） */
  trackAlias?: unknown;
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
    const rawEntity = String(d.entityId ?? d.cameraId ?? d.deviceId ?? "").trim();
    if (!rawEntity) return;
    const entityId = canonicalEntityId(rawEntity) || rawEntity;
    const prev = get().byEntityId[entityId];
    const execIn =
      d.executionState !== undefined
        ? d.executionState
        : d.execution_state !== undefined
          ? d.execution_state
          : undefined;
    const trackIn =
      d.trackID !== undefined
        ? d.trackID
        : d.trackId !== undefined
          ? d.trackId
          : d.track_id !== undefined
            ? d.track_id
            : undefined;
    const aliasIn =
      d.trackAlias !== undefined ? d.trackAlias : d.track_alias !== undefined ? d.track_alias : undefined;
    const next: EoCameraDdsStatusRow = {
      taskType: d.taskType !== undefined ? d.taskType : d.task_type !== undefined ? d.task_type : prev?.taskType,
      executionState: execIn !== undefined ? execIn : prev?.executionState,
      online: d.online !== undefined ? Boolean(d.online) : prev?.online,
      trackID: trackIn !== undefined ? trackIn : prev?.trackID,
      trackAlias: aliasIn !== undefined ? aliasIn : prev?.trackAlias,
      executionTimeMs: d.executionTimeMs !== undefined ? d.executionTimeMs : prev?.executionTimeMs,
      updatedAt: Date.now(),
    };
    set((s) => ({
      byEntityId: { ...s.byEntityId, [entityId]: next },
    }));
  },
}));
