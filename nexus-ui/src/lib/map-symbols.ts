import { FORCE_COLORS, type ForceDisposition } from "./colors.ts";
import type { Track, Asset } from "./mock-data.ts";

export type TrackType = Track["type"];
export type AssetType = Asset["type"];
export type AssetStatus = Asset["status"];

const ICON_PATHS: Record<TrackType, string> = {
  air: "M32 8 L37 21 L47 24 L37 27 L33 39 L38 51 L34 51 L32 43 L30 51 L26 51 L31 39 L27 27 L17 24 L27 21 Z",
  sea: "M13 35 L18 27 L46 27 L52 35 L48 41 L17 41 Z M22 24 L30 18 L37 18 L42 24 Z M29 14 L34 14 L34 18 L29 18 Z",
  underwater: "M18 20 L32 42 L46 20 L39 22 L32 34 L25 22 Z M29 13 L35 13 L35 20 L29 20 Z",
};

const SILHOUETTE_CLASS: Record<TrackType, string> = {
  air: "M32 5 L39 19 L52 23 L39 28 L35 40 L41 54 L35 54 L32 46 L29 54 L23 54 L29 40 L25 28 L12 23 L25 19 Z",
  sea: "M10 36 L17 25 L47 25 L55 36 L49 44 L15 44 Z M20 22 L30 15 L38 15 L45 22 Z",
  underwater: "M14 18 L32 46 L50 18 L41 20 L32 35 L23 20 Z",
};

/**
 * 获取地图引擎内部使用的图标 ID。
 *
 * Get a stable marker image ID for MapLibre/Cesium caches.
 */
export function getMarkerSymbolId(type: TrackType, disposition: ForceDisposition): string {
  return `track-${type}-${disposition}`;
}

/**
 * 依据态势（敌/友/中立）取主题色。
 *
 * Pick the canonical color for a force disposition.
 */
function getMarkerColor(disposition: ForceDisposition): string {
  return FORCE_COLORS[disposition];
}

/**
 * 生成用于 2D/3D 的目标图标 SVG（64x64）。
 *
 * - 目标：在深色底图上高对比、可读、带轻微光晕与描边
 * - 约定：图标默认朝“正北/向上”，旋转由地图层/引擎根据 heading 来处理
 *
 * Build a 64x64 SVG marker icon (north-up). Rotation should be applied
 * by the map engine using the track heading.
 */
export function buildMarkerSymbolSvg(type: TrackType, disposition: ForceDisposition): string {
  const color = getMarkerColor(disposition);
  const silhouette = SILHOUETTE_CLASS[type];
  const icon = ICON_PATHS[type];

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">`,
    `<defs>`,
    `<filter id="glow">`,
    `<feDropShadow dx="0" dy="0" stdDeviation="1.8" flood-color="${color}" flood-opacity="0.55"/>`,
    `<feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#000000" flood-opacity="0.45"/>`,
    `</filter>`,
    `</defs>`,
    // 底板：更像“军标底形”，同时保证对比度
    `<path d="${silhouette}" fill="rgba(9,9,11,0.92)" stroke="${color}" stroke-width="3.2" stroke-linejoin="round" filter="url(#glow)"/>`,
    // 亮部图形：细描边避免和底板融在一起
    `<path d="${icon}" fill="${color}" stroke="rgba(9,9,11,0.95)" stroke-width="1.8" stroke-linejoin="round"/>`,
    // 顶部小“航向刻度”让旋转更明显（视觉上更像目标，而不是点）
    `<path d="M32 4 L32 10" stroke="${color}" stroke-width="2.4" stroke-linecap="round" opacity="0.9" />`,
    `</svg>`,
  ].join("");
}

/**
 * 将 SVG 包装成 data URL，便于 MapLibre `addImage`/Cesium billboard 直接使用。
 *
 * Wrap the generated SVG into a data URL.
 */
