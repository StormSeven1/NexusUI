import { getCameraEntityBaseUrl } from "@/lib/entityUpstream";

export type EoBurnInSelectResult = {
  ok: boolean;
  entityId?: string;
  cameraIndex?: number;
  rectId?: number;
  error?: string;
  detail?: string;
};

/** 从 NexusUI box.id（boat-12 / plane-3 / single-7）或 trackId 解析烧录选中用的 rectId */
export function resolveEoBurnInRectId(box: {
  id?: string | null;
  trackId?: number | null;
} | null): number {
  if (!box) return 0;
  if (box.trackId != null && Number.isFinite(box.trackId) && box.trackId > 0)
    return Math.trunc(box.trackId);
  const id = (box.id ?? "").trim();
  const m = /^(?:boat|plane|single)-(\d+)$/i.exec(id);
  if (m) return Number(m[1]);
  return 0;
}

/** 从 entityId（camera_004）解析相机序号 */
export function cameraIndexFromEntityId(entityId: string | null | undefined): number | null {
  const s = (entityId ?? "").trim().toLowerCase();
  const m = /^camera[_-]?(\d+)$/.exec(s);
  if (!m) return null;
  return Number(m[1]);
}

/**
 * 通知 camServer 烧录流高亮选中框。
 * 经 BFF `/api/camera-task/burn-in-select` → `POST {mgmt}/api/v1/burn-in/select`
 */
export async function postEoBurnInSelect(payload: {
  entityId: string;
  rectId: number;
  backendBaseUrl?: string;
}): Promise<EoBurnInSelectResult> {
  const entityId = payload.entityId.trim().toLowerCase();
  const body: Record<string, unknown> = {
    entityId,
    rectId: payload.rectId > 0 ? payload.rectId : 0,
  };
  const idx = cameraIndexFromEntityId(entityId);
  if (idx != null) body.cameraIndex = idx;
  if (payload.backendBaseUrl?.trim())
    body.backendBaseUrl = payload.backendBaseUrl.trim();

  const res = await fetch("/api/camera-task/burn-in-select", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as EoBurnInSelectResult) : { ok: false, error: "empty" };
  } catch {
    return { ok: false, error: "non_json", detail: text.slice(0, 300) };
  }
}

export function defaultBurnInBackendBaseUrl(): string {
  return getCameraEntityBaseUrl();
}
