import { getCameraEntityBaseUrl } from "@/lib/entityUpstream";

/** 光电运动参数字段（原 Global，现按相机存储） */
export type MotionParamsFields = {
  speed_turn: number;
  turn_t: number;
  multiple: number;
  multiple_angle: number;
  angle_limit: number;
  ht_angle: number;
  t_move: number;
  track_T: number;
};

/** @deprecated 兼容旧命名：默认值 / Global 回退 */
export type MotionGlobalParams = MotionParamsFields;

/** 光电运动参数 · 单相机（ConfigMotion.ini [CAMERA{n}]） */
export type MotionCameraParams = MotionParamsFields & {
  cameraIndex: number;
  entityId: string;
  hasPtz?: boolean;
  /** 主相机（HasParent==0 / 无上级） */
  parent?: boolean;
  /** 第三方相机 */
  thirdParty?: boolean;
  angle_alter: number;
  dis_alter: number;
};

export const EMPTY_MOTION_FIELDS: MotionParamsFields = {
  speed_turn: 25,
  turn_t: 15,
  multiple: 5,
  multiple_angle: 5,
  angle_limit: 20,
  ht_angle: 2,
  t_move: 1.5,
  track_T: 2.5,
};

/** @deprecated 兼容旧命名 */
export const EMPTY_MOTION_GLOBAL = EMPTY_MOTION_FIELDS;

export const EMPTY_MOTION_CAMERA: MotionCameraParams = {
  cameraIndex: -1,
  entityId: "",
  angle_alter: 0.75,
  dis_alter: 70,
  ...EMPTY_MOTION_FIELDS,
};

export const MOTION_PARAM_KEYS: (keyof MotionParamsFields)[] = [
  "speed_turn",
  "turn_t",
  "multiple",
  "multiple_angle",
  "angle_limit",
  "ht_angle",
  "t_move",
  "track_T",
];

export type FetchEoMotionParamsResult = {
  ok: boolean;
  global?: MotionGlobalParams;
  cameras?: MotionCameraParams[];
  cameraIndex?: number;
  error?: string;
  detail?: string;
};

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function parseMotionFields(
  raw: unknown,
  fallback: MotionParamsFields = EMPTY_MOTION_FIELDS,
): MotionParamsFields | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    speed_turn: num(o.speed_turn, fallback.speed_turn),
    turn_t: num(o.turn_t, fallback.turn_t),
    multiple: num(o.multiple, fallback.multiple),
    multiple_angle: num(o.multiple_angle, fallback.multiple_angle),
    angle_limit: num(o.angle_limit, fallback.angle_limit),
    ht_angle: num(o.ht_angle, fallback.ht_angle),
    t_move: num(o.t_move, fallback.t_move),
    track_T: num(o.track_T, fallback.track_T),
  };
}

/** @deprecated 兼容旧命名 */
export function parseMotionGlobal(raw: unknown): MotionGlobalParams | null {
  return parseMotionFields(raw);
}

export function parseMotionCamera(
  raw: unknown,
  fallbackFields: MotionParamsFields = EMPTY_MOTION_FIELDS,
): MotionCameraParams | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const entityId = typeof o.entityId === "string" ? o.entityId.trim() : "";
  const cameraIndex = Math.trunc(num(o.cameraIndex, -1));
  if (!entityId && cameraIndex < 0) return null;
  const fields = parseMotionFields(o, fallbackFields) ?? fallbackFields;
  return {
    cameraIndex,
    entityId: entityId || `camera_${String(cameraIndex).padStart(3, "0")}`,
    hasPtz: o.hasPtz === true || o.hasPtz === 1 || o.hasPtz === "1",
    parent: o.parent === true || o.parent === 1 || o.parent === "1",
    thirdParty: o.thirdParty === true || o.thirdParty === 1 || o.thirdParty === "1",
    angle_alter: num(o.angle_alter, EMPTY_MOTION_CAMERA.angle_alter),
    dis_alter: num(o.dis_alter, EMPTY_MOTION_CAMERA.dis_alter),
    ...fields,
  };
}

/** 可选相机：hasPtz、主相机、非第三方 */
export function isEditableMotionCamera(c: MotionCameraParams): boolean {
  return c.hasPtz === true && c.parent === true && c.thirdParty !== true;
}

/** 浏览器 → BFF → camServer `GET /api/v1/motion-params` */
export async function fetchEoMotionParams(params?: {
  backendBaseUrl?: string;
}): Promise<{ res: Response; data: FetchEoMotionParamsResult }> {
  const qs = new URLSearchParams();
  if (params?.backendBaseUrl?.trim()) {
    qs.set("backendBaseUrl", params.backendBaseUrl.trim());
  }
  const url = qs.size > 0 ? `/api/camera-motion-params?${qs}` : "/api/camera-motion-params";
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  let data: FetchEoMotionParamsResult = { ok: false };
  try {
    data = (await res.json()) as FetchEoMotionParamsResult;
  } catch {
    data = { ok: false, error: "invalid_json_response" };
  }
  return { res, data };
}

/** 浏览器 → BFF → camServer `POST /api/v1/motion-params`（热写指定相机） */
export async function postEoMotionParams(params: {
  cameraIndex: number;
  entityId?: string;
  camera: MotionParamsFields & Partial<Pick<MotionCameraParams, "angle_alter" | "dis_alter">>;
  backendBaseUrl?: string;
}): Promise<{ res: Response; data: FetchEoMotionParamsResult }> {
  const body: Record<string, unknown> = {
    cameraIndex: params.cameraIndex,
    camera: params.camera,
  };
  if (params.entityId?.trim()) body.entityId = params.entityId.trim();
  if (params.backendBaseUrl?.trim()) {
    body.backendBaseUrl = params.backendBaseUrl.trim();
  }
  const res = await fetch("/api/camera-motion-params", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  let data: FetchEoMotionParamsResult = { ok: false };
  try {
    data = (await res.json()) as FetchEoMotionParamsResult;
  } catch {
    data = { ok: false, error: "invalid_json_response" };
  }
  return { res, data };
}

export function resolveMotionUpstreamBase(explicit?: string): string {
  const raw = explicit?.trim() || getCameraEntityBaseUrl();
  return raw.replace(/\/+$/, "");
}
