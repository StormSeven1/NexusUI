/** 相机评估 API（camera.eval.v1 CameraEvaluationService） */

export interface CameraSharpnessResult {
  combined_score?: number;
  edge_component?: number;
  texture_component?: number;
  timestamp_unix_ms?: number;
  error_message?: string;
}

export interface CameraVisibilityResult {
  visibility?: number;
  updated_at_unix_ms?: number;
  last_task_id?: string;
  error_message?: string;
}

export interface PointingAccuracySample {
  camera_entity_id?: string;
  range_band?: string;
  track_id?: number;
  unique_id?: number;
  longitude?: number;
  latitude?: number;
  azimuth?: number;
  distance?: number;
  p_at_track_start?: number;
  t_at_track_start?: number;
  zoom_at_arrival?: number;
  p_when_centered?: number;
  t_when_centered?: number;
  zoom_at_center?: number;
  delta_p?: number;
  delta_t?: number;
  success?: boolean;
  fail_reason?: string;
}

export interface PointingAccuracyResult {
  samples?: PointingAccuracySample[];
  mean_delta_p?: number;
  mean_delta_t?: number;
  all_bands_ok?: boolean;
  completed_at_unix_ms?: number;
  error_message?: string;
}

export interface PointingAccuracyTargetInput {
  track_id: number;
  unique_id: number;
  longitude: number;
  latitude: number;
  azimuth: number;
  distance: number;
  range_band: string;
  ship_type: number;
  rect_type: number;
}

export interface CameraEvalApiEnvelope<T> {
  code: number;
  message: string;
  data?: T & { error_message?: string | null; grpc_target?: string };
  timestamp?: string;
  error?: string;
  detail?: string;
  backend?: string;
}

