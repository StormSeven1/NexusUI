import { create } from "zustand";
import { canonicalEntityId } from "@/lib/camera-entity-id";

/**
 * EntityRealTimeStatus.idl `DroneTaskRealTimeStatus` → WS `DroneTaskStatus` 旁路缓存。
 * 供光电视频右下角任务态展示（`drone_task_action`），与 drone-store 航线/遥测解耦。
 */
export interface EoDroneDdsStatusRow {
  droneTaskAction?: unknown;
  droneState?: unknown;
  droneTaskTargetId?: unknown;
  taskType?: unknown;
  executionState?: unknown;
  updatedAt: number;
}

interface EoDroneDdsStatusState {
  byEntityId: Record<string, EoDroneDdsStatusRow>;
  ingestDroneTaskPayload: (d: Record<string, unknown>) => void;
}

function resolveDroneEntityStoreKey(rawEntity: string): string {
  const trimmed = rawEntity.trim();
  if (!trimmed) return "";
  return canonicalEntityId(trimmed) || trimmed;
}

export const useEoDroneDdsStatusStore = create<EoDroneDdsStatusState>((set, get) => ({
  byEntityId: {},
  ingestDroneTaskPayload: (d) => {
    const rawEntity = String(d.entityId ?? d.entity_id ?? "").trim();
    if (!rawEntity) return;
    const entityId = resolveDroneEntityStoreKey(rawEntity);
    if (!entityId) return;
    const prev = get().byEntityId[entityId];
    const actionIn = d.drone_task_action ?? d.droneTaskAction;
    const stateIn = d.drone_state ?? d.droneState;
    const targetIn = d.drone_task_targetID ?? d.drone_task_targetId ?? d.droneTaskTargetID;
    const next: EoDroneDdsStatusRow = {
      droneTaskAction: actionIn !== undefined && actionIn !== null ? actionIn : prev?.droneTaskAction,
      droneState: stateIn !== undefined && stateIn !== null ? stateIn : prev?.droneState,
      droneTaskTargetId: targetIn !== undefined && targetIn !== null ? targetIn : prev?.droneTaskTargetId,
      taskType: d.taskType !== undefined ? d.taskType : d.task_type !== undefined ? d.task_type : prev?.taskType,
      executionState:
        d.executionState !== undefined
          ? d.executionState
          : d.execution_state !== undefined
            ? d.execution_state
            : prev?.executionState,
      updatedAt: Date.now(),
    };
    set((s) => ({
      byEntityId: { ...s.byEntityId, [entityId]: next },
    }));
  },
}));
