import type { CameraPidParams } from "@/server/camera-task-payload";
import { getCameraEntityBaseUrl } from "@/lib/entityUpstream";

export type { CameraPidParams };

export const EMPTY_CAMERA_PID: CameraPidParams = {
  px: 0,
  ix: 0,
  dx: 0,
  py: 0,
  iy: 0,
  dy: 0,
  px1: 0,
  ix1: 0,
  dx1: 0,
  py1: 0,
  iy1: 0,
  dy1: 0,
  px2: 0,
  ix2: 0,
  dx2: 0,
  py2: 0,
  iy2: 0,
  dy2: 0,
};

const PID_KEYS = Object.keys(EMPTY_CAMERA_PID) as (keyof CameraPidParams)[];

export function parseCameraPid(raw: unknown): CameraPidParams | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out = { ...EMPTY_CAMERA_PID };
  for (const k of PID_KEYS) {
    const n = Number(o[k]);
    if (!Number.isFinite(n)) return null;
    out[k] = n;
  }
  return out;
}

export type FetchEoPidResult = {
  ok: boolean;
  entityId?: string;
  cameraIndex?: number;
  pid?: CameraPidParams;
  error?: string;
  detail?: string;
};

/** 浏览器 → BFF → camServer `GET /api/v1/pid` */
export async function fetchEoPid(params: {
  entityId: string;
  backendBaseUrl?: string;
}): Promise<{ res: Response; data: FetchEoPidResult }> {
  const qs = new URLSearchParams({ entityId: params.entityId.trim() });
  if (params.backendBaseUrl?.trim()) {
    qs.set("backendBaseUrl", params.backendBaseUrl.trim());
  }
  const res = await fetch(`/api/camera-pid?${qs.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  let data: FetchEoPidResult = { ok: false };
  try {
    data = (await res.json()) as FetchEoPidResult;
  } catch {
    data = { ok: false, error: "invalid_json_response" };
  }
  return { res, data };
}

export type PostEoPidUpdateResult = {
  ok?: boolean;
  taskId?: string;
  error?: string;
  detail?: string;
  message?: string;
};

/** 浏览器 → BFF → camServer `type.casia.tasks.v1.PIDUpdate`（热写 ConfigPID + SetPID） */
export async function postEoPidUpdate(params: {
  entityId: string;
  pid: CameraPidParams;
  backendBaseUrl?: string;
}): Promise<{ res: Response; data: PostEoPidUpdateResult }> {
  const body: Record<string, unknown> = {
    entityId: params.entityId,
    pid: params.pid,
  };
  if (params.backendBaseUrl?.trim()) {
    body.backendBaseUrl = params.backendBaseUrl.trim();
  }
  const res = await fetch("/api/camera-task/pid-update", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  let data: PostEoPidUpdateResult = {};
  try {
    data = (await res.json()) as PostEoPidUpdateResult;
  } catch {
    data = { ok: false, error: "invalid_json_response" };
  }
  return { res, data };
}

export function resolvePidUpstreamBase(explicit?: string): string {
  const raw = explicit?.trim() || getCameraEntityBaseUrl();
  return raw.replace(/\/+$/, "");
}
