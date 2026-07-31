import {
  cameraIndexFromEntityId,
  defaultBurnInBackendBaseUrl,
} from "@/lib/eo-video/eoBurnInSelectClient";

export type EoBurnInPlacardResult = {
  ok: boolean;
  entityId?: string;
  cameraIndex?: number;
  trackId?: number;
  clear?: boolean;
  error?: string;
  detail?: string;
};

export type EoBurnInPlacardPayload = {
  entityId: string;
  /** 有效航迹 ID；<=0 或不传且 clear 时清除标牌 */
  trackId?: number;
  isAir?: boolean;
  clear?: boolean;
  backendBaseUrl?: string;
};

/**
 * 记录当前有标牌的 entityId 集合，供取消跟踪时一并清除（clearAllBurnInPlacards）。
 * 模块级变量，与 camServer 生命周期解耦，刷新页面自然归零。
 */
const _activePlacardOwners = new Map<string, string>(); // entityId → backendBaseUrl

/**
 * 通知 camServer 烧录流绘制航迹 ID 标牌。
 * 经 BFF `/api/camera-task/burn-in-placard` → `POST {mgmt}/api/v1/burn-in/placard`
 */
export async function postEoBurnInPlacard(
  payload: EoBurnInPlacardPayload,
): Promise<EoBurnInPlacardResult> {
  const entityId = payload.entityId.trim().toLowerCase();
  const baseUrl = payload.backendBaseUrl?.trim() || defaultBurnInBackendBaseUrl();
  const body: Record<string, unknown> = {
    entityId,
    clear: payload.clear === true,
  };
  const idx = cameraIndexFromEntityId(entityId);
  if (idx != null) body.cameraIndex = idx;
  if (payload.trackId != null && Number.isFinite(payload.trackId) && payload.trackId > 0)
    body.trackId = Math.trunc(payload.trackId);
  if (payload.isAir != null) body.isAir = !!payload.isAir;
  body.backendBaseUrl = baseUrl;

  // 维护 owner 列表：set 时登记，clear 时注销
  if (payload.clear === true) {
    _activePlacardOwners.delete(entityId);
  } else if (payload.trackId != null && payload.trackId > 0) {
    _activePlacardOwners.set(entityId, baseUrl);
  }

  const res = await fetch("/api/camera-task/burn-in-placard", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as EoBurnInPlacardResult) : { ok: false, error: "empty" };
  } catch {
    return { ok: false, error: "non_json", detail: text.slice(0, 300) };
  }
}

/**
 * 清除所有曾通过 postEoBurnInPlacard 设置的标牌（取消跟踪时调用）。
 * 火并忘记：内部错误不抛出，不阻塞主流程。
 */
export async function clearAllBurnInPlacards(): Promise<void> {
  const owners = [..._activePlacardOwners.entries()];
  _activePlacardOwners.clear();
  await Promise.all(
    owners.map(([entityId, backendBaseUrl]) =>
      postEoBurnInPlacard({ entityId, clear: true, backendBaseUrl }).catch(() => {}),
    ),
  );
}
