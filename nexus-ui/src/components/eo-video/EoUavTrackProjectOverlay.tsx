"use client";

import { useEffect, useRef, useState } from "react";
import type { UavMqttTelemetry } from "@/hooks/useUavMqttDockState";
import {
  EARTH_RADIUS_M,
  extractFlightPathWaypoints,
  projectLonLatPoints,
  resolveWideCamIntrinsics,
  type LonLatPoint,
} from "@/lib/eo-video/uavLonLatProject";
import {
  hexToRgba,
  prepareWaylineWaypoints,
  projectWaylineCorridor,
  type WaylineCorridorDraw,
} from "@/lib/eo-video/waylineCorridorProject";
import { resolveUavProjectPose } from "@/lib/eo-video/resolveUavProjectPose";
import { getVideoContentRect, resolveEoVideoIntrinsicSize } from "@/lib/eo-video/videoContentRect";
import type { EoVideoObjectFit } from "@/lib/eo-video/eoVideoObjectFit";
import type { Track } from "@/lib/map-entity-model";
import { useDroneStore } from "@/stores/drone-store";
import { useTrackStore } from "@/stores/track-store";
import { cn } from "@/lib/utils";

/** 只投影机位周边该距离内的对海融合航迹（米）；任务航线不受此限制 */
const UAV_PROJECT_SEA_TRACK_MAX_RANGE_M = 1000;

const SEA_STROKE = "rgba(34,211,238,0.95)";
const SEA_FILL = "rgba(34,211,238,0.9)";
const SEA_LABEL = "rgba(224,252,255,0.98)";
const ROUTE_TRAP_FALLBACK = "rgba(255,99,85,0.35)";

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
  className?: string;
}

type OverlayFrame = {
  W: number;
  H: number;
  content: { x: number; y: number; w: number; h: number };
  corridor: WaylineCorridorDraw | null;
  seaPoints: Array<{ x: number; y: number; label: string }>;
};

type SeaFusionProjectPoint = LonLatPoint & { label: string };

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

function segmentLengthM(a: LonLatPoint, b: LonLatPoint): number {
  const midLat = (a.lat + b.lat) / 2;
  const cosMid = Math.cos((midLat * Math.PI) / 180);
  const east = ((b.lon - a.lon) * Math.PI) / 180 * EARTH_RADIUS_M * cosMid;
  const north = ((b.lat - a.lat) * Math.PI) / 180 * EARTH_RADIUS_M;
  return Math.hypot(east, north);
}

