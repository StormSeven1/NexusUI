/**
 * 无人机画面经纬度投影（对齐 20260728_周士胜 / listen_RTMP_20260728.py）
 * - lonlat_to_pixel：目标经纬 + 云台姿态 → 像素
 * - clip_ray_to_bounds：画面外点用射线裁到边界
 * - 广角内参：按视频分辨率自适应（满宽度缩放）
 */

export const EARTH_RADIUS_M = 6_371_000;

/** 原生像素焦距（焦距 6.78mm / 像元 1.197μm）≈5664.16 @ 8064 宽 */
export const WIDE_CAM_FX_NATIVE_PX = 6.78 / 0.001197;

/** 已验证分辨率下的 fx=fy */
export const WIDE_CAM_FX_BY_RESOLUTION: Readonly<Record<string, number>> = {
  "1280x720": 900.0,
  "960x720": 674.3,
};

/** 威海本地默认地面基准高度（与算法 --plane_h=16 一致；height 为相对起飞点高度） */
export const DEFAULT_UAV_PROJECT_PLANE_H_M = 16;

export type UavProjectPose = {
  longitude: number;
  latitude: number;
  /** OSD `height`：相对起飞点高度（米） */
  heightM: number;
  gimbalRollDeg: number;
  gimbalPitchDeg: number;
  gimbalYawDeg: number;
};

export type UavCamIntrinsics = {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
};

export type LonLatPoint = { lon: number; lat: number };

/** 航点经纬 + 显示序号（优先载荷 index）+ 可选高度（米，优先 ASL/载荷 height） */
export type FlightPathWaypoint = LonLatPoint & { index: number; heightM: number | null };

export type ProjectedPixel = {
  lon: number;
  lat: number;
  u: number | null;
  v: number | null;
  /** false = 镜头后方，无法成像 */
  valid: boolean;
  /** valid 且落在 [0,W)×[0,H) */
  inFrame: boolean;
};

export type ProjectDrawSegment =
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "ray"; x1: number; y1: number; x2: number; y2: number };

export type ProjectDrawPoint = { x: number; y: number; lon: number; lat: number };

export type ProjectPolylineDraw = {
  points: ProjectDrawPoint[];
  segments: ProjectDrawSegment[];
};

export function resolveWideCamIntrinsics(width: number, height: number): UavCamIntrinsics | null {
  const W = Math.round(width);
  const H = Math.round(height);
  if (!(W > 0 && H > 0)) return null;
  const key = `${W}x${H}`;
  const known = WIDE_CAM_FX_BY_RESOLUTION[key];
  const fx = known ?? WIDE_CAM_FX_NATIVE_PX * (W / 8064);
  return { fx, fy: fx, cx: W / 2, cy: H / 2, width: W, height: H };
}

/**
 * 已知目标经纬与无人机姿态，反算像素坐标。
 * valid=false 表示目标在镜头后方。
 * @param planeH 回退水平面高度（米）；未传 targetHeightM 时 mz = planeH − heightM
 * @param targetHeightM 目标点高度（米，与 pose.heightM 同基准）；传入时 mz = targetHeightM − heightM
 */
export function lonLatToPixel(
  intr: Pick<UavCamIntrinsics, "fx" | "fy" | "cx" | "cy">,
  pose: UavProjectPose,
  targetLon: number,
  targetLat: number,
  planeH = DEFAULT_UAV_PROJECT_PLANE_H_M,
  targetHeightM?: number | null,
): { u: number | null; v: number | null; valid: boolean } {
  const deltaLat = targetLat - pose.latitude;
  const deltaLon = targetLon - pose.longitude;
  const detY = (deltaLat * Math.PI) / 180 * EARTH_RADIUS_M;
  const detX =
    (deltaLon * Math.PI) / 180 * EARTH_RADIUS_M * Math.cos((pose.latitude * Math.PI) / 180);

  let yaw = pose.gimbalYawDeg;
  if (yaw < -180) yaw += 360;
  if (yaw > 180) yaw -= 360;
  const yawR = (yaw * Math.PI) / 180;
  const pitchR = (pose.gimbalPitchDeg * Math.PI) / 180;

  // 与 cal_long_lat 中 Extrinsics 旋转部分一致（正交 → 逆=转置）
  const R = [
    [Math.cos(yawR), Math.sin(yawR) * Math.sin(pitchR), Math.sin(yawR) * Math.cos(pitchR)],
    [-Math.sin(yawR), Math.cos(yawR) * Math.sin(pitchR), Math.cos(yawR) * Math.cos(pitchR)],
    [0, -Math.cos(pitchR), Math.sin(pitchR)],
  ] as const;

  const wx = detX;
  const wy = detY;
  const targetH =
    targetHeightM != null && Number.isFinite(targetHeightM) ? targetHeightM : planeH;
  const wz = targetH - pose.heightM;
  // P_c = R^T @ world_point
  const pcx = R[0][0] * wx + R[1][0] * wy + R[2][0] * wz;
  const pcy = R[0][1] * wx + R[1][1] * wy + R[2][1] * wz;
  const pcz = R[0][2] * wx + R[1][2] * wy + R[2][2] * wz;

  if (pcz <= 0) return { u: null, v: null, valid: false };

  const u = intr.cx + (intr.fx * pcx) / pcz;
  const v = intr.cy + (intr.fy * pcy) / pcz;
  return { u, v, valid: true };
}

