import type { Track } from "@/lib/map-entity-model";
import { getTrackRenderingConfig } from "@/lib/map-app-config";
import { destinationLngLat } from "@/lib/geo-destination";
import { haversineMeters } from "@/lib/entity-publish-time";
import {
  MAX_TRAIL_LENGTH_SECONDS,
  TRACK_TRAIL_SAMPLE_INTERVAL_SEC,
} from "@/stores/track-display-store";

/** 相邻尾迹点步长硬上限（米）：融合重算常见跳变，超过则断开尾迹 */
export const TRAIL_TELEPORT_MAX_METERS = 200;

/** 缺速时假定地速（m/s），对海/融合慢目标为主 */
const TRAIL_STEP_FALLBACK_SPEED_MS = 8;

/** 相对 speed×间隔 的放宽系数（GPS 抖动 / 报文时间不齐） */
const TRAIL_STEP_SLACK_FACTOR = 1.4;

/** 低速/静止时最小允许步长（米），避免微抖误断 */
const TRAIL_STEP_MIN_METERS = 35;

/** 固定余量（米） */
const TRAIL_STEP_BASE_SLACK_METERS = 25;

/** 单条航迹尾迹在地图上最多绘制的点数（无时间戳时的回退：假定高频 ~5Hz） */
export function maxDisplayedTrailPointCount(trailLengthSeconds: number): number {
  const sec = Math.max(0, Math.min(MAX_TRAIL_LENGTH_SECONDS, trailLengthSeconds));
  /** 无 `historyTrailAtMs` 时不再用 2s/点（会让 1s≈1 点但仍可能拉一根很旧的长线段） */
  const assumedSampleSec = Math.min(TRACK_TRAIL_SAMPLE_INTERVAL_SEC, 0.2);
  return Math.max(1, Math.ceil(sec / assumedSampleSec));
}

/** 相邻尾迹点允许的最大地面步长（米）：约 speed×采样间隔 + 余量，硬顶 200m */
export function maxTrailStepMeters(speedMs: number | undefined): number {
  const spd =
    typeof speedMs === "number" && Number.isFinite(speedMs) && speedMs > 0
      ? speedMs
      : TRAIL_STEP_FALLBACK_SPEED_MS;
  const expected =
    spd * TRACK_TRAIL_SAMPLE_INTERVAL_SEC * TRAIL_STEP_SLACK_FACTOR + TRAIL_STEP_BASE_SLACK_METERS;
  return Math.min(
    TRAIL_TELEPORT_MAX_METERS,
    Math.max(TRAIL_STEP_MIN_METERS, expected),
  );
}

export function isTrailSegmentTeleport(
  from: [number, number],
  to: [number, number],
  speedMs?: number,
): boolean {
  const stepM = haversineMeters(from[1], from[0], to[1], to[0]);
  if (!(stepM > 0)) return false;
  return stepM > maxTrailStepMeters(speedMs);
}

/**
 * 过滤 historyTrail 内部的融合瞬移：只保留**最后一次**跳变之后的连续后缀。
 * 同一 showID 位置跳变时，旧段不参与绘制，避免跨洋/跨区长线。
 */
export function filterHistoryTrailTeleports(
  trail: [number, number][],
  speedMs?: number,
): [number, number][] {
  if (trail.length <= 1) return trail;
  let segmentStart = 0;
  for (let i = 1; i < trail.length; i++) {
    if (isTrailSegmentTeleport(trail[i - 1], trail[i], speedMs)) {
      segmentStart = i;
    }
  }
  return trail.slice(segmentStart);
}

/**
 * 面板「尾迹长度」语义：请求的**最长显示时长（秒）**。
 * - 内存里只有约 40s 历史时，拉到 40 / 100 / 1000 都应画满这 40s（`min(请求, 已有)`）。
 * - 有 `historyTrailAtMs` 时按墙上时间裁；没有时用点数估算做上限，点数超过请求则截末段，否则画**全部已有点**。
 */
export function trimHistoryTrailForDisplay(
  trail: [number, number][] | undefined,
  trailLengthSeconds: number,
  speedMs?: number,
  currentLngLat?: [number, number],
  trailAtMs?: number[],
): [number, number][] | undefined {
  if (!trail?.length) return trail;

  let pts: [number, number][];
  const sec = Math.max(0, Math.min(MAX_TRAIL_LENGTH_SECONDS, trailLengthSeconds));
  if (trailAtMs && trailAtMs.length === trail.length && sec > 0) {
    const cutoff = Date.now() - sec * 1000;
    let start = 0;
    while (start < trail.length && (trailAtMs[start] ?? 0) < cutoff) start += 1;
    if (start >= trail.length) return undefined;
    /** 时间窗内有多少画多少，不再二次按点数砍断（否则大秒数与「内存最长」不一致） */
    pts = start === 0 ? trail : trail.slice(start);
  } else {
    const maxPts = maxDisplayedTrailPointCount(trailLengthSeconds);
    /** 请求点数 ≥ 内存点数 → 画满内存；否则只留末段 */
    pts = trail.length <= maxPts ? trail : trail.slice(-maxPts);
  }

  pts = filterHistoryTrailTeleports(pts, speedMs);
  if (!pts.length) return undefined;
  if (currentLngLat && isTrailSegmentTeleport(pts[pts.length - 1], currentLngLat, speedMs)) {
    return undefined;
  }
  return pts;
}

