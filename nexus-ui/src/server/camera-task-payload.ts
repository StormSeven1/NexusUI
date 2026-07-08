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