/** Liang-Barsky：从画面内点朝外点裁到矩形边界 */
export function clipRayToBounds(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  W: number,
  H: number,
): { x: number; y: number } | null {
  const seg = clipSegmentToBounds(x1, y1, x2, y2, W, H);
  if (!seg) return null;
  // 射线终点取远离起点的那一端
  const d1 = (seg.x1 - x1) ** 2 + (seg.y1 - y1) ** 2;
  const d2 = (seg.x2 - x1) ** 2 + (seg.y2 - y1) ** 2;
  return d2 >= d1 ? { x: seg.x2, y: seg.y2 } : { x: seg.x1, y: seg.y1 };
}

/** Liang-Barsky：线段与矩形求交（两端均可在画面外，只要穿过视野就返回可见段） */
export function clipSegmentToBounds(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  W: number,
  H: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const clips: Array<[number, number]> = [
    [-dx, x1],
    [dx, W - x1],
    [-dy, y1],
    [dy, H - y1],
  ];
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  if (t0 > t1) return null;
  return {
    x1: x1 + t0 * dx,
    y1: y1 + t0 * dy,
    x2: x1 + t1 * dx,
    y2: y1 + t1 * dy,
  };
}

export function projectLonLatPoints(
  intr: UavCamIntrinsics,
  pose: UavProjectPose,
  points: LonLatPoint[],
  planeH = DEFAULT_UAV_PROJECT_PLANE_H_M,
): ProjectedPixel[] {
  return points.map((p) => {
    const { u, v, valid } = lonLatToPixel(intr, pose, p.lon, p.lat, planeH);
    const inFrame = Boolean(valid && u != null && v != null && u >= 0 && u < intr.width && v >= 0 && v < intr.height);
    return { lon: p.lon, lat: p.lat, u, v, valid, inFrame };
  });
}

export type RouteTrapezoidCorners = {
  /** 后窄边左、后窄边右、前宽边右、前宽边左（海面经纬） */
  corners: [LonLatPoint, LonLatPoint, LonLatPoint, LonLatPoint];
};

function offsetLonLatMeters(lon: number, lat: number, eastM: number, northM: number): LonLatPoint {
  const dLat = (northM / EARTH_RADIUS_M) * (180 / Math.PI);
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dLon = cosLat > 1e-8 ? (eastM / (EARTH_RADIUS_M * cosLat)) * (180 / Math.PI) : 0;
  return { lon: lon + dLon, lat: lat + dLat };
}

/** 海面东向/北向米制偏移（供走廊侧点收窄重试等） */
export function offsetLonLatByMeters(lon: number, lat: number, eastM: number, northM: number): LonLatPoint {
  return offsetLonLatMeters(lon, lat, eastM, northM);
}

function enuDeltaM(a: LonLatPoint, b: LonLatPoint): { east: number; north: number; len: number } {
  const midLat = (a.lat + b.lat) / 2;
  const cosMid = Math.cos((midLat * Math.PI) / 180);
  const east = ((b.lon - a.lon) * Math.PI) / 180 * EARTH_RADIUS_M * cosMid;
  const north = ((b.lat - a.lat) * Math.PI) / 180 * EARTH_RADIUS_M;
  return { east, north, len: Math.hypot(east, north) };
}

/**
 * 航线走廊梯形（海面）：后窄（靠近无人机）前宽（靠近航点）。
 * @param backHalfWidthM 后端半宽（米）
 * @param frontHalfWidthM 前端半宽（米）
 */