export function buildMarkerSymbolDataUrl(type: TrackType, disposition: ForceDisposition): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildMarkerSymbolSvg(type, disposition))}`;
}

/**
 * 枚举项目内所有“目标类型 × 态势”的图标 key，用于预注册到 MapLibre sprite/image cache。
 *
 * Enumerate all marker keys so we can pre-register images.
 */
export function getAllMarkerSymbolKeys(): Array<{ id: string; type: TrackType; disposition: ForceDisposition }> {
  const types: TrackType[] = ["air", "sea", "underwater"];
  const dispositions: ForceDisposition[] = ["hostile", "friendly", "neutral"];

  return types.flatMap((type) =>
    dispositions.map((disposition) => ({
      id: getMarkerSymbolId(type, disposition),
      type,
      disposition,
    }))
  );
}

/* ── 锁定框（Lock-on reticle）128x128 SVG ── */

export const LOCK_ON_IMAGE_ID = "lock-on-reticle";

export function buildLockOnSvg(): string {
  const c = "#22d3ee";
  const s = 128;
  const m = 10;
  const bl = 22;
  const bw = 2.5;
  const r = 42;
  const half = s / 2;
  const gap = 14;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">`,
    `<path d="M${m} ${m + bl} L${m} ${m} L${m + bl} ${m}" fill="none" stroke="${c}" stroke-width="${bw}" stroke-linecap="round"/>`,
    `<path d="M${s - m - bl} ${m} L${s - m} ${m} L${s - m} ${m + bl}" fill="none" stroke="${c}" stroke-width="${bw}" stroke-linecap="round"/>`,
    `<path d="M${m} ${s - m - bl} L${m} ${s - m} L${m + bl} ${s - m}" fill="none" stroke="${c}" stroke-width="${bw}" stroke-linecap="round"/>`,
    `<path d="M${s - m - bl} ${s - m} L${s - m} ${s - m} L${s - m} ${s - m - bl}" fill="none" stroke="${c}" stroke-width="${bw}" stroke-linecap="round"/>`,
    `<line x1="${half}" y1="${m + 4}" x2="${half}" y2="${half - gap}" stroke="${c}" stroke-width="1" opacity="0.3"/>`,
    `<line x1="${half}" y1="${half + gap}" x2="${half}" y2="${s - m - 4}" stroke="${c}" stroke-width="1" opacity="0.3"/>`,
    `<line x1="${m + 4}" y1="${half}" x2="${half - gap}" y2="${half}" stroke="${c}" stroke-width="1" opacity="0.3"/>`,
    `<line x1="${half + gap}" y1="${half}" x2="${s - m - 4}" y2="${half}" stroke="${c}" stroke-width="1" opacity="0.3"/>`,
    `<circle cx="${half}" cy="${half}" r="${r}" fill="none" stroke="${c}" stroke-width="1.5" stroke-dasharray="8 5" opacity="0.45"/>`,
    `</svg>`,
  ].join("");
}

export function buildLockOnDataUrl(): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildLockOnSvg())}`;
}

/* ── 告警环（Alert severity rings）96x96 SVG ── */

export type AlertSeverity = "critical" | "warning" | "info";

const ALERT_RING_COLORS: Record<AlertSeverity, string> = {
  critical: "#ef4444",
  warning: "#f59e0b",
  info: "#60a5fa",
};

export function getAlertRingImageId(severity: AlertSeverity): string {
  return `alert-ring-${severity}`;
}

export function buildAlertRingSvg(severity: AlertSeverity): string {
  const color = ALERT_RING_COLORS[severity];
  const s = 96;
  const half = s / 2;
  const r1 = 40;
  const r2 = 36;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">`,
    `<circle cx="${half}" cy="${half}" r="${r1}" fill="none" stroke="${color}" stroke-width="6" opacity="0.15"/>`,
    `<circle cx="${half}" cy="${half}" r="${r2}" fill="none" stroke="${color}" stroke-width="2.2" opacity="0.75"/>`,
    `<line x1="${half}" y1="${half - r2 - 4}" x2="${half}" y2="${half - r2 + 4}" stroke="${color}" stroke-width="2" stroke-linecap="round" opacity="0.8"/>`,
    `<line x1="${half}" y1="${half + r2 - 4}" x2="${half}" y2="${half + r2 + 4}" stroke="${color}" stroke-width="2" stroke-linecap="round" opacity="0.8"/>`,
    `<line x1="${half - r2 - 4}" y1="${half}" x2="${half - r2 + 4}" y2="${half}" stroke="${color}" stroke-width="2" stroke-linecap="round" opacity="0.8"/>`,
    `<line x1="${half + r2 - 4}" y1="${half}" x2="${half + r2 + 4}" y2="${half}" stroke="${color}" stroke-width="2" stroke-linecap="round" opacity="0.8"/>`,
    `</svg>`,
  ].join("");
}

