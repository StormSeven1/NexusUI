import { getCameraEntityBaseUrl } from "@/lib/entityUpstream";

export type AimUpdateResultItem = {
  ok?: boolean;
  aimType?: number;
  path?: string;
  message?: string;
  error?: string;
  detail?: string;
  seamParamCount?: number;
  skyParamT?: string;
  testFile?: boolean;
  target?: string;
  status?: number;
};

export type AimUpdateResponse = {
  ok?: boolean;
  cameraIndex?: number;
  results?: AimUpdateResultItem[];
  error?: string;
  detail?: string;
  note?: string;
};

/** 触发 camServer `POST /api/v1/aim-update`（默认对海+对空，写入 ConfigAIM{N}_test.ini） */
export async function postEoAimUpdate(params: {
  entityId: string;
  backendBaseUrl?: string;
  /** 0=对海 1=对空；不传则两者都更新 */
  aimType?: 0 | 1;
}): Promise<{ res: Response; data: AimUpdateResponse }> {
  const body: Record<string, unknown> = {
    entityId: params.entityId,
  };
  if (params.backendBaseUrl?.trim()) {
    body.backendBaseUrl = params.backendBaseUrl.trim();
  }
  if (params.aimType === 0 || params.aimType === 1) {
    body.aimType = params.aimType;
  }
  const res = await fetch("/api/eo-aim-update", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  let data: AimUpdateResponse = {};
  try {
    data = (await res.json()) as AimUpdateResponse;
  } catch {
    data = { ok: false, error: "invalid_json_response" };
  }
  return { res, data };
}

export function resolveAimUpdateUpstreamBase(explicit?: string): string {
  const raw = explicit?.trim() || getCameraEntityBaseUrl();
  return raw.replace(/\/+$/, "");
}
