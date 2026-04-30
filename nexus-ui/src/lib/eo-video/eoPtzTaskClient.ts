export type EoPtzDirection =
  | "UP"
  | "DOWN"
  | "LEFT"
  | "RIGHT"
  | "ZOOM_IN"
  | "ZOOM_OUT"
  | "FOCUS_IN"
  | "FOCUS_OUT";

export async function postEoPtzMove(params: {
  entityId: string;
  backendBaseUrl: string;
  direction: EoPtzDirection;
}): Promise<Response> {
  return fetch("/api/camera-task/ptz-move", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      entityId: params.entityId,
      backendBaseUrl: params.backendBaseUrl,
      direction: params.direction,
    }),
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
