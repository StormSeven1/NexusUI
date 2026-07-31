/** 对海对准区段（ConfigAIM{N}.ini [Sea{i}]） */
export type AimSeaSegment = {
  index: number;
  minAzi: number;
  maxAzi: number;
  minDis: number;
  maxDis: number;
  /** 15 个冒号分隔系数 */
  seaParamP: string;
  seaParamT: string;
  /** 该区段俯仰 T：0=三角函数，1=多项式 */
  Tparam_type?: number;
};

/** 单相机对准参数 */
export type AimCameraParams = {
  cameraIndex: number;
  entityId: string;
  hasPtz?: boolean;
  parent?: boolean;
  /** 是否已有 aimConf/ConfigAIM{N}.ini */
  hasAim?: boolean;
  /** 对海 aimConfig 启用（Basic/SeaAimEnabled=1；启用时装载全部 [Sea*]） */
  seaAimEnabled?: boolean;
  /** 文件中发现的对海区段数量 */
  seaSegmentCount?: number;
  /** 对空 aimConfig 启用（Basic/SkyAimEnabled=1） */
  skyAimEnabled?: boolean;
  skyParamT: string;
  sea: AimSeaSegment[];
};

export type FetchEoAimParamsResult = {
  ok: boolean;
  cameras?: AimCameraParams[];
  camera?: AimCameraParams;
  error?: string;
  detail?: string;
};

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function parseAimSeaSegment(raw: unknown, fallbackIndex = 0): AimSeaSegment | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    index: Math.trunc(num(o.index, fallbackIndex)),
    minAzi: num(o.minAzi),
    maxAzi: num(o.maxAzi),
    minDis: num(o.minDis),
    maxDis: num(o.maxDis),
    seaParamP: typeof o.seaParamP === "string" ? o.seaParamP : "",
    seaParamT: typeof o.seaParamT === "string" ? o.seaParamT : "",
    Tparam_type: Math.trunc(num(o.Tparam_type ?? o.tParamType, 0)),
  };
}

export function parseAimCamera(raw: unknown): AimCameraParams | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const cameraIndex = Math.trunc(num(o.cameraIndex, -1));
  const entityId = typeof o.entityId === "string" ? o.entityId.trim() : "";
  if (!entityId && cameraIndex < 0) return null;
  const sea: AimSeaSegment[] = [];
  if (Array.isArray(o.sea)) {
    o.sea.forEach((row, i) => {
      const s = parseAimSeaSegment(row, i);
      if (s) sea.push(s);
    });
  }
  return {
    cameraIndex,
    entityId: entityId || `camera_${String(cameraIndex).padStart(3, "0")}`,
    hasPtz: o.hasPtz === true || o.hasPtz === 1 || o.hasPtz === "1",
    parent: o.parent === true || o.parent === 1 || o.parent === "1",
    hasAim: o.hasAim === true || o.hasAim === 1 || o.hasAim === "1",
    seaAimEnabled: o.seaAimEnabled === true || o.seaAimEnabled === 1 || o.seaAimEnabled === "1",
    seaSegmentCount: Math.trunc(num(o.seaSegmentCount, Array.isArray(o.sea) ? o.sea.length : 0)),
    skyAimEnabled: o.skyAimEnabled === true || o.skyAimEnabled === 1 || o.skyAimEnabled === "1",
    skyParamT: typeof o.skyParamT === "string" ? o.skyParamT : "",
    sea,
  };
}

/** 浏览器 → BFF → camServer `GET /api/v1/aim-params` */
export async function fetchEoAimParams(params?: {
  backendBaseUrl?: string;
}): Promise<{ res: Response; data: FetchEoAimParamsResult }> {
  const qs = new URLSearchParams();
  if (params?.backendBaseUrl?.trim()) {
    qs.set("backendBaseUrl", params.backendBaseUrl.trim());
  }
  const url = qs.size > 0 ? `/api/camera-aim-params?${qs}` : "/api/camera-aim-params";
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  let data: FetchEoAimParamsResult = { ok: false };
  try {
    data = (await res.json()) as FetchEoAimParamsResult;
  } catch {
    data = { ok: false, error: "invalid_json_response" };
  }
  return { res, data };
}

/** 浏览器 → BFF → camServer `POST /api/v1/aim-params`（热写 ConfigAIM{N}.ini + 运行时 map） */
export async function postEoAimParams(params: {
  cameraIndex: number;
  skyParamT: string;
  sea: AimSeaSegment[];
  /** true→SeaAimEnabled=1（装载全部区段）；false→SeaAimEnabled=0（关闭，保留 Sea*） */
  seaAimEnabled: boolean;
  /** true→SkyAimEnabled=1(启用)；false→SkyAimEnabled=0(关闭，保留 SkyAimParam) */
  skyAimEnabled: boolean;
  backendBaseUrl?: string;
}): Promise<{ res: Response; data: FetchEoAimParamsResult }> {
  const body: Record<string, unknown> = {
    cameraIndex: params.cameraIndex,
    skyParamT: params.skyParamT,
    seaAimEnabled: params.seaAimEnabled,
    skyAimEnabled: params.skyAimEnabled,
    sea: params.sea.map((s, i) => ({
      index: i,
      minAzi: s.minAzi,
      maxAzi: s.maxAzi,
      minDis: s.minDis,
      maxDis: s.maxDis,
      seaParamP: s.seaParamP,
      seaParamT: s.seaParamT,
      Tparam_type: s.Tparam_type ?? 0,
    })),
  };
  if (params.backendBaseUrl?.trim()) {
    body.backendBaseUrl = params.backendBaseUrl.trim();
  }
  const res = await fetch("/api/camera-aim-params", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  let data: FetchEoAimParamsResult = { ok: false };
  try {
    data = (await res.json()) as FetchEoAimParamsResult;
  } catch {
    data = { ok: false, error: "invalid_json_response" };
  }
  return { res, data };
}
