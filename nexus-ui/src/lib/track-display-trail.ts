import type { Track } from "@/lib/map-entity-model";
import { getTrackRenderingConfig } from "@/lib/map-app-config";
import { destinationLngLat } from "@/lib/geo-destination";
import { TRACK_TRAIL_SAMPLE_INTERVAL_SEC } from "@/stores/track-display-store";

/** 单条航迹尾迹在地图上最多绘制的点数（受配置上限与面板「尾迹长度」共同约束） */
export function maxDisplayedTrailPointCount(trailLengthSeconds: number): number {
  const cfg = getTrackRenderingConfig().trackDisplay.maxHistoryPointsPerTrack;
  const fromUi = Math.max(1, Math.ceil(trailLengthSeconds / TRACK_TRAIL_SAMPLE_INTERVAL_SEC));
  return Math.min(cfg, fromUi);
}

export function trimHistoryTrailForDisplay(
  trail: [number, number][] | undefined,
  trailLengthSeconds: number,
): [number, number][] | undefined {
  if (!trail?.length) return trail;
  const maxPts = maxDisplayedTrailPointCount(trailLengthSeconds);
  if (trail.length <= maxPts) return trail;
  return trail.slice(-maxPts);
}

/** 缺速时用假定地速（m/s）画示意矢量，避免滑块无效 */
const VECTOR_FALLBACK_SPEED_MS = 20;

/** 1 kn（节）→ m/s，与 `eo-video/mergeSingleTrackTelemetry` 航迹速度语义一致 */
const KNOTS_TO_METERS_PER_SEC = 0.514444;

type VectorSpeedResolved = {
  speedMs: number;
  isFallback: boolean;
};

/**
 * 航迹 store 中 `speed` 多为 **节（kn）**；`destinationLngLat` 距离为 **米**。
 * 典型海面目标小于 200 kn 视为节并换算；否则视为已是 m/s（兼容少数来源）。
 * 仅在速度缺失/非法时才使用兜底值；真实 0 速保持 0（不画矢量）。
 */
function speedMetersPerSecondForVector(speed: number): VectorSpeedResolved {
  if (!(typeof speed === "number" && Number.isFinite(speed))) {
    return { speedMs: VECTOR_FALLBACK_SPEED_MS, isFallback: true };
  }
  if (speed <= 0) return { speedMs: 0, isFallback: false };
  if (speed <= 200) return { speedMs: speed * KNOTS_TO_METERS_PER_SEC, isFallback: false };
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
 * - **距离**：节→m/s × 秒；仅在速度缺失时才施加最小地面距离，避免低速目标被拉成长线。
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
