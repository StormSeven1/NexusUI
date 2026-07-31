"use client";

import { useEffect, useRef, useState } from "react";
import type { UavMqttTelemetry } from "@/hooks/useUavMqttDockState";
import {
  buildContinuousRouteRibbonVertices,
  buildRouteTrapezoidCorners,
  DEFAULT_UAV_PROJECT_PLANE_H_M,
  EARTH_RADIUS_M,
  extractFlightPathWaypoints,
  lonLatToPixel,
  offsetLonLatByMeters,
  projectLonLatPoints,
  resolveWideCamIntrinsics,
  type LonLatPoint,
  type RouteRibbonVertex,
  type UavCamIntrinsics,
  type UavProjectPose,
} from "@/lib/eo-video/uavLonLatProject";
import { resolveUavProjectPose } from "@/lib/eo-video/resolveUavProjectPose";
import { getVideoContentRect, resolveEoVideoIntrinsicSize } from "@/lib/eo-video/videoContentRect";
import type { EoVideoObjectFit } from "@/lib/eo-video/eoVideoObjectFit";
import type { Track } from "@/lib/map-entity-model";
import { useDroneStore } from "@/stores/drone-store";
import { useTrackStore } from "@/stores/track-store";
import { cn } from "@/lib/utils";

/** 投影刷新间隔（与无人机位置相关；先 1s 试） */
export const UAV_TRACK_PROJECT_INTERVAL_MS = 1000;

/**
 * 统一走廊半宽（米）：近端宽 → 远端窄，按折线弧长插值。
 * 海面侧向偏移再投影；折点左右边界共用（角平分），消除段间接缝错位。
 */
const ROUTE_NEAR_HALF_M = 60;
const ROUTE_FAR_HALF_M = 8;
/** 只投影机位周边该距离内的对海融合航迹（米）；任务航线不受此限制 */
const UAV_PROJECT_SEA_TRACK_MAX_RANGE_M = 1000;

const ROUTE_TRAP_FILL = "rgba(239,68,68,0.28)";
const ROUTE_FILL = "rgba(239,68,68,0.95)";
const ROUTE_STROKE = "rgba(248,113,113,0.95)";
const ROUTE_LABEL = "rgba(255,255,255,0.98)";
const SEA_STROKE = "rgba(34,211,238,0.95)";
const SEA_FILL = "rgba(34,211,238,0.9)";
const SEA_LABEL = "rgba(224,252,255,0.98)";

export interface EoUavTrackProjectOverlayProps {
  enabled: boolean;
  /** 起飞后才投影：通常 `mqttDroneInDock === false` */
  afterTakeoff: boolean;
  droneSn: string | null;
  mqttTelemetry: UavMqttTelemetry | null;
  containerRef: React.RefObject<HTMLElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoObjectFit?: EoVideoObjectFit;
  videoIntrinsicWidth?: number;
  videoIntrinsicHeight?: number;
  planeHM?: number;
  className?: string;
}

type RouteRibbon = {
  points: Array<{ x: number; y: number }>;
};

type OverlayFrame = {
  W: number;
  H: number;
  content: { x: number; y: number; w: number; h: number };
  routeRibbons: RouteRibbon[];
  routeWaypoints: Array<{ x: number; y: number; index: number }>;
  seaPoints: Array<{ x: number; y: number; label: string }>;
};

type SeaFusionProjectPoint = LonLatPoint & { label: string };

/** 对海融合 target_id（= uniqueID）末 4 位数字 */
function extractFusionTailNumber(track: Track): string {
  const raw = (track.uniqueID ?? "").trim();
  if (!raw) return "?";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  if (digits.length > 0) return digits;
  if (raw.length >= 4) return raw.slice(-4);
  return raw;
}

function collectSeaFusionPoints(): SeaFusionProjectPoint[] {
  const tracks = useTrackStore.getState().tracks;
  const out: SeaFusionProjectPoint[] = [];
  for (const t of tracks) {
    if (t.trackLayerKey !== "fuse_sea") continue;
    if (!Number.isFinite(t.lng) || !Number.isFinite(t.lat)) continue;
    out.push({ lon: t.lng, lat: t.lat, label: extractFusionTailNumber(t) });
  }
  return out;
}

function halfWidthAlongRoute(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return ROUTE_NEAR_HALF_M * (1 - u) + ROUTE_FAR_HALF_M * u;
}

