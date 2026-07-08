import type { EoPtzDragDirection, EoPtzMoveSpeed } from "@/lib/eo-video/eoPtzDrag";

export type EoPtzDirection =
  | EoPtzDragDirection
  | "ZOOM_IN"
  | "ZOOM_OUT"
  | "FOCUS_IN"
  | "FOCUS_OUT";

export type { EoPtzMoveSpeed };

export async function postEoPtzMove(params: {
  entityId: string;
  backendBaseUrl: string;
  direction: EoPtzDirection;
  speed?: EoPtzMoveSpeed;
}): Promise<Response> {
  const body: Record<string, unknown> = {
    entityId: params.entityId,
    backendBaseUrl: params.backendBaseUrl,
    direction: params.direction,
  };
  if (params.speed) {
    body.speed = { pan: params.speed.pan, tilt: params.speed.tilt };
  }
  return fetch("/api/camera-task/ptz-move", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

export async function postEoPtzStop(params: { entityId: string; backendBaseUrl: string }): Promise<Response> {
  return fetch("/api/camera-task/ptz-stop", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      entityId: params.entityId,
      backendBaseUrl: params.backendBaseUrl,
    }),
    cache: "no-store",
  });
}
