import type { EoCameraDdsStatusRow } from "@/stores/eo-camera-dds-status-store";
import type { DroneTelemetry } from "@/stores/drone-store";

/**
 * 与 WatchSys `CMainWindow::slot_dealCameraStatus` 中 TargetCollectionIMChildTask 分支一致：
 * DDS `ExecutionState` 枚举首项为 EXECUTING（值为 0）；非 0 或 COMPLETED/FAILED 等视为已结束 → 空闲中。
 */
export function isCameraExecutionActive(executionState: unknown): boolean {
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

/** 日常区域查证任务类型（对海 / 对空子任务在 DDS 上的 taskType） */
export function isDailyAreaVerificationTaskType(taskType: unknown): boolean {
  const t = String(taskType ?? "").trim();
  return (
    t === "type.casia.tasks.v1.CameraVerification" ||
    t === "type.casia.tasks.v1.CameraSkyVerification"
  );
}

/** DDS 任务类型 → 检测圆标「海|空」；无明确语义时返回 null */
export function inferEoSurfaceFromDdsTaskType(taskType: unknown): "空" | "海" | null {
  const t = String(taskType ?? "").trim();
  if (!t) return null;
  if (t === "type.casia.tasks.v1.CameraSkyVerification" || /Sky/i.test(t)) return "空";
  if (t === "type.casia.tasks.v1.CameraVerification") return "海";
  return null;
}

/** DDS 相机状态超过此时间未更新则不再视为「正在查证」（避免断流后按钮常亮） */
export const DDS_CAMERA_STATUS_STALE_MS = 15000;

/**
 * 任一路相机 DDS 报 CameraVerification 且 EXECUTING（含日常查证、区域航迹查证、告警查证等）。
 * 不可单独用于顶栏「日常查证」按钮——请用 `useAutoDutyDailyVerificationActive`（查 auto_duty_workflow history）。
 */
export function isDailyAreaVerificationActiveFromDdsRow(row: EoCameraDdsStatusRow | undefined): boolean {
  if (!row) return false;
  if (Date.now() - row.updatedAt > DDS_CAMERA_STATUS_STALE_MS) return false;
  if (!isDailyAreaVerificationTaskType(row.taskType)) return false;
  return isCameraExecutionActive(row.executionState);
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

/** 常见瞬时任务：执行中（executionState=0）时给出可读文案；已完成仍视为空闲（与 Qt 非跟踪分支一致） */
function formatEoDdsCameraTransientTaskLine(taskType: string, active: boolean): string | null {
  if (taskType.endsWith("PTZMoveTask")) return active ? "云台运动中" : "空闲中";
  if (taskType.endsWith("LookAtChildTask")) return active ? "目标注视中" : "空闲中";
  if (taskType.endsWith("PTZControlStop")) return "空闲中";
  return null;
}

/** 右下角一行：相机仅「正在跟踪{n}号目标」/「空闲中」，与 Qt 光电条一致（不再堆 taskType/ms/在线等） */
export function formatEoDdsCameraLine(row: EoCameraDdsStatusRow | undefined): string {
  if (!row) return "空闲中";
  const taskType = String(row.taskType ?? "").trim();
  const tid = parsePositiveTrackId(row.trackID) ?? parsePositiveTrackId(row.targetID);
  const ex = row.executionState;
  const active = isCameraExecutionActive(ex);
  const transient = formatEoDdsCameraTransientTaskLine(taskType, active);
  if (transient != null) return transient;
  if (isCameraExecutionCompleted(ex)) return "空闲中";

  // 对齐 C++ slot_dealCameraStatus 分支
  if (taskType === "type.casia.tasks.v1.TargetCollectionChildTask") {
    return active && tid != null ? `正在跟踪${tid}号目标` : "空闲中";
  }
  if (
    taskType === "type.casia.tasks.v1.CameraVerification" ||
    taskType === "type.casia.tasks.v1.CameraSkyVerification"
  ) {
    return active && tid != null ? `区域查证${tid}号目标` : "空闲中";
  }
  if (taskType === "type.casia.tasks.v1.TargetCollectionIMChildTask") {
    return active && tid != null ? `正在跟踪${tid}号目标` : "空闲中";
  }
  if (taskType === "type.casia.tasks.v1.VisualTrackingTask") {
    return active && tid != null ? `正在跟踪${tid}号目标` : "空闲中";
  }
  if (taskType === "type.casia.tasks.v1.CameraPointingAccuracyChild") {
    return active
      ? tid != null
        ? `指向准确度评估中（${tid}号目标）`
        : "指向准确度评估中"
      : "空闲中";
  }
  if (taskType === "type.casia.tasks.v1.TargetStrikeChildTask") {
    return active && tid != null ? `激光打击${tid}号目标` : "空闲中";
  }

  if (tid == null) return "空闲中";
  if (active) return `正在跟踪${tid}号目标`;
  // 部分网关只推 trackID、暂不推 executionState：有有效航迹且非明确已结束时仍视为跟踪中
  if (ex === undefined || ex === null || String(ex).trim() === "") {
    return `正在跟踪${tid}号目标`;
  }
  return "空闲中";
}

/**
 * 态势地图光电视场两侧虚线：仅相机任务执行中时显示。
 * 与右下角 `formatEoDdsCameraLine` 同源：任务条为「空闲中」时不画侧缘虚线。
 * （跟踪类任务在 executionState 仍为 EXECUTING 但 trackID 已空时，任务条与地图均视为空闲。）
 */
export function isCameraMapTaskExecuting(row: EoCameraDdsStatusRow | undefined): boolean {
  return formatEoDdsCameraLine(row) !== "空闲中";
}

/**
 * 是否处于应显示单目标检测框的跟踪态（与右下角 `formatEoDdsCameraLine`「正在跟踪{n}号目标」一致）。
 * 不能只用 executionState===0：任务结束后 EXECUTING 可能仍为 0，但 trackID 已空 → 应收多目标。
 */
export function isCameraSingleTrackDetectionActive(row: EoCameraDdsStatusRow | undefined): boolean {
  if (!row) return false;
  if (isCameraExecutionCompleted(row.executionState)) return false;

  const taskType = String(row.taskType ?? "").trim();
  const tid = parsePositiveTrackId(row.trackID) ?? parsePositiveTrackId(row.targetID);
  const active = isCameraExecutionActive(row.executionState);
  const ex = row.executionState;

  const transient = formatEoDdsCameraTransientTaskLine(taskType, active);
  if (transient != null) return false;

  if (
    taskType === "type.casia.tasks.v1.TargetCollectionChildTask" ||
    taskType === "type.casia.tasks.v1.TargetCollectionIMChildTask"
  ) {
    return active && tid != null;
  }
  if (taskType === "type.casia.tasks.v1.VisualTrackingTask") {
    return active && tid != null;
  }
  if (taskType === "type.casia.tasks.v1.TargetStrikeChildTask") {
    return active && tid != null;
  }

  if (tid == null) return false;
  if (active) return true;
  if (ex === undefined || ex === null || String(ex).trim() === "") return true;
  return false;
}

/** 右下角一行：无人机 EntityRealTimeStatus `drone_task_action` */
export function formatEoDdsDroneTaskLine(row: { droneTaskAction?: unknown } | undefined): string {
  const action = String(row?.droneTaskAction ?? "").trim();
  return action || "空闲中";
}

/** @deprecated 无人机右下角已改读 EntityRealTimeStatus `drone_task_action` */
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
