/** 无人机任务下发：飞行速度与高度（与-秒 / 米） */

export const DRONE_FLIGHT_SPEED_MIN = 1;
export const DRONE_FLIGHT_SPEED_MAX = 15;
export const DRONE_FLIGHT_SPEED_DEFAULT = 15;

export const DRONE_FLIGHT_HEIGHT_MIN = 30;
export const DRONE_FLIGHT_HEIGHT_MAX = 300;
export const DRONE_FLIGHT_HEIGHT_DEFAULT = 100;

export type DroneTaskFlightSettings = {
  flightSpeed: number;
  flightHeight: number;
};

export const DEFAULT_DRONE_TASK_FLIGHT_SETTINGS: DroneTaskFlightSettings = {
  flightSpeed: DRONE_FLIGHT_SPEED_DEFAULT,
  flightHeight: DRONE_FLIGHT_HEIGHT_DEFAULT,
};

export function clampDroneFlightSpeed(raw: unknown, fallback = DRONE_FLIGHT_SPEED_DEFAULT): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(DRONE_FLIGHT_SPEED_MAX, Math.max(DRONE_FLIGHT_SPEED_MIN, Math.round(n)));
}

export function clampDroneFlightHeight(raw: unknown, fallback = DRONE_FLIGHT_HEIGHT_DEFAULT): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(DRONE_FLIGHT_HEIGHT_MAX, Math.max(DRONE_FLIGHT_HEIGHT_MIN, Math.round(n)));
}

/** API 路由：请求体优先，其次 env 默认，最后全局默认 */
export function resolveDroneFlightSpeedFromBody(
  body: Record<string, unknown>,
  envFallback: number,
): number {
  if (body.speed != null) return clampDroneFlightSpeed(body.speed);
  if (body.flightSpeed != null) return clampDroneFlightSpeed(body.flightSpeed);
  return clampDroneFlightSpeed(envFallback);
}

export function resolveDroneFlightHeightFromBody(
  body: Record<string, unknown>,
  envFallback: number,
): number {
  if (body.height != null) return clampDroneFlightHeight(body.height);
  if (body.flightHeight != null) return clampDroneFlightHeight(body.flightHeight);
  return clampDroneFlightHeight(envFallback);
}
