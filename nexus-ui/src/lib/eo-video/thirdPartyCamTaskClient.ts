/** 第三方相机：`ThirdPartyCamCamTask.taskKind`（含 STOP） */
export type ThirdPartyCamTaskKind = "SEARCH" | "TRACK" | "CATCH" | "AUTO1" | "AUTO2" | "AUTO3" | "STOP";

export async function postThirdPartyCamTask(params: {
  entityId: string;
  backendBaseUrl: string;
  taskKind: ThirdPartyCamTaskKind;
}): Promise<Response> {
  return fetch("/api/camera-task/third-party-cam-task", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      entityId: params.entityId,
      backendBaseUrl: params.backendBaseUrl,
      taskKind: params.taskKind,
    }),
    cache: "no-store",
  });
}