export function buildAlertRingDataUrl(severity: AlertSeverity): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildAlertRingSvg(severity))}`;
}

export function getAllAlertRingKeys(): Array<{ id: string; severity: AlertSeverity }> {
  const severities: AlertSeverity[] = ["critical", "warning", "info"];
  return severities.map((severity) => ({
    id: getAlertRingImageId(severity),
    severity,
  }));
}

/* ── 资产图标（Asset icons）48x48 SVG ── */

const ASSET_STATUS_COLORS: Record<AssetStatus, string> = {
  online: "#34d399",
  offline: "#f87171",
  degraded: "#fbbf24",
};

const ASSET_ICON_PATHS: Record<AssetType, string> = {
  radar:
    "M24 10 L24 22 M18 18 Q24 8 30 18 M13 22 Q24 4 35 22 M10 38 L24 26 L38 38 L10 38 Z",
  camera:
    "M12 18 L36 18 L40 24 L40 36 L8 36 L8 24 Z M24 22 A6 6 0 1 0 24 34 A6 6 0 1 0 24 22 Z M14 14 L20 14 L22 18",
  tower:
    "M24 6 L24 14 M20 10 L28 10 M18 14 L30 14 L28 42 L20 42 Z M14 42 L34 42 M15 26 L33 26",
  drone:
    "M14 14 L20 20 M34 14 L28 20 M14 34 L20 28 M34 34 L28 28 M20 20 L28 20 L28 28 L20 28 Z M14 14 A4 4 0 1 0 14 14.01 M34 14 A4 4 0 1 0 34 14.01 M14 34 A4 4 0 1 0 14 34.01 M34 34 A4 4 0 1 0 34 34.01",
  satellite:
    "M16 32 L22 26 M26 22 L32 16 M22 26 L26 22 M18 18 L14 14 M30 30 L34 34 M13 28 Q10 24 14 20 M20 34 Q24 38 28 35 M19 24 L24 19 L29 24 L24 29 Z",
};

export function getAssetSymbolId(type: AssetType, status: AssetStatus): string {
  return `asset-${type}-${status}`;
}

/**
 * 生成 48x48 资产图标 SVG。
 *
 * Build a 48x48 asset SVG icon colored by operational status.
 */
export function buildAssetSymbolSvg(type: AssetType, status: AssetStatus): string {
  const color = ASSET_STATUS_COLORS[status];
  const iconPath = ASSET_ICON_PATHS[type];

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">`,
    `<defs>`,
    `<filter id="ag"><feDropShadow dx="0" dy="0" stdDeviation="1.5" flood-color="${color}" flood-opacity="0.5"/></filter>`,
    `</defs>`,
    `<rect x="4" y="4" width="40" height="40" rx="6" fill="rgba(9,9,11,0.9)" stroke="${color}" stroke-width="2" filter="url(#ag)"/>`,
    `<path d="${iconPath}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    `</svg>`,
  ].join("");
}

export function buildAssetSymbolDataUrl(type: AssetType, status: AssetStatus): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildAssetSymbolSvg(type, status))}`;
}