function segmentLengthM(a: LonLatPoint, b: LonLatPoint): number {
  const midLat = (a.lat + b.lat) / 2;
  const cosMid = Math.cos((midLat * Math.PI) / 180);
  const east = ((b.lon - a.lon) * Math.PI) / 180 * EARTH_RADIUS_M * cosMid;
  const north = ((b.lat - a.lat) * Math.PI) / 180 * EARTH_RADIUS_M;
  return Math.hypot(east, north);
}

function lerpLonLat(a: LonLatPoint, b: LonLatPoint, t: number): LonLatPoint {
  return { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t };
}

function projectTrapezoidPixels(
  start: LonLatPoint,
  end: LonLatPoint,
  backHalfM: number,
  frontHalfM: number,
  intr: UavCamIntrinsics,
  pose: UavProjectPose,
  planeH: number,
): Array<{ x: number; y: number }> | null {
  const trap = buildRouteTrapezoidCorners(start, end, backHalfM, frontHalfM);
  if (!trap) return null;
  const projected = projectLonLatPoints(intr, pose, trap.corners, planeH);
  const pixels: Array<{ x: number; y: number }> = [];
  for (const p of projected) {
    if (p.valid && p.u != null && p.v != null) pixels.push({ x: p.u, y: p.v });
  }
  return pixels.length >= 3 ? pixels : null;
}

function projectLonLatPx(
  p: LonLatPoint,
  intr: UavCamIntrinsics,
  pose: UavProjectPose,
  planeH: number,
): { x: number; y: number } | null {
  const { u, v, valid } = lonLatToPixel(intr, pose, p.lon, p.lat, planeH);
  if (!valid || u == null || v == null) return null;
  return { x: u, y: v };
}

/** 按参考左边界方向，在海面上重算给定半宽的左右点 */
function seaSidesAtHalf(center: LonLatPoint, leftRef: LonLatPoint, halfM: number): {
  left: LonLatPoint;
  right: LonLatPoint;
} {
  const midLat = (center.lat + leftRef.lat) / 2;
  const cosMid = Math.cos((midLat * Math.PI) / 180);
  const east = ((leftRef.lon - center.lon) * Math.PI) / 180 * EARTH_RADIUS_M * cosMid;
  const north = ((leftRef.lat - center.lat) * Math.PI) / 180 * EARTH_RADIUS_M;
  const len = Math.hypot(east, north) || 1;
  const ux = east / len;
  const uy = north / len;
  return {
    left: offsetLonLatByMeters(center.lon, center.lat, ux * halfM, uy * halfM),
    right: offsetLonLatByMeters(center.lon, center.lat, -ux * halfM, -uy * halfM),
  };
}

/**
 * 折点左右：海面偏移后投影；投不出则在海面上收窄半宽重试（仍不用像素法向）。
 * 相邻段共用同一对像素点 → 顶边/底边对齐。
 */
function projectSharedVertexSides(
  v: RouteRibbonVertex,
  intr: UavCamIntrinsics,
  pose: UavProjectPose,
  planeH: number,
): { l: { x: number; y: number }; r: { x: number; y: number } } | null {
  for (const scale of [1, 0.85, 0.7, 0.55, 0.4, 0.25]) {
    const half = Math.max(2, v.halfWidthM * scale);
    const { left, right } = seaSidesAtHalf(v.center, v.left, half);
    const l = projectLonLatPx(left, intr, pose, planeH);
    const r = projectLonLatPx(right, intr, pose, planeH);
    if (l && r) return { l, r };
  }
  return null;
}

/**
 * 沿 A→B 采样，找最远仍可投影的海面点（用于远端出画时仍画出海面走廊）。
 */
function farthestProjectableAlong(
  from: LonLatPoint,
  to: LonLatPoint,
  pose: UavProjectPose,
  intr: UavCamIntrinsics,
  planeH: number,
): LonLatPoint | null {
  let last: LonLatPoint | null = null;
  for (let k = 1; k <= 40; k++) {
    const p = lerpLonLat(from, to, k / 40);
    const { valid } = lonLatToPixel(intr, pose, p.lon, p.lat, planeH);
    if (!valid) break;
    last = p;
  }
  return last;
}

function centerProjectable(
  p: LonLatPoint,
  pose: UavProjectPose,
  intr: UavCamIntrinsics,
  planeH: number,
): boolean {
  return lonLatToPixel(intr, pose, p.lon, p.lat, planeH).valid;
}

/**
 * 无人机画面：航线海面梯形走廊 + 对海融合投影。
 */
