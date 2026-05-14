import type { EoCameraDdsStatusRow } from "@/stores/eo-camera-dds-status-store";
import type { DroneTelemetry } from "@/stores/drone-store";

/**
 * 与 WatchSys `CMainWindow::slot_dealCameraStatus` 中 TargetCollectionIMChildTask 分支一致：
 * DDS `ExecutionState` 枚举首项为 EXECUTING（值为 0）；非 0 或 COMPLETED/FAILED 等视为已结束 → 空闲中。
 */
function isCameraExecutionActive(executionState: unknown): boolean {
  if (executionState === null || executionState === undefined) return false;
  if (typeof executionState === "number" && Number.isFinite(executionState)) {
    return Math.trunc(executionState) === 0;
  }
  if (typeof executionState === "bigint") {
    return executionState === BigInt(0);
  }
  const s = String(executionState).trim();
  if (s === "0") return true;
  const u = s.toUpperCase();
  if (u.includes("EXECUTING") && !u.includes("NOT_") && !u.includes("NON")) return true;
  return false;
}

/** 与 BaseDeviceStatus.idl 顺序一致：1..4 为已完成/取消/暂存/失败 */
function isCameraExecutionCompleted(executionState: unknown): boolean {
  if (executionState === null || executionState === undefined) return false;
  if (typeof executionState === "number" && Number.isFinite(executionState)) {
    const t = Math.trunc(executionState);
    return t >= 1 && t <= 4;
  }
  if (typeof executionState === "bigint") {
    const t = Number(executionState.valueOf());
    return Number.isFinite(t) && t >= 1 && t <= 4;
  }
  const u = String(executionState).trim().toUpperCase();
  if (
    u.includes("COMPLETED") ||
    u.includes("ALREADY_CLEARED") ||
    u.includes("CLEARED") ||
    u.includes("SAVED") ||
    u.includes("FAILED")
  ) {
    return true;
  }
  return false;
}

/** 与右下角 `formatEoDdsCameraLine` 同源：仅接受正整数航迹号 */
export function parsePositiveTrackId(trackID: unknown): number | null {
  if (trackID === null || trackID === undefined) return null;
  if (typeof trackID === "number" && Number.isFinite(trackID)) {
    const n = Math.trunc(trackID);
    return n > 0 ? n : null;
  }
  if (typeof trackID === "bigint") {
    const n = Number(trackID.valueOf());
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  }
  const s = String(trackID).trim();
  if (!s) return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  return t > 0 ? t : null;
}

/** 右下角一行：相机仅「正在跟踪{n}号目标」/「空闲中」，与 Qt 光电条一致（不再堆 taskType/ms/在线等） */
export function formatEoDdsCameraLine(row: EoCameraDdsStatusRow | undefined): string {
  if (!row) return "空闲中";
  const tid = parsePositiveTrackId(row.trackID);
  const ex = row.executionState;
  if (tid == null) return "空闲中";
  if (isCameraExecutionCompleted(ex)) return "空闲中";
  if (isCameraExecutionActive(ex)) return `正在跟踪${tid}号目标`;
  // 部分网关只推 trackID、暂不推 executionState：有有效航迹且非明确已结束时仍视为跟踪中
  if (ex === undefined || ex === null || String(ex).trim() === "") {
    return `正在跟踪${tid}号目标`;
  }
  return "空闲中";
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