function parseApiError(json: CameraEvalApiEnvelope<unknown>, res: Response): string {
  const parts = [
    json.message,
    json.error,
    json.detail,
    json.data?.error_message,
    json.backend ? `backend=${json.backend}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : `HTTP ${res.status}`;
}

async function readApiJson<T>(res: Response): Promise<{ json: CameraEvalApiEnvelope<T> | null; raw: string }> {
  const raw = await res.text();
  const trimmed = raw.trim();
  if (!trimmed) {
    return { json: null, raw };
  }
  try {
    return { json: JSON.parse(trimmed) as CameraEvalApiEnvelope<T>, raw };
  } catch {
    return { json: null, raw };
  }
}

function formatHttpError(res: Response, raw: string, json: CameraEvalApiEnvelope<unknown> | null): string {
  if (json) return parseApiError(json, res);
  const snippet = raw.trim().slice(0, 120);
  return snippet ? `HTTP ${res.status}: ${snippet}` : `HTTP ${res.status}`;
}

export async function fetchCameraSharpness(
  cameraEntityId: string,
  returnComponents = true,
): Promise<{ sharpness: CameraSharpnessResult | null; error: string | null }> {
  const res = await fetch("/api/system-eval/camera/sharpness", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      camera_entity_id: cameraEntityId,
      return_components: returnComponents,
    }),
    cache: "no-store",
  });
  const { json, raw } = await readApiJson<{ sharpness?: CameraSharpnessResult | null }>(res);
  if (!res.ok || !json) {
    return { sharpness: null, error: formatHttpError(res, raw, json) };
  }
  const sharpness = json.data?.sharpness ?? null;
  const grpcErr = json.data?.error_message?.trim();
  if (grpcErr && !sharpness?.combined_score) {
    return { sharpness: null, error: grpcErr };
  }
  return { sharpness, error: grpcErr || null };
}

export async function triggerCameraVisibilityCheck(
  cameraEntityId: string,
  timeoutMs = 120000,
): Promise<{ taskId: string | null; accepted: boolean; error: string | null }> {
  const res = await fetch("/api/system-eval/camera/visibility/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      camera_entity_id: cameraEntityId,
      timeout_ms: timeoutMs,
    }),
    cache: "no-store",
  });
  const { json, raw } = await readApiJson<{
    trigger?: { task_id?: string; accepted?: boolean; error_message?: string };
  }>(res);
  if (!res.ok || !json) {
    return { taskId: null, accepted: false, error: formatHttpError(res, raw, json) };
  }
  const trigger = json.data?.trigger;
  const grpcErr = (trigger?.error_message || json.data?.error_message || "").trim();
  return {
    taskId: trigger?.task_id ?? null,
    accepted: Boolean(trigger?.accepted),
    error: grpcErr || null,
  };
}

export async function fetchCameraVisibility(
  cameraEntityId: string,
): Promise<{ visibility: CameraVisibilityResult | null; error: string | null }> {
  const q = encodeURIComponent(cameraEntityId);
  const res = await fetch(`/api/system-eval/camera/visibility?camera_entity_id=${q}`, {
    cache: "no-store",
  });
  const { json, raw } = await readApiJson<{ visibility?: CameraVisibilityResult | null }>(res);
  if (!res.ok || !json) {
    return { visibility: null, error: formatHttpError(res, raw, json) };
  }
  return {
    visibility: json.data?.visibility ?? null,
    error: json.data?.error_message?.trim() || null,
  };
}

/** 能见度能力值 → 归一化得分（0~1，与 watch-sys-camera 内部 score/24 对应） */
export function visibilityToNormalizedScore(visibility: number): number {
  if (!Number.isFinite(visibility)) return 0;
  const normalized = (visibility - 1000) / 15000;
  return Math.max(0, Math.min(1, normalized));
}

export function formatSharpnessScore(v: number | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(2);
}

export function formatVisibilityValue(v: number | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return Math.round(v).toLocaleString();
}

export const VISIBILITY_POLL_MS = 2000;
export const VISIBILITY_POLL_TIMEOUT_MS = 120000;
export const POINTING_ACCURACY_POLL_MS = 2000;
export const POINTING_ACCURACY_POLL_TIMEOUT_MS = 120000;

export const POINTING_LOOKBACK_PRESETS = [
  { label: "1小时", hours: 1 },
  { label: "6小时", hours: 6 },
  { label: "1天", hours: 24 },
  { label: "2天", hours: 48 },
  { label: "3天", hours: 72 },
  { label: "10天", hours: 240 },
  { label: "30天", hours: 720 },
] as const;

export const POINTING_DEFAULT_LOOKBACK_HOURS = 72;

export async function triggerCameraPointingAccuracyEval(
  cameraEntityId: string,
  timeoutMs = POINTING_ACCURACY_POLL_TIMEOUT_MS,
): Promise<{ taskId: string | null; accepted: boolean; error: string | null }> {
  const res = await fetch("/api/system-eval/camera/pointing-accuracy/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      camera_entity_id: cameraEntityId,
      timeout_ms: timeoutMs,
    }),
    cache: "no-store",
  });
  const { json, raw } = await readApiJson<{
    trigger?: { task_id?: string; accepted?: boolean; error_message?: string };
  }>(res);
  if (!res.ok || !json) {
    return { taskId: null, accepted: false, error: formatHttpError(res, raw, json) };
  }
  const trigger = json.data?.trigger;
  const grpcErr = (trigger?.error_message || json.data?.error_message || "").trim();
  return {
    taskId: trigger?.task_id ?? null,
    accepted: Boolean(trigger?.accepted),
    error: grpcErr || null,
  };
}

export async function fetchCameraPointingAccuracyResult(
  cameraEntityId: string,
  taskId?: string,
  lookbackHours = POINTING_DEFAULT_LOOKBACK_HOURS,
): Promise<{ result: PointingAccuracyResult | null; error: string | null }> {
  const params = new URLSearchParams({
    camera_entity_id: cameraEntityId,
    lookback_hours: String(Math.max(0, lookbackHours)),
  });
  if (taskId) params.set("task_id", taskId);
  const res = await fetch(`/api/system-eval/camera/pointing-accuracy?${params.toString()}`, {
    cache: "no-store",
  });
  const { json, raw } = await readApiJson<{ result?: PointingAccuracyResult | null }>(res);
  if (!res.ok || !json) {
    return { result: null, error: formatHttpError(res, raw, json) };
  }
  return {
    result: json.data?.result ?? null,
    error: json.data?.error_message?.trim() || null,
  };
}

export function filterPointingAccuracySamplesForCamera(
  samples: PointingAccuracySample[] | undefined,
  cameraEntityId: string,
): PointingAccuracySample[] {
  const id = cameraEntityId.trim();
  if (!id) return [];
  return (samples ?? []).filter((s) => s.camera_entity_id?.trim() === id);
}

export function formatDeltaDeg(v: number | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(3)}°`;
}