export function EoUavTrackProjectOverlay({
  enabled,
  afterTakeoff,
  droneSn,
  mqttTelemetry,
  containerRef,
  videoRef,
  videoObjectFit = "fill",
  videoIntrinsicWidth,
  videoIntrinsicHeight,
  planeHM = DEFAULT_UAV_PROJECT_PLANE_H_M,
  className,
}: EoUavTrackProjectOverlayProps) {
  const [frame, setFrame] = useState<OverlayFrame | null>(null);
  const snRef = useRef(droneSn);
  snRef.current = droneSn;
  const mqttRef = useRef(mqttTelemetry);
  mqttRef.current = mqttTelemetry;
  const planeRef = useRef(planeHM);
  planeRef.current = planeHM;
  const fitRef = useRef(videoObjectFit);
  fitRef.current = videoObjectFit;
  const iwRef = useRef(videoIntrinsicWidth);
  const ihRef = useRef(videoIntrinsicHeight);
  iwRef.current = videoIntrinsicWidth;
  ihRef.current = videoIntrinsicHeight;

  useEffect(() => {
    // 右侧关闭投影：不建定时器、不算投影（父级也会卸载本组件）
    if (!enabled) {
      setFrame(null);
      return;
    }
    if (!afterTakeoff) {
      setFrame(null);
      return;
    }

    const tick = () => {
      if (!enabled) {
        setFrame(null);
        return;
      }
      const sn = (snRef.current ?? "").trim();
      const container = containerRef.current;
      const video = videoRef.current;
      if (!sn || !container) {
        setFrame(null);
        return;
      }

      const { w: iw, h: ih } = resolveEoVideoIntrinsicSize(video, iwRef.current ?? 0, ihRef.current ?? 0);
      const intr = resolveWideCamIntrinsics(iw, ih);
      if (!intr) {
        setFrame(null);
        return;
      }

      const droneTele = useDroneStore.getState().drones[sn] ?? null;
      const pose = resolveUavProjectPose(mqttRef.current, droneTele);
      if (!pose) {
        setFrame(null);
        return;
      }

      const wps = extractFlightPathWaypoints(droneTele?.flightPath ?? null);
      const uavOrigin: LonLatPoint = { lon: pose.longitude, lat: pose.latitude };
      const chain: LonLatPoint[] = [uavOrigin];
      for (const wp of wps) {
        const last = chain[chain.length - 1]!;
        const dLon = wp.lon - last.lon;
        const dLat = wp.lat - last.lat;
        if (dLon * dLon + dLat * dLat < 1e-12) continue;
        chain.push(wp);
      }

      const planeH = planeRef.current;
      const routeRibbons: RouteRibbon[] = [];
      const ribbonVerts = buildContinuousRouteRibbonVertices(chain, halfWidthAlongRoute);
      const sharedSides = ribbonVerts.map((v) => projectSharedVertexSides(v, intr, pose, planeH));

      const segCount = chain.length - 1;
      if (segCount > 0) {
        const segLens: number[] = [];
        let totalLen = 0;
        for (let i = 0; i < segCount; i++) {
          const len = Math.max(segmentLengthM(chain[i]!, chain[i + 1]!), 0.01);
          segLens.push(len);
          totalLen += len;
        }
        let acc = 0;
        for (let i = 0; i < segCount; i++) {
          const a = chain[i]!;
          const b = chain[i + 1]!;
          const t0 = acc / totalLen;
          acc += segLens[i]!;
          const t1 = acc / totalLen;
          const ha = halfWidthAlongRoute(t0);
          const hb = halfWidthAlongRoute(t1);

          const aOk = centerProjectable(a, pose, intr, planeH);
          const bOk = centerProjectable(b, pose, intr, planeH);
          const s0 = sharedSides[i];
          const s1 = sharedSides[i + 1];

          // 优先：两端共用海面左右点（交界对齐）
          if (aOk && bOk && s0 && s1) {
            routeRibbons.push({
              points: [
                { x: s0.l.x, y: s0.l.y },
                { x: s0.r.x, y: s0.r.y },
                { x: s1.r.x, y: s1.r.y },
                { x: s1.l.x, y: s1.l.y },
              ],
            });
            continue;
          }

          if (aOk && bOk) {
            // 侧点投不出：退回按段海面梯形（外形仍对，交界可能略错位）
            const pixels = projectTrapezoidPixels(a, b, ha, hb, intr, pose, planeH);
            if (pixels) routeRibbons.push({ points: pixels });
            continue;
          }

          if (aOk && !bOk) {
            const far = farthestProjectableAlong(a, b, pose, intr, planeH);
            if (far) {
              const pixels = projectTrapezoidPixels(
                a,
                far,
                ha,
                Math.max(ROUTE_FAR_HALF_M, hb * 0.75),
                intr,
                pose,
                planeH,
              );
              if (pixels) routeRibbons.push({ points: pixels });
            }
            continue;
          }

          if (!aOk && bOk) {
            const far = farthestProjectableAlong(b, a, pose, intr, planeH);
            if (far) {
              const pixels = projectTrapezoidPixels(
                far,
                b,
                Math.max(ROUTE_FAR_HALF_M, ha * 0.75),
                hb,
                intr,
                pose,
                planeH,
              );
              if (pixels) routeRibbons.push({ points: pixels });
            }
          }
        }
      }

      /** 序号=航路固定编号，不因视野内谁先出现而重排 */
      const wpProjected = projectLonLatPoints(intr, pose, wps, planeH);
      const routeWaypoints: Array<{ x: number; y: number; index: number }> = [];
      for (let i = 0; i < wpProjected.length; i++) {
        const p = wpProjected[i]!;
        if (p.inFrame && p.u != null && p.v != null) {
          routeWaypoints.push({ x: p.u, y: p.v, index: wps[i]!.index });
        }
      }

      const seaPts = collectSeaFusionPoints().filter(
        (p) => segmentLengthM(uavOrigin, p) <= UAV_PROJECT_SEA_TRACK_MAX_RANGE_M,
      );
      const seaProjected = projectLonLatPoints(intr, pose, seaPts, planeH);
      const seaPoints: Array<{ x: number; y: number; label: string }> = [];
      for (let i = 0; i < seaProjected.length; i++) {
        const p = seaProjected[i]!;
        if (p.inFrame && p.u != null && p.v != null) {
          seaPoints.push({ x: p.u, y: p.v, label: seaPts[i]?.label ?? "?" });
        }
      }

      const cr = container.getBoundingClientRect();
      const content = getVideoContentRect(cr.width, cr.height, intr.width, intr.height, fitRef.current);

      setFrame({
        W: intr.width,
        H: intr.height,
        content,
        routeRibbons,
        routeWaypoints,
        seaPoints,
      });
    };

    tick();
    const id = window.setInterval(tick, UAV_TRACK_PROJECT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [afterTakeoff, containerRef, enabled, videoRef]);

  if (!enabled || !afterTakeoff || !frame) return null;
  if (frame.routeRibbons.length === 0 && frame.routeWaypoints.length === 0 && frame.seaPoints.length === 0) {
    return null;
  }

  const sx = frame.content.w / frame.W;
  const sy = frame.content.h / frame.H;
  const ox = frame.content.x;
  const oy = frame.content.y;
  const mapX = (u: number) => ox + u * sx;
  const mapY = (v: number) => oy + v * sy;

  return (
    <svg
      className={cn("pointer-events-none absolute inset-0 z-[18] h-full w-full overflow-hidden", className)}
      aria-hidden
    >
      {frame.routeRibbons.map((rib, i) => {
        const pts = rib.points.map((p) => `${mapX(p.x)},${mapY(p.y)}`).join(" ");
        return <polygon key={`rib-${i}`} points={pts} fill={ROUTE_TRAP_FILL} stroke="none" />;
      })}
      {frame.routeWaypoints.map((p) => {
        const cx = mapX(p.x);
        const cy = mapY(p.y);
        return (
          <g key={`rpt-${p.index}-${cx.toFixed(1)}`}>
            <circle cx={cx} cy={cy} r={8} fill={ROUTE_FILL} />
            <circle cx={cx} cy={cy} r={10} fill="none" stroke={ROUTE_STROKE} strokeWidth={1.5} />
            <text
              x={cx}
              y={cy}
              fill={ROUTE_LABEL}
              stroke="rgba(0,0,0,0.7)"
              strokeWidth={2}
              paintOrder="stroke"
              fontSize={11}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
              fontWeight={700}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {p.index}
            </text>
          </g>
        );
      })}
      {frame.seaPoints.map((p, i) => {
        const cx = mapX(p.x);
        const cy = mapY(p.y);
        return (
          <g key={`sea-${i}-${p.label}`}>
            <circle cx={cx} cy={cy} r={4.5} fill={SEA_FILL} />
            <circle cx={cx} cy={cy} r={7.5} fill="none" stroke={SEA_STROKE} strokeWidth={1.5} />
            <text
              x={cx + 10}
              y={cy + 4}
              fill={SEA_LABEL}
              stroke="rgba(0,0,0,0.75)"
              strokeWidth={2.5}
              paintOrder="stroke"
              fontSize={11}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
              fontWeight={600}
            >
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
