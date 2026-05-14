/** Qt `HS_PAN_TILT_*` / `HS_DIRECTMOVE_STEP` / `HS_ZOOM_DEFAULT` 与 ptzmainwidget.cpp 一致 */
export const THIRD_PARTY_DM_PAN_TILT_MIN = -30;
export const THIRD_PARTY_DM_PAN_TILT_MAX = 30;
export const THIRD_PARTY_DM_STEP = 2;
export const THIRD_PARTY_DM_ZOOM_DEFAULT = 200;

export async function postThirdPartyDirectMove(params: {
  entityId: string;
  backendBaseUrl: string;
  pan: number;
  tilt: number;
  zoom: number;
}): Promise<Response> {
  return fetch("/api/camera-task/third-party-direct-move", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      entityId: params.entityId,
      backendBaseUrl: params.backendBaseUrl,
      pan: params.pan,
      tilt: params.tilt,
      zoom: params.zoom,
    }),
    cache: "no-store",
  });
}