export function buildRouteTrapezoidCorners(
  start: LonLatPoint,
  end: LonLatPoint,
  backHalfWidthM = 36,
  frontHalfWidthM = 8,
): RouteTrapezoidCorners | null {
  const { east, north, len } = enuDeltaM(start, end);
  if (!(len > 0.5)) return null;

  const ux = east / len;
  const uy = north / len;
  // 左法向
  const px = -uy;
  const py = ux;

  // 起点略沿航向前移，避免正下方点在俯视外仍贴机腹难投影
  const backAlong = Math.min(10, len * 0.08);
  const back = offsetLonLatMeters(start.lon, start.lat, backAlong * ux, backAlong * uy);

  const bl = offsetLonLatMeters(back.lon, back.lat, px * backHalfWidthM, py * backHalfWidthM);
  const br = offsetLonLatMeters(back.lon, back.lat, -px * backHalfWidthM, -py * backHalfWidthM);
  const fr = offsetLonLatMeters(end.lon, end.lat, -px * frontHalfWidthM, -py * frontHalfWidthM);
  const fl = offsetLonLatMeters(end.lon, end.lat, px * frontHalfWidthM, py * frontHalfWidthM);
  return { corners: [bl, br, fr, fl] };
}

export type RouteRibbonVertex = {
  center: LonLatPoint;
  left: LonLatPoint;
  right: LonLatPoint;
  halfWidthM: number;
};

/**
 * 连续折线走廊：每个折点共用左右边界点（角平分法向），段与段在航点处顶边/底边自然对齐。
 * halfWidthAt(t) 中 t∈[0,1] 为从起点起的归一化弧长。
 */
export function buildContinuousRouteRibbonVertices(
  chain: LonLatPoint[],
  halfWidthAt: (t: number) => number,
): RouteRibbonVertex[] {
  if (chain.length < 2) return [];

  const n = chain.length;
  const segLens: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < n - 1; i++) {
    const len = Math.max(enuDeltaM(chain[i]!, chain[i + 1]!).len, 0.01);
    segLens.push(len);
    totalLen += len;
  }

  const tAt: number[] = new Array(n);
  tAt[0] = 0;
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    acc += segLens[i]!;
    tAt[i + 1] = acc / totalLen;
  }

  /** 每段单位切向（东、北） */
  const tangents: Array<{ ux: number; uy: number }> = [];
  for (let i = 0; i < n - 1; i++) {
    const { east, north, len } = enuDeltaM(chain[i]!, chain[i + 1]!);
    const L = Math.max(len, 1e-6);
    tangents.push({ ux: east / L, uy: north / L });
  }

  const out: RouteRibbonVertex[] = [];
  for (let i = 0; i < n; i++) {
    let ux: number;
    let uy: number;
    if (i === 0) {
      ux = tangents[0]!.ux;
      uy = tangents[0]!.uy;
    } else if (i === n - 1) {
      ux = tangents[n - 2]!.ux;
      uy = tangents[n - 2]!.uy;
    } else {
      // 角平分：相邻切向单位化和，保证折角处左右边界连续
      const a = tangents[i - 1]!;
      const b = tangents[i]!;
      ux = a.ux + b.ux;
      uy = a.uy + b.uy;
      const L = Math.hypot(ux, uy);
      if (L < 1e-6) {
        ux = b.ux;
        uy = b.uy;
      } else {
        ux /= L;
        uy /= L;
      }
    }
    const px = -uy;
    const py = ux;
    const half = halfWidthAt(tAt[i]!);
    const c = chain[i]!;
    out.push({
      center: c,
      left: offsetLonLatMeters(c.lon, c.lat, px * half, py * half),
      right: offsetLonLatMeters(c.lon, c.lat, -px * half, -py * half),
      halfWidthM: half,
    });
  }
  return out;
}

export type BuildPolylineDrawOpts = {
  /**
   * 不画圆点的前缀点数（例如航线起点是无人机当前位置，只连线不画航点圆）。
   * 默认 0。
   */
  skipPointMarkers?: number;
};

/**
 * 将投影点序列转为可绘制几何：
 * - 画面内点 → 圆点（可跳过前缀）
 * - 相邻两点均可成像 → 裁剪到画面内的线段（两端在外但穿过视野也会画）
 * - 仅一端可成像 → 从该端朝另一端方向画到边界的射线
 */