export function getAllAssetSymbolKeys(): Array<{ id: string; type: AssetType; status: AssetStatus }> {
  const types: AssetType[] = ["radar", "camera", "tower", "drone", "satellite"];
  const statuses: AssetStatus[] = ["online", "offline", "degraded"];
  return types.flatMap((type) =>
    statuses.map((status) => ({ id: getAssetSymbolId(type, status), type, status }))
  );
}

/* ── 选中资产高亮框 52x52 SVG ── */

export const ASSET_SELECT_IMAGE_ID = "asset-select-ring";

export function buildAssetSelectSvg(): string {
  const c = "#34d399";
  const s = 52;
  const m = 4;
  const bl = 12;
  const bw = 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">`,
    `<path d="M${m} ${m + bl} L${m} ${m} L${m + bl} ${m}" fill="none" stroke="${c}" stroke-width="${bw}" stroke-linecap="round"/>`,
    `<path d="M${s - m - bl} ${m} L${s - m} ${m} L${s - m} ${m + bl}" fill="none" stroke="${c}" stroke-width="${bw}" stroke-linecap="round"/>`,
    `<path d="M${m} ${s - m - bl} L${m} ${s - m} L${m + bl} ${s - m}" fill="none" stroke="${c}" stroke-width="${bw}" stroke-linecap="round"/>`,
    `<path d="M${s - m - bl} ${s - m} L${s - m} ${s - m} L${s - m} ${s - m - bl}" fill="none" stroke="${c}" stroke-width="${bw}" stroke-linecap="round"/>`,
    `</svg>`,
  ].join("");
}

export function buildAssetSelectDataUrl(): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildAssetSelectSvg())}`;
}

/* ── GeoJSON 几何工具（覆盖范围 / 视场角 / 雷达扫描）── */

const DEG2RAD = Math.PI / 180;
const KM_PER_DEG = 111.32;

/**
 * 从 center 向某角度（地理 heading：0=北 顺时针）偏移 radiusKm 得到 [lng, lat]。
 */
function offsetPoint(centerLng: number, centerLat: number, radiusKm: number, headingDeg: number): [number, number] {
  const rad = headingDeg * DEG2RAD;
  const dy = radiusKm * Math.cos(rad);
  const dx = radiusKm * Math.sin(rad);
  const lat = centerLat + dy / KM_PER_DEG;
  const lng = centerLng + dx / (KM_PER_DEG * Math.cos(centerLat * DEG2RAD));
  return [lng, lat];
}

/**
 * 生成 360° 圆形坐标环。
 */
export function geoCircleCoords(centerLng: number, centerLat: number, radiusKm: number, segments = 64): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    pts.push(offsetPoint(centerLng, centerLat, radiusKm, (i / segments) * 360));
  }
  return pts;
}

/**
 * 生成扇形（视场角）坐标环。
 *
 * @param headingDeg  扇形中心线方向（0=北，顺时针）
 * @param fovDeg      视场角（度），例如 60 表示左右各 30°
 */
export function geoSectorCoords(
  centerLng: number,
  centerLat: number,
  radiusKm: number,
  headingDeg: number,
  fovDeg: number,
  segments = 32,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [[centerLng, centerLat]];
  const halfFov = fovDeg / 2;
  const startAngle = headingDeg - halfFov;
  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + (i / segments) * fovDeg;
    pts.push(offsetPoint(centerLng, centerLat, radiusKm, angle));
  }
  pts.push([centerLng, centerLat]);
  return pts;
}

/**
 * 生成雷达扫描扇区坐标环（用于动画：每帧更新 sweepAngle）。
 *
 * @param sweepAngle  当前扫描波束中心角度
 * @param beamWidth   波束宽度（度），默认 30
 */
export function geoRadarSweepCoords(
  centerLng: number,
  centerLat: number,
  radiusKm: number,
  sweepAngle: number,
  beamWidth = 30,
): Array<[number, number]> {
  return geoSectorCoords(centerLng, centerLat, radiusKm, sweepAngle, beamWidth, 16);
}
