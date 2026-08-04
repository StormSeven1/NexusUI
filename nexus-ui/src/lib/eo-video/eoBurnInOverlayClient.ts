import {
  cameraIndexFromEntityId,
  defaultBurnInBackendBaseUrl,
} from "@/lib/eo-video/eoBurnInSelectClient";

export type EoBurnInOverlayResult = {
  ok: boolean;
  entityId?: string;
  cameraIndex?: number;
  /** true = camServer 绘制框+ID（默认） */
  drawEnabled?: boolean;
  /** true = 前端勾选「隐藏」，camServer 不绘制 */
  hideOverlay?: boolean;
  error?: string;
  detail?: string;
};

/**
 * 查询 / 设置烧录叠层显隐。
 * 经 BFF → camServer `GET|POST /api/v1/burn-in/overlay`
 */
export async function fetchEoBurnInOverlay(payload: {
  entityId: string;
  backendBaseUrl?: string;
}): Promise<EoBurnInOverlayResult> {
  const entityId = payload.entityId.trim().toLowerCase();
  const params = new URLSearchParams({ entityId });
  const idx = cameraIndexFromEntityId(entityId);
  if (idx != null) params.set("cameraIndex", String(idx));
  if (payload.backendBaseUrl?.trim())
    params.set("backendBaseUrl", payload.backendBaseUrl.trim());

  const res = await fetch(`/api/camera-task/burn-in-overlay?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as EoBurnInOverlayResult) : { ok: false, error: "empty" };
  } catch {
    return { ok: false, error: "non_json", detail: text.slice(0, 300) };
  }
}

export async function postEoBurnInOverlay(payload: {
  entityId: string;
  /** true = 勾选隐藏（不绘制） */
  hideOverlay: boolean;
  backendBaseUrl?: string;
}): Promise<EoBurnInOverlayResult> {
  const entityId = payload.entityId.trim().toLowerCase();
  const body: Record<string, unknown> = {
    entityId,
    hideOverlay: !!payload.hideOverlay,
    checked: !!payload.hideOverlay,
  };
  const idx = cameraIndexFromEntityId(entityId);
  if (idx != null) body.cameraIndex = idx;
  if (payload.backendBaseUrl?.trim())
    body.backendBaseUrl = payload.backendBaseUrl.trim();
  else body.backendBaseUrl = defaultBurnInBackendBaseUrl();

  const res = await fetch("/api/camera-task/burn-in-overlay", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as EoBurnInOverlayResult) : { ok: false, error: "empty" };
  } catch {
    return { ok: false, error: "non_json", detail: text.slice(0, 300) };
  }
}