/** store 摄入：相邻更新步长过大时整段尾迹作废（与展示层瞬移判定一致） */
export function shouldResetHistoryTrailOnStep(
  fromLng: number,
  fromLat: number,
  toLng: number,
  toLat: number,
  speedMs?: number,
): boolean {
  return isTrailSegmentTeleport([fromLng, fromLat], [toLng, toLat], speedMs);
}

/** 缺速时用假定地速（m/s）画示意矢量，避免滑块无效 */
const VECTOR_FALLBACK_SPEED_MS = 20;

type VectorSpeedResolved = {
  speedMs: number;
  isFallback: boolean;
};

/**
 * 航迹 store 中 `speed` 为 **m/s**（与 DDS 一致）；`destinationLngLat` 距离为 **米**。
 * 仅在速度缺失/非法时才使用兜底值；真实 0 速保持 0（不画矢量）。
 */
function speedMetersPerSecondForVector(speed: number): VectorSpeedResolved {
  if (!(typeof speed === "number" && Number.isFinite(speed))) {
    return { speedMs: VECTOR_FALLBACK_SPEED_MS, isFallback: true };
  }
  if (speed <= 0) return { speedMs: 0, isFallback: false };
  return { speedMs: speed, isFallback: false };
}

function coerceDeg(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function normalizeDeg360(d: number): number {
  let x = d % 360;
  if (x < 0) x += 360;
  return x;
}

/** 大圆初始方位角（正北顺时针，度），与 `tdoa-activation.bearingTo` 一致 */
function initialBearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLng = (lng2 - lng1) * rad;
  const y = Math.sin(dLng) * Math.cos(lat2 * rad);
  const x =
    Math.cos(lat1 * rad) * Math.sin(lat2 * rad) -
    Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLng);
  return normalizeDeg360((Math.atan2(y, x) / rad + 360) % 360);
}

/** 尾迹末点 → 当前位置，用于报文无 course 时估算矢量方向 */
function bearingFromHistoryTrailDeg(t: Track): number | undefined {
  const tr = t.historyTrail;
  if (!tr?.length) return undefined;
  const [lng0, lat0] = tr[tr.length - 1];
  const d = Math.hypot(t.lng - lng0, t.lat - lat0);
  if (!(d > 1e-7)) return undefined;
  return initialBearingDeg(lat0, lng0, t.lat, t.lng);
}

/** 地面距离过短时矢量几乎不可见，保证至少一段可见长度（米） */
const VECTOR_MIN_GROUND_METERS = 120;

/**
 * 速度矢量终点 [lng, lat]。
 * - **方位**：course → azimuth；对空可反推；再无则 **historyTrail 末段 → 当前点**。
 * - **距离**：m/s × 秒；仅在速度缺失时才施加最小地面距离，避免低速目标被拉成长线。
 * - **秒数**：持久化曾为 0 导致不画线；此处小于 1 时按 60s 算（与 store 迁移一致）。
 */
export function velocityVectorEndLngLat(t: Track, vectorLengthSeconds: number): [number, number] | null {
  const sec = vectorLengthSeconds < 1 ? 60 : vectorLengthSeconds;
  if (!(sec > 0)) return null;

  const { speedMs: spdMs, isFallback } = speedMetersPerSecondForVector(
    typeof t.speed === "number" && Number.isFinite(t.speed) ? t.speed : NaN,
  );
  if (!(spdMs > 0)) return null;
  let dist = spdMs * sec;
  if (isFallback && dist > 0 && dist < VECTOR_MIN_GROUND_METERS) dist = VECTOR_MIN_GROUND_METERS;

  const cfg = getTrackRenderingConfig();
  let brg: number | undefined =
    coerceDeg(t.course) ?? coerceDeg(t.azimuth);

  if (brg === undefined && t.type === "air") {
    const h = coerceDeg(t.heading);
    if (h !== undefined) brg = normalizeDeg360(h - cfg.airIconHeadingOffsetDeg);
  }

  if (brg === undefined) brg = bearingFromHistoryTrailDeg(t);

  if (brg === undefined || !Number.isFinite(brg)) return null;

  return destinationLngLat(t.lat, t.lng, brg, dist);
}
