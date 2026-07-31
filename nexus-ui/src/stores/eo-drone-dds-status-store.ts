import { create } from "zustand";
import { canonicalEntityId } from "@/lib/camera-entity-id";

/**
 * EntityRealTimeStatus.idl `DroneTaskRealTimeStatus` → WS `DroneTaskStatus` 旁路缓存。
 * 供光电视频右下角任务态展示（`drone_task_action`），与 drone-store 航线/遥测解耦。
 *
 * 回仓空闲：不看文案内容。记录「曾离舱」；离舱后再 `drone_in_dock=true` 才清粘性任务态 →「空闲中」。
 * 起飞阶段一直在舱：hadLeftDock=false，任务管理下发文案照常显示。
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
  /** entityId → 本架次是否曾离舱（drone_in_dock=false） */
  hadLeftDockByEntityId: Record<string, boolean>;
  ingestDroneTaskPayload: (d: Record<string, unknown>) => void;
  clearDroneTaskAction: (entityId: string) => void;
  /**
   * 观测舱状态：离舱置位；曾离舱后再回舱 → 清空粘性任务文案并复位。
   * MQTT / WS dock_status / 底栏 hook 共用。
   */
  applyDroneInDockObservation: (entityIds: string[], droneInDock: boolean | null) => void;
}

function resolveDroneEntityStoreKey(rawEntity: string): string {
  const trimmed = rawEntity.trim();
  if (!trimmed) return "";
  return canonicalEntityId(trimmed) || trimmed;
}

export const useEoDroneDdsStatusStore = create<EoDroneDdsStatusState>((set, get) => ({
  byEntityId: {},
  hadLeftDockByEntityId: {},
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
  clearDroneTaskAction: (rawEntity) => {
    const entityId = resolveDroneEntityStoreKey(String(rawEntity ?? "").trim());
    if (!entityId) return;
    const prev = get().byEntityId[entityId];
    if (!prev) return;
    const action = String(prev.droneTaskAction ?? "").trim();
    const state = String(prev.droneState ?? "").trim();
    if (!action && !state) return;
    set((s) => ({
      byEntityId: {
        ...s.byEntityId,
        [entityId]: { ...prev, droneTaskAction: "", droneState: "", updatedAt: Date.now() },
      },
    }));
  },
  applyDroneInDockObservation: (entityIds, droneInDock) => {
    if (droneInDock !== true && droneInDock !== false) return;
    const ids = [
      ...new Set(
        entityIds
          .map((x) => resolveDroneEntityStoreKey(String(x ?? "").trim()))
          .filter(Boolean),
      ),
    ];
    if (ids.length === 0) return;

    if (droneInDock === false) {
      let changed = false;
      const nextLeft = { ...get().hadLeftDockByEntityId };
      for (const id of ids) {
        if (!nextLeft[id]) {
          nextLeft[id] = true;
          changed = true;
        }
      }
      if (changed) set({ hadLeftDockByEntityId: nextLeft });
      return;
    }

    /* droneInDock === true：仅「曾离舱再回舱」才清粘性文案 */
    const left = get().hadLeftDockByEntityId;
    const toClear = ids.filter((id) => left[id]);
    if (toClear.length === 0) return;

    const byEntityId = { ...get().byEntityId };
    const hadLeftDockByEntityId = { ...left };
    const now = Date.now();
    for (const id of toClear) {
      hadLeftDockByEntityId[id] = false;
      const prev = byEntityId[id];
      if (prev) {
        byEntityId[id] = { ...prev, droneTaskAction: "", droneState: "", updatedAt: now };
      }
    }
    set({ byEntityId, hadLeftDockByEntityId });
  },
}));
