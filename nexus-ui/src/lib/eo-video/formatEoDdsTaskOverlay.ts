import type { EoCameraDdsStatusRow } from "@/stores/eo-camera-dds-status-store";
import type { DroneTelemetry } from "@/stores/drone-store";

/** 右下角一行：相机 DDS（taskType / executionState / 航迹 等） */
export function formatEoDdsCameraLine(row: EoCameraDdsStatusRow | undefined): string {
  if (!row) return "空闲中";
  const parts: string[] = [];
  if (row.taskType != null && String(row.taskType) !== "") {
    parts.push(`任务 ${String(row.taskType)}`);
  }
  if (row.executionState != null && String(row.executionState) !== "") {
    parts.push(`状态 ${String(row.executionState)}`);
  }
  if (row.trackID != null && String(row.trackID) !== "") {
    parts.push(`航迹 ${String(row.trackID)}`);
  }
  const et = row.executionTimeMs;
  if (et != null && Number.isFinite(Number(et))) {
    parts.push(`${Math.round(Number(et))}ms`);
  }
  if (row.online !== undefined) {
    parts.push(row.online ? "在线" : "离线");
  }
  return parts.length ? parts.join(" · ") : "空闲中";
}

/** 右下角一行：无人机侧「视频/航线」相关 DDS 字段（flightPath / status） */
export function formatEoDdsDroneVideoLine(t: DroneTelemetry | undefined): string {
  if (!t) return "空闲中";
  const fp = t.flightPath;
  const st = t.status;
  const fpObj = fp && typeof fp === "object" ? (fp as Record<string, unknown>) : null;
  const stObj = st && typeof st === "object" ? (st as Record<string, unknown>) : null;

  const parts: string[] = [];
  const tt = fpObj?.taskType ?? fpObj?.task_type ?? stObj?.taskType ?? stObj?.task_type;
  const es = fpObj?.executionState ?? fpObj?.execution_state ?? stObj?.executionState ?? stObj?.execution_state;

  if (tt != null && String(tt) !== "") parts.push(`任务 ${String(tt)}`);
  if (es != null && String(es) !== "") parts.push(`执行 ${String(es)}`);

  const wps = fpObj?.waypoints;
  if (Array.isArray(wps) && wps.length) parts.push(`航点×${wps.length}`);

  return parts.length ? parts.join(" · ") : "空闲中";
}
