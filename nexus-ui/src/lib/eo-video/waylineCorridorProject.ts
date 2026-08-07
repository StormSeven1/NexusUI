/**
 * 任务航线 AR 走廊投影（对齐 ar-wayline-projection.md）
 * - 固定米半宽 + 小孔成像 → 画面自动前宽后窄
 * - 段切点四边形 / 顶点椭圆 / 近端连接梯形
 * - 镜头后方段整段丢弃，边缘延伸用前方段切线
 */

import {
  clipRayToBounds,
  EARTH_RADIUS_M,
  lonLatToPixel,
  offsetLonLatByMeters,
  type FlightPathWaypoint,
  type UavCamIntrinsics,
  type UavProjectPose,
} from "@/lib/eo-video/uavLonLatProject";

/** 走廊左右各偏移半宽（米） */
export const WAYLINE_CORRIDOR_HALF_WIDTH_M = 20;
/** 航点高度减去该值，使走廊沉到机身下方 */
export const WAYLINE_HEIGHT_OFFSET_M = 20;
/** 航点无高度时的回退水平面高度（米） */
export const WAYLINE_FALLBACK_PLANE_H_M = 14;
/** 近端连接段底边半宽（显示像素；再换算到视频像素） */
export const WAYLINE_NEAR_BOTTOM_HALF_DISPLAY_PX = 230;
/** 顶点水平圆采样点数 */
export const WAYLINE_ELLIPSE_SAMPLES = 24;

export const WAYLINE_ROUTE_COLORS = [
  "#FF6355",
  "#F7B500",
  "#00C0A4",
  "#3E7EFF",
  "#A855F7",
  "#FF7AC6",
  "#23C28E",
  "#FF9F40",
] as const;

export type WaylinePreparedWp = {
  lon: number;
  lat: number;
  /** 投影用高度（已减高度偏移） */
  heightM: number;
  index: number;
  lonLabel: number;
  latLabel: number;
};

export type Px = { x: number; y: number };

export type WaylineCorridorSegment = {
  /** 左下→右下→右上→左上（视频像素） */
  quad: [Px, Px, Px, Px];
};

export type WaylineEllipseDraw = {
  index: number;
  lon: number;
  lat: number;
  center: Px;
  points: Px[];
  majorHalfPx: number;
  minorHalfPx: number;
  majorLeft: Px;
  majorRight: Px;
};

export type WaylineNearConnector = {
  bottomLeft: Px;
  bottomRight: Px;
  farLeft: Px;
  farRight: Px;
};

export type WaylineCorridorDraw = {
  color: string;
  segments: WaylineCorridorSegment[];
  ellipses: WaylineEllipseDraw[];
  nearConnector: WaylineNearConnector | null;
};

function enuFromPose(
  pose: UavProjectPose,
  lon: number,
  lat: number,
  heightM: number,
): { east: number; north: number; up: number } {
  const east =
    ((lon - pose.longitude) * Math.PI) / 180 * EARTH_RADIUS_M * Math.cos((pose.latitude * Math.PI) / 180);
  const north = ((lat - pose.latitude) * Math.PI) / 180 * EARTH_RADIUS_M;
  const up = heightM - pose.heightM;
  return { east, north, up };
}

function projectEnu(
  intr: UavCamIntrinsics,
  pose: UavProjectPose,
  east: number,
  north: number,
  up: number,
): { u: number; v: number; valid: boolean } {
  let yaw = pose.gimbalYawDeg;
  if (yaw < -180) yaw += 360;
  if (yaw > 180) yaw -= 360;
  const yawR = (yaw * Math.PI) / 180;
  const pitchR = (pose.gimbalPitchDeg * Math.PI) / 180;
  const R = [
    [Math.cos(yawR), Math.sin(yawR) * Math.sin(pitchR), Math.sin(yawR) * Math.cos(pitchR)],
    [-Math.sin(yawR), Math.cos(yawR) * Math.sin(pitchR), Math.cos(yawR) * Math.cos(pitchR)],
    [0, -Math.cos(pitchR), Math.sin(pitchR)],
  ] as const;
  const pcx = R[0][0] * east + R[1][0] * north + R[2][0] * up;
  const pcy = R[0][1] * east + R[1][1] * north + R[2][1] * up;
  const pcz = R[0][2] * east + R[1][2] * north + R[2][2] * up;
  if (pcz <= 0) return { u: 0, v: 0, valid: false };
  return {
    u: intr.cx + (intr.fx * pcx) / pcz,
    v: intr.cy + (intr.fy * pcy) / pcz,
    valid: true,
  };
}

