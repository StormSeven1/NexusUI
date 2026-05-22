"use client";

import { useMemo, useRef } from "react";
import { useEoCameraDdsStatusStore } from "@/stores/eo-camera-dds-status-store";
import { useDroneStore } from "@/stores/drone-store";
import { canonicalEntityId } from "@/lib/camera-entity-id";
import { formatEoDdsCameraLine, formatEoDdsDroneVideoLine } from "@/lib/eo-video/formatEoDdsTaskOverlay";

function pickNonEmpty(obj: Record<string, unknown> | null, keys: string[]): string {
  if (!obj) return "";
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    const t = String(v).trim();
    if (t) return t;
  }
  return "";
}

export interface UseEoVideoDdsTaskLineArgs {
  variant: "camera" | "uav";
  /** 当前相机实体（camera_xxx），uav 模式可空 */
  cameraEntityId?: string | null;
  /** 无人机 SN，对应 drone-store 主键 */
  droneSn?: string | null;
}

/**
 * 光电窗口底部右侧：展示 DDS 下发的任务态（相机走 Camera WS 旁路 store；无人机走航线/状态包）。
 */
export function useEoVideoDdsTaskLine({
  variant,
  cameraEntityId,
  droneSn,
}: UseEoVideoDdsTaskLineArgs): string {
  /** 对齐 C++ `slot_dealDroneStatus`：droneState 优先显示并锁 10 秒，期间 taskState 不抢占。 */
  const droneStateLockRef = useRef<Record<string, { lockAtMs: number; text: string }>>({});
  const camId = cameraEntityId?.trim() ? canonicalEntityId(cameraEntityId.trim()) : "";
  const camRow = useEoCameraDdsStatusStore((s) => (camId ? s.byEntityId[camId] : undefined));

  const droneTelemetry = useDroneStore((s) => {
    const sn = (droneSn ?? "").trim();
    if (!sn || variant !== "uav") return undefined;
    return s.drones[sn];
  });

  return useMemo(() => {
    if (variant === "uav") {
      if (!droneTelemetry) return "空闲中";
      const now = Date.now();
      const lockDurationMs = 10_000;
      const stObj =
        droneTelemetry.status && typeof droneTelemetry.status === "object"
          ? (droneTelemetry.status as Record<string, unknown>)
          : null;
      const fpObj =
        droneTelemetry.flightPath && typeof droneTelemetry.flightPath === "object"
          ? (droneTelemetry.flightPath as Record<string, unknown>)
          : null;
      const entityId = pickNonEmpty(stObj, ["entityId", "entity_id"]) ||
        pickNonEmpty(fpObj, ["entityId", "entity_id"]) ||
        (droneSn ?? "").trim() ||
        droneTelemetry.sn;

      const droneState = pickNonEmpty(stObj, [
        "droneState",
        "drone_state",
        "droneTaskState",
        "drone_task_state",
        "stateText",
        "state_text",
        "stateDesc",
        "state_desc",
      ]) || pickNonEmpty(fpObj, ["droneState", "drone_state"]);
      const taskState = pickNonEmpty(fpObj, [
        "taskState",
        "task_state",
        "taskText",
        "task_text",
        "taskDesc",
        "task_desc",
        "taskName",
        "task_name",
        // Custombackend dds_parser: drone_task 常把可读任务态写在 rev1
        "rev1",
        "rev_1",
        "rev2",
        "rev_2",
        "rev3",
        "rev_3",
      ]);

      const lock = droneStateLockRef.current[entityId];
      if (droneState) {
        droneStateLockRef.current[entityId] = { lockAtMs: now, text: droneState };
        return droneState;
      }
      if (lock && now - lock.lockAtMs < lockDurationMs) {
        return lock.text || "空闲中";
      }
      if (lock && now - lock.lockAtMs >= lockDurationMs) {
        delete droneStateLockRef.current[entityId];
      }
      if (taskState) return taskState;
      const fallback = formatEoDdsDroneVideoLine(droneTelemetry);
      if (fallback && fallback !== "空闲中") return fallback;
      return "空闲中";
    }
    return formatEoDdsCameraLine(camRow);
  }, [variant, camRow, droneTelemetry, droneSn]);
}
