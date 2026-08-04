/** 8院态势跟踪：经纬高引导 → BFF → camServer ThirdPartyYuan8GuideTask */
export async function postYuan8GuideTask(params: {
  backendBaseUrl: string;
  targetLon: number;
  targetLat: number;
  targetAlt?: number;
  ownerEntityId?: string;
}): Promise<Response> {
  return fetch("/api/camera-task/yuan8-guide", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      backendBaseUrl: params.backendBaseUrl,
      ownerEntityId: params.ownerEntityId ?? "",
      targetLon: params.targetLon,
      targetLat: params.targetLat,
      targetAlt: params.targetAlt ?? 0,
      guideControlType: 1,
      imageControlType: 1,
    }),
    cache: "no-store",
  });
}

/** 8院视频双击点动：归一化坐标 → 0~255 压点跟踪 */
export async function postYuan8PickTrackTask(params: {
  backendBaseUrl: string;
  entityId: string;
  /** 0~1 相对画面 */
  normalizedX: number;
  normalizedY: number;
}): Promise<Response> {
  const x = Math.max(0, Math.min(255, Math.round(params.normalizedX * 255)));
  const y = Math.max(0, Math.min(255, Math.round(params.normalizedY * 255)));
  return fetch("/api/camera-task/yuan8-pick-track", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      backendBaseUrl: params.backendBaseUrl,
      ownerEntityId: params.entityId,
      pickCoordX: x,
      pickCoordY: y,
      controlType: 2,
    }),
    cache: "no-store",
  });
}

/** 3003：3左 4右 5上 6下 7停 */
export type Yuan8ServoControlType = 3 | 4 | 5 | 6 | 7;

export async function postYuan8ServoTask(params: {
  backendBaseUrl: string;
  entityId: string;
  controlType: Yuan8ServoControlType;
}): Promise<Response> {
  return fetch("/api/camera-task/yuan8-servo", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      backendBaseUrl: params.backendBaseUrl,
      ownerEntityId: params.entityId,
      controlType: params.controlType,
    }),
    cache: "no-store",
  });
}

/** 3004：0xF0加大 / 0x0F减小 / 0x00停止 */
export const YUAN8_ZOOM_IN = 0xf0;
export const YUAN8_ZOOM_OUT = 0x0f;
export const YUAN8_ZOOM_STOP = 0x00;

export async function postYuan8ZoomTask(params: {
  backendBaseUrl: string;
  entityId: string;
  zoomCommand: number;
}): Promise<Response> {
  return fetch("/api/camera-task/yuan8-zoom", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      backendBaseUrl: params.backendBaseUrl,
      ownerEntityId: params.entityId,
      zoomControlType: 0,
      zoomCommand: params.zoomCommand,
      zoomValue: 0,
      camSwitchCommand: 0,
    }),
    cache: "no-store",
  });
}