function projectWp(
  intr: UavCamIntrinsics,
  pose: UavProjectPose,
  wp: WaylinePreparedWp,
): { u: number; v: number; valid: boolean } {
  const pr = lonLatToPixel(intr, pose, wp.lon, wp.lat, WAYLINE_FALLBACK_PLANE_H_M, wp.heightM);
  if (!pr.valid || pr.u == null || pr.v == null) return { u: 0, v: 0, valid: false };
  return { u: pr.u, v: pr.v, valid: true };
}

export function colorForDroneSn(sn: string): string {
  let h = 2166136261;
  for (let i = 0; i < sn.length; i++) {
    h ^= sn.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return WAYLINE_ROUTE_COLORS[Math.abs(h) % WAYLINE_ROUTE_COLORS.length]!;
}

export function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(raw) ?? /^#?([0-9a-fA-F]{3})$/.exec(raw);
  if (!m) return `rgba(45,140,240,${alpha})`;
  let h = m[1]!;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 丢首点；高度 max(0, h - offset)，缺高度用回退平面。
 * 原列表少于 2 个返回空。
 */
export function prepareWaylineWaypoints(wps: FlightPathWaypoint[]): WaylinePreparedWp[] {
  if (wps.length < 2) return [];
  const rest = wps.slice(1);
  return rest.map((wp) => {
    const rawH = wp.heightM != null && Number.isFinite(wp.heightM) ? wp.heightM : WAYLINE_FALLBACK_PLANE_H_M;
    return {
      lon: wp.lon,
      lat: wp.lat,
      heightM: Math.max(0, rawH - WAYLINE_HEIGHT_OFFSET_M),
      index: wp.index,
      lonLabel: wp.lon,
      latLabel: wp.lat,
    };
  });
}

function unitPerp2(dx: number, dy: number): { x: number; y: number } {
  const L = Math.hypot(dx, dy) || 1;
  return { x: -dy / L, y: dx / L };
}

/**
 * 投影任务航线走廊（固定米宽 + 段切点 + 椭圆 + 近端连接）。
 * @param displayScale 视频像素→显示像素缩放（content.w / videoW），近端底边半宽换算用
 */
export function projectWaylineCorridor(
  intr: UavCamIntrinsics,
  pose: UavProjectPose,
  prepared: WaylinePreparedWp[],
  opts?: { droneSn?: string | null; displayScale?: number },
): WaylineCorridorDraw | null {
  if (prepared.length < 1) return null;
  const half = WAYLINE_CORRIDOR_HALF_WIDTH_M;
  const color = colorForDroneSn((opts?.droneSn ?? "").trim() || "default");
  const ds = opts?.displayScale != null && opts.displayScale > 1e-6 ? opts.displayScale : 1;

  const centers = prepared.map((wp) => projectWp(intr, pose, wp));
  const enus = prepared.map((wp) => enuFromPose(pose, wp.lon, wp.lat, wp.heightM));

  const segments: WaylineCorridorSegment[] = [];
  for (let i = 0; i < prepared.length - 1; i++) {
    const c0 = centers[i]!;
    const c1 = centers[i + 1]!;
    const e0 = enus[i]!;
    const e1 = enus[i + 1]!;
    const dx = e1.east - e0.east;
    const dy = e1.north - e0.north;
    if (Math.hypot(dx, dy) < 0.5) continue;
    const perp = unitPerp2(dx, dy);

    if (c0.valid && c1.valid) {
      const corners = [
        projectEnu(intr, pose, e0.east + perp.x * half, e0.north + perp.y * half, e0.up),
        projectEnu(intr, pose, e0.east - perp.x * half, e0.north - perp.y * half, e0.up),
        projectEnu(intr, pose, e1.east - perp.x * half, e1.north - perp.y * half, e1.up),
        projectEnu(intr, pose, e1.east + perp.x * half, e1.north + perp.y * half, e1.up),
      ];
      if (corners.some((c) => !c.valid)) continue;
      segments.push({
        quad: [
          { x: corners[0]!.u, y: corners[0]!.v },
          { x: corners[1]!.u, y: corners[1]!.v },
          { x: corners[2]!.u, y: corners[2]!.v },
          { x: corners[3]!.u, y: corners[3]!.v },
        ],
      });
      continue;
    }

    // 近端有效、远端在镜头后方：沿前方段切线延伸到画面边缘（绝不用后方外推点）
    if (c0.valid && !c1.valid) {
      const l0 = projectEnu(intr, pose, e0.east + perp.x * half, e0.north + perp.y * half, e0.up);
      const r0 = projectEnu(intr, pose, e0.east - perp.x * half, e0.north - perp.y * half, e0.up);
      if (!l0.valid || !r0.valid) continue;
      const mid = projectEnu(
        intr,
        pose,
        e0.east + dx * 0.2,
        e0.north + dy * 0.2,
        e0.up + (e1.up - e0.up) * 0.2,
      );
      const aimX = mid.valid ? mid.u : c0.u + (c0.u - intr.cx) * 0.01;
      const aimY = mid.valid ? mid.v : c0.v + (c0.v - intr.cy) * 0.01;
      const edge = clipRayToBounds(c0.u, c0.v, aimX, aimY, intr.width, intr.height);
      if (!edge) continue;
      const tdx = edge.x - c0.u;
      const tdy = edge.y - c0.v;
      const tL = Math.hypot(tdx, tdy) || 1;
      const tnx = -tdy / tL;
      const tny = tdx / tL;
      const relH = Math.max(Math.abs(pose.heightM - prepared[i]!.heightM), 12);
      const tipPx = Math.max(4, Math.min(48, (half * 0.35 * intr.fx) / relH));
      segments.push({
        quad: [
          { x: l0.u, y: l0.v },
          { x: r0.u, y: r0.v },
          { x: edge.x - tnx * tipPx, y: edge.y - tny * tipPx },
          { x: edge.x + tnx * tipPx, y: edge.y + tny * tipPx },
        ],
      });
    }
  }

  const ellipses: WaylineEllipseDraw[] = [];
  for (let i = 0; i < prepared.length; i++) {
    const wp = prepared[i]!;
    const c = centers[i]!;
    if (!c.valid) continue;
    if (c.u < 0 || c.u >= intr.width || c.v < 0 || c.v >= intr.height) continue;

    const pts: Px[] = [];
    let allOk = true;
    for (let k = 0; k < WAYLINE_ELLIPSE_SAMPLES; k++) {
      const ang = (k / WAYLINE_ELLIPSE_SAMPLES) * Math.PI * 2;
      const ll = offsetLonLatByMeters(wp.lon, wp.lat, Math.cos(ang) * half, Math.sin(ang) * half);
      const pr = lonLatToPixel(intr, pose, ll.lon, ll.lat, WAYLINE_FALLBACK_PLANE_H_M, wp.heightM);
      if (!pr.valid || pr.u == null || pr.v == null) {
        allOk = false;
        break;
      }
      pts.push({ x: pr.u, y: pr.v });
    }
    if (!allOk || pts.length < 3) continue;

    let maxR = 0;
    let minR = Infinity;
    let majorLeft = pts[0]!;
    for (const p of pts) {
      const r = Math.hypot(p.x - c.u, p.y - c.v);
      if (r > maxR) {
        maxR = r;
        majorLeft = p;
      }
      if (r < minR) minR = r;
    }
    let majorRight = pts[0]!;
    let bestDot = Infinity;
    const mlx = majorLeft.x - c.u;
    const mly = majorLeft.y - c.v;
    for (const p of pts) {
      const dot = (p.x - c.u) * mlx + (p.y - c.v) * mly;
      if (dot < bestDot) {
        bestDot = dot;
        majorRight = p;
      }
    }

    ellipses.push({
      index: wp.index,
      lon: wp.lonLabel,
      lat: wp.latLabel,
      center: { x: c.u, y: c.v },
      points: pts,
      majorHalfPx: maxR,
      minorHalfPx: Number.isFinite(minR) ? minR : maxR * 0.5,
      majorLeft,
      majorRight,
    });
  }

  let nearConnector: WaylineNearConnector | null = null;
  const firstPrepared = prepared[0]!;
  const firstEll =
    ellipses.find((e) => e.index === firstPrepared.index) ?? ellipses[0] ?? null;
  const firstCenter = centers[0];
  if (
    firstEll &&
    firstCenter?.valid &&
    firstCenter.u >= 0 &&
    firstCenter.u < intr.width &&
    firstCenter.v >= 0 &&
    firstCenter.v < intr.height
  ) {
    if (intr.height - firstCenter.v >= firstEll.minorHalfPx) {
      const halfBottom = WAYLINE_NEAR_BOTTOM_HALF_DISPLAY_PX / ds;
      const cy = intr.height - 1;
      const cx = intr.cx;
      nearConnector = {
        bottomLeft: { x: cx - halfBottom, y: cy },
        bottomRight: { x: cx + halfBottom, y: cy },
        farLeft: firstEll.majorLeft,
        farRight: firstEll.majorRight,
      };
    }
  }

  if (segments.length === 0 && ellipses.length === 0 && !nearConnector) return null;
  return { color, segments, ellipses, nearConnector };
}
