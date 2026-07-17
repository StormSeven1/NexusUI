export type EoPtzDirection =
  | "UP"
  | "DOWN"
  | "LEFT"
  | "RIGHT"
  | "LEFT_UP"
  | "LEFT_DOWN"
  | "RIGHT_UP"
  | "RIGHT_DOWN"
  | "ZOOM_IN"
  | "ZOOM_OUT"
  | "FOCUS_IN"
  | "FOCUS_OUT";

export type EoPtzMoveSpeed = {
  pan: number;
  tilt: number;
};

function clampPtzSpeed(n: number): number {
  return Math.min(63 / 64, Math.max(0.1, n));
}

function normalizeMoveSpeed(speed?: Partial<EoPtzMoveSpeed>, zoomOrFocus = false): EoPtzMoveSpeed {
  if (zoomOrFocus) {
    return { pan: clampPtzSpeed(speed?.pan ?? 0.5), tilt: 0 };
  }
  return {
    pan: clampPtzSpeed(speed?.pan ?? 0.5),
    tilt: clampPtzSpeed(speed?.tilt ?? 0.5),
  };
}

export function createCameraTaskId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildPtzMoveTaskPayload(params: {
  entityId: string;
  direction: EoPtzDirection;
  speed?: Partial<EoPtzMoveSpeed>;
}) {
  const { entityId, direction, speed } = params;
  const zoomOrFocus = direction.includes("ZOOM") || direction.includes("FOCUS");
  const moveSpeed = normalizeMoveSpeed(speed, zoomOrFocus);
  return {
    taskId: createCameraTaskId("ptz_move"),
    parentTaskId: createCameraTaskId("task_search"),
    version: { definitionVersion: 1, statusVersion: 1 },
    displayName: `云台移动-${direction}`,
    taskType: "AUTOMATIC",
    maxExecutionTimeMs: 10000,
    specification: {
      "@type": "type.casia.tasks.v1.PTZMoveTask",
      direction,
      speed: moveSpeed,
    },
    createdBy: {
      system: {
        serviceName: "camera_control_service",
        entityId: "service_001",
        managesOwnScheduling: true,
        priority: 2,
      },
    },
    owner: { entityId },
  };
}

export function buildPtzStopTaskPayload(entityId: string) {
  return {
    taskId: createCameraTaskId("ptz_stop"),
    parentTaskId: createCameraTaskId("task_search"),
    version: { definitionVersion: 1, statusVersion: 1 },
    displayName: "云台停止",
    taskType: "MANUAL",
    maxExecutionTimeMs: 1000,
    specification: { "@type": "type.casia.tasks.v1.PTZControlStop" },
    createdBy: {
      user: {
        userId: "operator_001",
        priority: 0,
      },
    },
    owner: { entityId },
  };
}

/**
 * `PTZAbsolutePositionTask`：pan/tilt/zoom 均为物理量（度 / 变倍倍数），
 * 与 `CameraManagementClient.ptzAbsolutePosition`、camServer `mainwindow` 解析一致。
 * 快拖对齐 Qt：`speed.zoom=0` 且 zoom 传当前倍数，避免误变倍。
 */
export function buildPtzAbsolutePositionTaskPayload(params: {
  entityId: string;
  panDeg: number;
  tiltDeg: number;
  zoom: number;
  speed?: Partial<EoPtzMoveSpeed> & { zoom?: number };
}) {
  const pan = Number(params.panDeg);
  const tilt = Number(params.tiltDeg);
  const zoom = Number(params.zoom);
  const speedPan = clampPtzSpeed(params.speed?.pan ?? 0.5);
  const speedTilt = clampPtzSpeed(params.speed?.tilt ?? 0.5);
  const speedZoom =
    params.speed?.zoom != null && Number.isFinite(params.speed.zoom)
      ? Math.max(0, Math.min(1, params.speed.zoom))
      : 0;
  return {
    taskId: createCameraTaskId("ptz_abs_pos"),
    parentTaskId: createCameraTaskId("ptz_abs_pos"),
    version: { definitionVersion: 1, statusVersion: 1 },
    displayName: "转向指定位置",
    taskType: "MANUAL",
    maxExecutionTimeMs: 30000,
    specification: {
      "@type": "type.casia.tasks.v1.PTZAbsolutePositionTask",
      position: { pan, tilt, zoom },
      speed: { pan: speedPan, tilt: speedTilt, zoom: speedZoom },
    },
    createdBy: {
      user: {
        userId: "operator_001",
        priority: 0,
      },
    },
    owner: { entityId: params.entityId },
  };
}

/** camServer `type.casia.tasks.v1.PIDUpdate` → `CAMERA_UPDATE_PIDXY`（写 ConfigPID.ini + SetPID 热加载） */
export type CameraPidParams = {
  px: number;
  ix: number;
  dx: number;
  py: number;
  iy: number;
  dy: number;
  px1: number;
  ix1: number;
  dx1: number;
  py1: number;
  iy1: number;
  dy1: number;
  px2: number;
  ix2: number;
  dx2: number;
  py2: number;
  iy2: number;
  dy2: number;
};

export function buildPidUpdateTaskPayload(params: { entityId: string; pid: CameraPidParams }) {
  return {
    taskId: createCameraTaskId("pid_update"),
    parentTaskId: createCameraTaskId("pid_update"),
    version: { definitionVersion: 1, statusVersion: 1 },
    displayName: "更新PID参数",
    taskType: "MANUAL",
    maxExecutionTimeMs: 3000,
    specification: {
      "@type": "type.casia.tasks.v1.PIDUpdate",
      pid: { ...params.pid },
    },
    createdBy: {
      user: {
        userId: "operator_001",
        priority: 0,
      },
    },
    owner: { entityId: params.entityId },
  };
}

export function resolveCameraTaskHttpEndpoint(backendBaseUrl: string): string | null {
  const raw =
    backendBaseUrl.trim()
    || process.env.NEXT_PUBLIC_NEXUS_CAMERA_MANAGEMENT_URL?.trim()
    || process.env.CAMERA_ENTITY_BASE_URL?.trim()
    || "";
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.protocol}//${u.host}/api/v1/tasks`;
  } catch {
    return null;
  }
}

const PTZ_DIRECTION_TO_GRPC: Record<EoPtzDirection, number> = {
  UP: 1,
  DOWN: 2,
  LEFT: 3,
  RIGHT: 4,
  LEFT_UP: 5,
  LEFT_DOWN: 6,
  RIGHT_UP: 7,
  RIGHT_DOWN: 8,
  ZOOM_IN: 9,
  ZOOM_OUT: 10,
  FOCUS_IN: 11,
  FOCUS_OUT: 12,
};

export function ptzDirectionToGrpcEnum(direction: EoPtzDirection): number {
  return PTZ_DIRECTION_TO_GRPC[direction] ?? 0;
}
