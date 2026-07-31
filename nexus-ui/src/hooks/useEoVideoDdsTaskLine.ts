"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEoCameraDdsStatusStore } from "@/stores/eo-camera-dds-status-store";
import { useEoDroneDdsStatusStore } from "@/stores/eo-drone-dds-status-store";
import { useDroneStore } from "@/stores/drone-store";
import { canonicalEntityId } from "@/lib/camera-entity-id";
import { EO_CAMERA_DDS_EXECUTING_HOLD_MS } from "@/lib/eo-video/eoCameraDdsUiHold";
import {
  formatEoDdsCameraLine,
  formatEoDdsDroneTaskLine,
  isCameraExecutionActive,
} from "@/lib/eo-video/formatEoDdsTaskOverlay";
import { readDroneInDockFlag } from "@/lib/eo-video/resolveWsDroneInDock";

export interface UseEoVideoDdsTaskLineArgs {
  variant: "camera" | "uav";
  /** 当前相机实体（camera_xxx），uav 模式可空 */
  cameraEntityId?: string | null;
  /** 无人机实体 id（uav-xxx），EntityRealTimeStatus DroneTaskRealTimeStatus.entityId */
  droneEntityId?: string | null;
  /**
   * MQTT `drone_in_dock`（优先）。为 null/undefined 时回退 WS `dock_status`。
   * 曾离舱再回舱才切「空闲中」；起飞一直在舱不冲任务文案。
   */
  droneInDock?: boolean | null;
  /** 机场 SN，用于从 drone-store.docks 解析 WS `drone_in_dock` */
  airportSn?: string | null;
}

/**
 * 光电窗口底部右侧：展示 DDS 任务态。
 * - 相机：`CameraRealTimeStatus` → eo-camera-dds-status-store
 * - 无人机：`DroneTaskRealTimeStatus.drone_task_action` → eo-drone-dds-status-store
 *   曾离舱再回舱后强制「空闲中」（不依赖文案内容）
 */
export function useEoVideoDdsTaskLine({
  variant,
  cameraEntityId,
  droneEntityId,
  droneInDock: droneInDockProp,
  airportSn,
}: UseEoVideoDdsTaskLineArgs): string {
  const [cameraDisplayLine, setCameraDisplayLine] = useState("空闲中");
  const cameraIdleHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastExecutingLineRef = useRef("空闲中");
  const wasExecutingRef = useRef(false);
  const prevCamIdRef = useRef("");

  const camId = cameraEntityId?.trim() ? canonicalEntityId(cameraEntityId.trim()) : "";
  const camRow = useEoCameraDdsStatusStore((s) => (camId ? s.byEntityId[camId] : undefined));

  const uavId = droneEntityId?.trim() ? canonicalEntityId(droneEntityId.trim()) : "";
  const droneRow = useEoDroneDdsStatusStore((s) => (uavId ? s.byEntityId[uavId] : undefined));
  const hadLeftDock = useEoDroneDdsStatusStore((s) =>
    uavId ? Boolean(s.hadLeftDockByEntityId[uavId]) : false,
  );

  const airportSnNorm = (airportSn ?? "").trim();
  const rawEid = (droneEntityId ?? "").trim();
  const wsDroneInDock = useDroneStore((s) => {
    if (variant !== "uav" || !uavId) return null as boolean | null;
    if (airportSnNorm) {
      const fromAp = readDroneInDockFlag(s.docks[airportSnNorm]?.payload);
      if (fromAp !== null) return fromAp;
    }
    const deviceSn =
      s.entityIdToDeviceSn[uavId] ||
      (rawEid && rawEid !== uavId ? s.entityIdToDeviceSn[rawEid] : undefined) ||
      "";
    const dockSn = deviceSn ? s.droneToAirport[deviceSn] : "";
    if (!dockSn) return null;
    return readDroneInDockFlag(s.docks[dockSn]?.payload);
  });

  const droneInDock = droneInDockProp ?? wsDroneInDock;

  /** 舱状态观测：离舱置位；曾离舱再回舱 → 清粘性任务文案 */
  useEffect(() => {
    if (variant !== "uav" || !uavId || droneInDock == null) return;
    const ids = [uavId];
    if (rawEid && rawEid !== uavId) ids.push(rawEid);
    useEoDroneDdsStatusStore.getState().applyDroneInDockObservation(ids, droneInDock);
  }, [variant, uavId, rawEid, droneInDock]);

  useEffect(() => {
    if (variant !== "camera") return;

    const clearIdleHold = () => {
      if (cameraIdleHoldTimerRef.current != null) {
        clearTimeout(cameraIdleHoldTimerRef.current);
        cameraIdleHoldTimerRef.current = null;
      }
    };

    if (prevCamIdRef.current !== camId) {
      clearIdleHold();
      prevCamIdRef.current = camId;
      lastExecutingLineRef.current = "空闲中";
      wasExecutingRef.current = false;
    }

    if (!camId) {
      clearIdleHold();
      setCameraDisplayLine("空闲中");
      return;
    }

    const raw = formatEoDdsCameraLine(camRow);
    const executing = isCameraExecutionActive(camRow?.executionState);

    if (executing) {
      clearIdleHold();
      wasExecutingRef.current = true;
      lastExecutingLineRef.current = raw;
      setCameraDisplayLine(raw);
      return clearIdleHold;
    }

    if (raw !== "空闲中") {
      clearIdleHold();
      wasExecutingRef.current = false;
      setCameraDisplayLine(raw);
      return clearIdleHold;
    }

    if (wasExecutingRef.current) {
      wasExecutingRef.current = false;
      const holdLine = lastExecutingLineRef.current;
      if (holdLine === "空闲中") {
        setCameraDisplayLine("空闲中");
        return clearIdleHold;
      }
      setCameraDisplayLine(holdLine);
      clearIdleHold();
      cameraIdleHoldTimerRef.current = setTimeout(() => {
        cameraIdleHoldTimerRef.current = null;
        setCameraDisplayLine("空闲中");
      }, EO_CAMERA_DDS_EXECUTING_HOLD_MS);
      return clearIdleHold;
    }

    if (!cameraIdleHoldTimerRef.current) {
      setCameraDisplayLine("空闲中");
    }

    return clearIdleHold;
  }, [variant, camId, camRow]);

  return useMemo(() => {
    if (variant === "uav") {
      return formatEoDdsDroneTaskLine(droneRow, { droneInDock, hadLeftDock });
    }
    return cameraDisplayLine;
  }, [variant, cameraDisplayLine, droneRow, droneInDock, hadLeftDock]);
}