export function buildPolylineDraw(
  intr: UavCamIntrinsics,
  projected: ProjectedPixel[],
  opts?: BuildPolylineDrawOpts,
): ProjectPolylineDraw {
  const skip = Math.max(0, opts?.skipPointMarkers ?? 0);
  const points: ProjectDrawPoint[] = [];
  const segments: ProjectDrawSegment[] = [];

  for (let i = 0; i < projected.length; i++) {
    if (i < skip) continue;
    const pt = projected[i]!;
    if (pt.inFrame && pt.u != null && pt.v != null) {
      points.push({ x: pt.u, y: pt.v, lon: pt.lon, lat: pt.lat });
    }
  }

  for (let i = 0; i < projected.length - 1; i++) {
    const cur = projected[i]!;
    const nxt = projected[i + 1]!;
    const curOk = cur.valid && cur.u != null && cur.v != null;
    const nxtOk = nxt.valid && nxt.u != null && nxt.v != null;

    if (curOk && nxtOk) {
      const clipped = clipSegmentToBounds(cur.u!, cur.v!, nxt.u!, nxt.v!, intr.width, intr.height);
      if (!clipped) continue;
      const bothIn = cur.inFrame && nxt.inFrame;
      segments.push({
        kind: bothIn ? "line" : "ray",
        x1: clipped.x1,
        y1: clipped.y1,
        x2: clipped.x2,
        y2: clipped.y2,
      });
      continue;
    }

    // 仅一端可成像：从画面内（或可成像）端朝另一端画射线到边界
    if (curOk && cur.inFrame && !nxtOk) {
      // 无方向，跳过
      continue;
    }
    if (nxtOk && nxt.inFrame && !curOk) {
      continue;
    }
  }

  return { points, segments };
}

/** 从 drone_flight_path 任务载荷提取航点 [lon,lat][]（对齐 drones-maplibre extractWaypoints） */
export function extractFlightPathLonLats(task: Record<string, unknown> | null | undefined): LonLatPoint[] {
  return extractFlightPathWaypoints(task).map(({ lon, lat }) => ({ lon, lat }));
}

/**
 * 提取航点并带序号：
 * - 载荷有 `index`/`wpIndex` 时用之；若最小为 0 则显示时 +1（0-based → 1-based）
 * - 否则按数组顺序 1..n
 */
export function extractFlightPathWaypoints(
  task: Record<string, unknown> | null | undefined,
): FlightPathWaypoint[] {
  if (!task) return [];
  const tryArr = (v: unknown): unknown[] | null => (Array.isArray(v) && v.length >= 1 ? v : null);
  const direct =
    tryArr(task.waypoints) ??
    tryArr(task.points) ??
    tryArr(task.flightPoints) ??
    tryArr(task.route) ??
    tryArr(task.flight_path) ??
    null;
  let raw = direct;
  if (!raw) {
    for (const key of ["data", "payload", "flightPlan"] as const) {
      const inner = task[key];
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        const o = inner as Record<string, unknown>;
        raw =
          tryArr(o.waypoints) ??
          tryArr(o.points) ??
          tryArr(o.flightPoints) ??
          tryArr(o.route) ??
          null;
        if (raw) break;
      }
    }
  }
  if (!raw) return [];

  const parsed: Array<LonLatPoint & { rawIndex: number | null; heightM: number | null }> = [];
  for (const wp of raw) {
    if (!wp || typeof wp !== "object") continue;
    const o = wp as Record<string, unknown>;
    const pos = o.position ?? o.location ?? o.coordinate ?? o.coord;
    let lon: number;
    let lat: number;
    if (pos && typeof pos === "object" && !Array.isArray(pos)) {
      const p = pos as Record<string, unknown>;
      lon = Number(p.longitude ?? p.lng ?? p.lon);
      lat = Number(p.latitude ?? p.lat);
    } else {
      lon = Number(o.longitude ?? o.lng ?? o.lon);
      lat = Number(o.latitude ?? o.lat);
    }
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const ri = Number(o.index ?? o.wpIndex ?? o.waypointIndex);
    const hRaw = Number(o.height ?? o.altitude ?? o.alt ?? o.heightM);
    parsed.push({
      lon,
      lat,
      rawIndex: Number.isFinite(ri) ? Math.floor(ri) : null,
      heightM: Number.isFinite(hRaw) ? hRaw : null,
    });
  }
  if (parsed.length === 0) return [];

  const hasAnyIndex = parsed.some((p) => p.rawIndex != null);
  if (hasAnyIndex) {
    const idxs = parsed.map((p) => p.rawIndex).filter((x): x is number => x != null);
    const minIdx = Math.min(...idxs);
    const zeroBased = minIdx === 0;
    return parsed.map((p, i) => {
      const base = p.rawIndex != null ? p.rawIndex : i + (zeroBased ? 0 : 1);
      return {
        lon: p.lon,
        lat: p.lat,
        index: zeroBased ? base + 1 : base,
        heightM: p.heightM,
      };
    });
  }
  return parsed.map((p, i) => ({ lon: p.lon, lat: p.lat, index: i + 1, heightM: p.heightM }));
}