function formatLonLat(lon: number, lat: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/**
 * 无人机画面：任务航线 AR 走廊（ar-wayline-projection）+ 对海融合投影。
 * 仅在 enabled 且起飞后用 rAF 计算。
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
  className,
}: EoUavTrackProjectOverlayProps) {
  const [frame, setFrame] = useState<OverlayFrame | null>(null);
  const snRef = useRef(droneSn);
  snRef.current = droneSn;
  const mqttRef = useRef(mqttTelemetry);
  mqttRef.current = mqttTelemetry;
  const fitRef = useRef(videoObjectFit);
  fitRef.current = videoObjectFit;
  const iwRef = useRef(videoIntrinsicWidth);
  const ihRef = useRef(videoIntrinsicHeight);
  iwRef.current = videoIntrinsicWidth;
  ihRef.current = videoIntrinsicHeight;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled) {
      setFrame(null);
      return;
    }
    if (!afterTakeoff) {
      setFrame(null);
      return;
    }

    let raf = 0;
    let alive = true;

    const tick = () => {
      if (!alive || !enabledRef.current) {
        setFrame(null);
        return;
      }
      const sn = (snRef.current ?? "").trim();
      const container = containerRef.current;
      const video = videoRef.current;
      if (!sn || !container) {
        setFrame(null);
        raf = requestAnimationFrame(tick);
        return;
      }

      const { w: iw, h: ih } = resolveEoVideoIntrinsicSize(video, iwRef.current ?? 0, ihRef.current ?? 0);
      const intr = resolveWideCamIntrinsics(iw, ih);
      if (!intr) {
        setFrame(null);
        raf = requestAnimationFrame(tick);
        return;
      }

      const droneTele = useDroneStore.getState().drones[sn] ?? null;
      const pose = resolveUavProjectPose(mqttRef.current, droneTele);
      if (!pose) {
        setFrame(null);
        raf = requestAnimationFrame(tick);
        return;
      }

      const cr = container.getBoundingClientRect();
      const content = getVideoContentRect(cr.width, cr.height, intr.width, intr.height, fitRef.current);
      const displayScale = content.w / Math.max(intr.width, 1);

      const wps = extractFlightPathWaypoints(droneTele?.flightPath ?? null);
      const prepared = prepareWaylineWaypoints(wps);
      const corridor = projectWaylineCorridor(intr, pose, prepared, {
        droneSn: sn,
        displayScale,
      });

      const uavOrigin: LonLatPoint = { lon: pose.longitude, lat: pose.latitude };
      const seaPts = collectSeaFusionPoints().filter(
        (p) => segmentLengthM(uavOrigin, p) <= UAV_PROJECT_SEA_TRACK_MAX_RANGE_M,
      );
      const seaProjected = projectLonLatPoints(intr, pose, seaPts);
      const seaPoints: Array<{ x: number; y: number; label: string }> = [];
      for (let i = 0; i < seaProjected.length; i++) {
        const p = seaProjected[i]!;
        if (p.inFrame && p.u != null && p.v != null) {
          seaPoints.push({ x: p.u, y: p.v, label: seaPts[i]?.label ?? "?" });
        }
      }

      setFrame({
        W: intr.width,
        H: intr.height,
        content,
        corridor,
        seaPoints,
      });
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [afterTakeoff, containerRef, enabled, videoRef]);

  if (!enabled || !afterTakeoff || !frame) return null;
  if (!frame.corridor && frame.seaPoints.length === 0) return null;

  const sx = frame.content.w / frame.W;
  const sy = frame.content.h / frame.H;
  const ox = frame.content.x;
  const oy = frame.content.y;
  const mapX = (u: number) => ox + u * sx;
  const mapY = (v: number) => oy + v * sy;
  const corridor = frame.corridor;
  const fill = corridor ? hexToRgba(corridor.color, 0.35) : ROUTE_TRAP_FALLBACK;
  const stroke = corridor?.color ?? "#FF6355";

  return (
    <svg
      className={cn("pointer-events-none absolute inset-0 z-[18] h-full w-full overflow-hidden", className)}
      aria-hidden
    >
      {corridor?.nearConnector ? (
        <polygon
          points={[
            corridor.nearConnector.bottomLeft,
            corridor.nearConnector.bottomRight,
            corridor.nearConnector.farRight,
            corridor.nearConnector.farLeft,
          ]
            .map((p) => `${mapX(p.x)},${mapY(p.y)}`)
            .join(" ")}
          fill={fill}
          stroke="none"
        />
      ) : null}
      {corridor?.segments.map((seg, i) => (
        <polygon
          key={`seg-${i}`}
          points={seg.quad.map((p) => `${mapX(p.x)},${mapY(p.y)}`).join(" ")}
          fill={fill}
          stroke="none"
        />
      ))}
      {corridor?.ellipses.map((ell) => {
        const fontPx = Math.max(6, ell.majorHalfPx * sx * 0.14);
        const cx = mapX(ell.center.x);
        const cy = mapY(ell.center.y);
        return (
          <g key={`ell-${ell.index}`}>
            <polygon
              points={ell.points.map((p) => `${mapX(p.x)},${mapY(p.y)}`).join(" ")}
              fill={fill}
              stroke={stroke}
              strokeWidth={2}
            />
            <rect
              x={cx + 8}
              y={cy - fontPx * 1.35}
              width={Math.max(72, fontPx * 9.5)}
              height={fontPx * 2.5}
              rx={3}
              fill={hexToRgba(corridor.color, 0.85)}
            />
            <text
              x={cx + 12}
              y={cy - fontPx * 0.35}
              fill="#fff"
              fontSize={fontPx}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
              fontWeight={700}
            >
              {`#${ell.index}`}
            </text>
            <text
              x={cx + 12}
              y={cy + fontPx * 0.9}
              fill="#fff"
              fontSize={Math.max(6, fontPx * 0.85)}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
            >
              {formatLonLat(ell.lon, ell.lat)}
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
