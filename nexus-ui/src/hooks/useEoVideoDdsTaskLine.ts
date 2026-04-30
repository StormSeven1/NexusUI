"use client";

import { useMemo } from "react";
import { useEoCameraDdsStatusStore } from "@/stores/eo-camera-dds-status-store";
import { useDroneStore } from "@/stores/drone-store";
import { canonicalEntityId } from "@/lib/camera-entity-id";
import { formatEoDdsCameraLine, formatEoDdsDroneVideoLine } from "@/lib/eo-video/formatEoDdsTaskOverlay";

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
  const camId = cameraEntityId?.trim() ? canonicalEntityId(cameraEntityId.trim()) : "";
  const camRow = useEoCameraDdsStatusStore((s) => (camId ? s.byEntityId[camId] : undefined));

  const droneTelemetry = useDroneStore((s) => {
    const sn = (droneSn ?? "").trim();
    if (!sn || variant !== "uav") return undefined;
    return s.drones[sn];
  });

  return useMemo(() => {
    if (variant === "uav") {
      return formatEoDdsDroneVideoLine(droneTelemetry);
    }
    return formatEoDdsCameraLine(camRow);
  }, [variant, camRow, droneTelemetry]);
}
