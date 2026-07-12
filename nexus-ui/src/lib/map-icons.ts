import type { ExpressionSpecification } from "maplibre-gl";
import { FORCE_COLORS, type ForceDisposition } from "./theme-colors.ts";
import type { Track, PublicMapAssetType, AssetStatus } from "./map-entity-model.ts";
import { PUBLIC_MAP_ASSET_TYPES } from "./map-entity-model.ts";

/** 资产中心图标默认 zoom→size 插值 stops */
const DEFAULT_ICON_SIZE_STOPS: [number, number][] = [
  [5, 0.62],
  [10, 0.88],
  [15, 1.12],
];

/**
 * 将 zoom→size 数组转为 MapLibre interpolate 表达式。
 * @param stops - [[zoom, size], ...]，至少 2 组
 */
export function buildIconSizeExpr(stops: [number, number][] | undefined): ExpressionSpecification {
  const s = (stops && stops.length >= 2) ? stops : DEFAULT_ICON_SIZE_STOPS;
  return ["interpolate", ["linear"], ["zoom"], ...s.flat()] as unknown as ExpressionSpecification;
}

/** 雷达 / 光电 / 激光 / TDOA / 无人机与机场等**资产中心图标**共用的 `layout.icon-size`（避免同类标不同大） */
export const MAPLIBRE_ASSET_CENTER_ICON_SIZE: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  0.62,
  10,
  0.88,
  15,
  1.12,
];

export type TrackType = Track["type"];
export type AssetType = PublicMapAssetType;
export type { PublicMapAssetType, AssetStatus };

/** 根配置 `factory.assetIcons`：仅 **敌方 / 中立** 可覆盖默认 force 色；我方由各业务块 `label.fontColor` 等决定 */
export type AssetDispositionIconAccent = {
  hostileIcon?: string;
  neutralIcon?: string;
};

/** 写入 `AssetData.properties`，供地图友方图标/名称取色（由各 bundle 的 `label.fontColor` 等解析） */
export const MAP_FRIENDLY_COLOR_PROP = "map_friendly_color";
/** 写入 `AssetData.properties`，供地图名称标签取色（来自各业务块 `label.fontColor`） */
export const MAP_LABEL_FONT_COLOR_PROP = "map_label_font_color";

export type AssetIconFrameConfig = {
  canvasPx: number;
  plainCanvasPx: number;
  shadowBlurPx: number;
  shadowOpacity: number;
  droneTriangleCanvasPx: number;
  droneTriangleStrokeWidthPx: number;
};

export const DEFAULT_ASSET_ICON_FRAME_CONFIG: AssetIconFrameConfig = {
  canvasPx: 56,
  plainCanvasPx: 82,
  shadowBlurPx: 1.5,
  shadowOpacity: 0.5,
  droneTriangleCanvasPx: 72,
  droneTriangleStrokeWidthPx: 2,
};

let assetIconFrameConfig: AssetIconFrameConfig = { ...DEFAULT_ASSET_ICON_FRAME_CONFIG };

export function setAssetIconFrameConfig(config: Partial<AssetIconFrameConfig> | null | undefined): void {
  assetIconFrameConfig = { ...DEFAULT_ASSET_ICON_FRAME_CONFIG, ...(config ?? {}) };
}

export function getAssetIconFrameConfig(): AssetIconFrameConfig {
  return assetIconFrameConfig;
}

export function getAssetSymbolRasterSize(type: AssetType): number {
  const cfg = getAssetIconFrameConfig();
  return type === "usv" ? cfg.plainCanvasPx : cfg.canvasPx;
}

export function assetFriendlyColorFromProperties(props: Record<string, unknown> | null | undefined): string | undefined {
  const v = props?.[MAP_FRIENDLY_COLOR_PROP];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function assetLabelFontColorFromProperties(props: Record<string, unknown> | null | undefined): string | undefined {
  const v = props?.[MAP_LABEL_FONT_COLOR_PROP];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** 友方图标 id 后缀：`#ff0000` → `-mfff0000`（仅 disposition=friendly 时使用） */
export function friendlyTintSuffix(tint: string | null | undefined): string {
  const s = String(tint ?? "").trim();
  if (!s) return "";
  const safe = s.replace(/[^#a-zA-Z0-9]/g, "").slice(0, 28);
  return safe ? `-mf${safe}` : "";
}

/** 资产图标、激光/TDOA 扇区中心图标共用的敌我维度 */
export const MAP_FORCE_DISPOSITIONS: ForceDisposition[] = ["friendly", "hostile", "neutral"];
const VIRTUAL_SYMBOL_OPACITY = 0.6;

type AssetSymbolBuildOptions = {
  applyVirtualOpacity?: boolean;
};

/* ── 目标航迹图标：运行时从 public/icons/ 加载（改 SVG 后强刷页面即可） ── */

const TRACK_ICON_SVG_FILES: Record<TrackType, string> = {
  air: "移动实/空中目标.svg",
  sea: "移动实/水面目标.svg",
  underwater: "移动实/水下目标.svg",
};

const TRACK_ICON_VIRTUAL_SVG_FILES: Record<TrackType, string> = {
  air: "移动虚/空中目标虚.svg",
  sea: "移动虚/水面目标虚.svg",
  underwater: "移动虚/水下目标.svg",
};

type SvgFragment = { viewBox: string; body: string };

const trackIconFragmentCache = new Map<string, SvgFragment>();
const trackIconFragmentInflight = new Map<string, Promise<SvgFragment>>();

function trackIconCacheKey(type: TrackType, virtual: boolean): string {
  return `${type}:${virtual ? "v" : "r"}`;
}

function trackIconFile(type: TrackType, virtual: boolean): string {
  return virtual ? TRACK_ICON_VIRTUAL_SVG_FILES[type] : TRACK_ICON_SVG_FILES[type];
}

type TrackIconDef = { viewBox: string; pathD: string };

const TRACK_SVG_ICONS: Record<TrackType, TrackIconDef> = {
  // 来自 public/icons/空中目标.svg（viewBox 0 0 1024 1024）
  air: {
    viewBox: "0 0 1024 1024",
    pathD: "M950.208 208.64c16-48.128 12.8-89.888-12.8-118.784l-3.2-3.2c-28.8-25.696-70.368-28.896-118.368-12.832-41.6 12.832-80 38.528-115.168 70.624l-83.2 83.488L240 138.016c-16-3.2-35.2 0-48 12.864L115.2 227.936c-9.6 9.6-16 25.696-12.8 44.96 3.2 16.032 12.8 28.896 25.6 35.296l265.568 144.512-112 112.352-95.968-25.664c-6.4-3.2-12.8-3.2-16-3.2-12.8 0-25.6 6.4-35.2 16.032l-54.4 57.792C67.2 619.648 64 635.712 64 648.544c0 16.064 9.6 28.896 19.2 35.328l147.168 109.152 108.8 147.712c9.6 12.832 22.4 19.264 35.2 19.264h3.168c12.8 0 25.6-6.4 35.2-16.064l57.6-57.792c12.8-12.832 19.2-32.096 12.8-48.16l-25.6-96.32 111.968-112.384 143.968 266.496c9.6 16.064 22.4 22.496 32 25.696 6.4 3.2 9.6 3.2 12.8 3.2 12.8 0 22.4-3.2 32-9.6l76.768-57.824c16-12.832 22.4-32.096 19.2-51.36l-89.6-398.144 83.2-83.488c32-32.096 57.6-70.624 70.4-115.584z m-224.896 180.8l97.376 425.92-58.432 41.92-181.76-329.12-201.28 200.064 35.68 125.824L377.952 896l-103.872-138.752L128 647.552l42.208-41.92 126.592 35.456 201.28-200.032-334.4-180.704 58.464-58.08 412.256 96.8 110.4-106.464c25.92-25.824 58.4-45.184 90.88-58.08 35.712-12.896 48.672-3.232 55.168 0 3.264 6.432 9.76 19.36 0 54.848a197.76 197.76 0 0 1-58.432 90.336l-107.104 109.696z",
  },
  // 预加载失败时的兜底（正常路径为 fetchTrackIconFragment → public/icons/水面目标.svg）
  sea: {
    viewBox: "0 0 1920 1080",
    pathD: "M806,503.3V924h307.2V503.3h-26.7v394H832.7v-394H806z M832.7,503.3v40.1h26.7v-40.1H832.7z M1059.8,503.3v40.1h26.7v-40.1H1059.8z M872.8,272.3c-24.5,58.4-40,140.1-40,230.9H806c0-93.5,15.9-178.9,42.1-241.3c13.1-31.2,29-57.3,47.4-75.8c18.4-18.6,40.1-30.2,64.1-30.2c24,0,45.6,11.6,64.1,30.2c18.4,18.5,34.3,44.6,47.4,75.8c26.2,62.4,42.1,147.7,42.1,241.3h-26.7c0-90.9-15.5-172.5-40-230.9c-12.3-29.2-26.6-52-41.7-67.3c-15.1-15.2-30.4-22.3-45.1-22.3c-14.7,0-30,7.1-45.1,22.3C899.3,220.3,885,243.1,872.8,272.3z",
  },
  // 来自 public/icons/水下目标.svg；用 clipPath 定义的区域作 viewBox，自然裁切可见部分
  underwater: {
    viewBox: "-182 257 1113.8 820.7",
    pathD: "M585.9,462.3c33.9,0,61.7,26.4,63.9,59.8v4.2c.1,0,.1,64,.1,64h38.4c131.5,0,239.2,104.6,243.1,236v7.2c.1,134.3-108.7,243.2-243,243.2H125.2c-72.8,0-133.6-55.5-140.2-128h-90.2s0,51.2,0,51.2c0,20.5-16,37.5-36.5,38.5-20.5,1-38.2-14.3-40.1-34.8l-.2-3.7v-332.8c0-20.5,16-37.5,36.5-38.5,20.5-1,38.2,14.4,40.1,34.8l.2,3.7v38.4H-13.3c12-64.6,66.9-112.3,132.5-115.1h6c0-.1,12.8-.1,12.8-.1v-64c0-33.9,26.4-61.7,59.8-63.9h4.2c0-.1,383.9-.1,383.9-.1ZM688.4,667.1H125.2c-35.4,0-64,28.7-64,64v204.8c0,35.3,28.7,64,64,64h563.2c60,.8,115.7-30.8,145.9-82.6s30.2-115.8,0-167.6c-30.2-51.8-85.9-83.3-145.9-82.6h0ZM-15.6,782.3h-89.6v89.6H-15.6v-89.6ZM573.2,539.2H214.8v51.2h358.4v-51.2ZM573.2,539.2",
  },
};

/**
 * 获取地图引擎内部使用的图标 ID。
 *
 * Get a stable marker image ID for MapLibre/Cesium caches.
 */
export function getMarkerSymbolId(
  type: TrackType,
  disposition: ForceDisposition,
  virtual = false,
  friendlyTint?: string | null,
): string {
  const base = `track-${type}-${disposition}-${virtual ? "v" : "r"}`;
  const suf = friendlyTintSuffix(friendlyTint);
  return suf ? `${base}${suf}` : base;
}

function tintTrackIconInner(inner: string, color: string): string {
  let s = inner.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s
    .replace(/fill="#828282"/gi, `fill="${color}"`)
    .replace(/fill='#828282'/gi, `fill="${color}"`)
    .replace(/fill="#D1D7DD"/gi, `fill="${color}"`)
    .replace(/fill='#D1D7DD'/gi, `fill="${color}"`)
    .replace(/fill="#ffffff"/gi, `fill="${color}"`)
    .replace(/fill='#ffffff'/gi, `fill="${color}"`)
    .replace(/fill="#fff"/gi, `fill="${color}"`)
    .replace(/fill='#fff'/gi, `fill="${color}"`)
    .replace(/fill="#999"/gi, `fill="${color}"`)
    .replace(/fill='#999'/gi, `fill="${color}"`)
    .replace(/fill="#000000"/gi, `fill="${color}"`)
    .replace(/fill='#000000'/gi, `fill="${color}"`)
    .replace(/fill="#000"/gi, `fill="${color}"`)
    .replace(/fill='#000'/gi, `fill="${color}"`);
  s = s.replace(/\bclass="[^"]*"/gi, `fill="${color}"`);
  s = s.replace(/<(path|polygon|polyline|circle|ellipse|rect)\b(?![^>]*\bfill=)/gi, `<$1 fill="${color}"`);
  s = s.replace(/\bstroke="(?!none)[^"]*"/gi, `stroke="${color}"`);
  return s;
}

function buildTrackGlyphInner(
  type: TrackType,
  color: string,
  virtual: boolean,
): { viewBox: string; inner: string } {
  const cached = trackIconFragmentCache.get(trackIconCacheKey(type, virtual));
  if (cached) {
    const tinted = tintTrackIconInner(cached.body, color);
    return { viewBox: cached.viewBox, inner: tinted };
  }
  const icon = TRACK_SVG_ICONS[type];
  const inner = `<path d="${icon.pathD}" fill="${color}"/>`;
  return { viewBox: icon.viewBox, inner };
}

/** 无人船与航迹「水面目标」同源（`水面目标.svg`） */
function plainGlyphUsvTrackInner(color: string, virtual: boolean): { viewBox: string; inner: string } {
  return buildTrackGlyphInner("sea", color, virtual);
}

/** 飞弹 SVG 整图保留；方向默认偏移由 `missile-maplibre` 的 `icon-rotate` 统一处理。 */
function plainGlyphMissilePublicInner(
  viewBox: string,
  iconBody: string,
  color: string,
): { viewBox: string; inner: string } {
  return { viewBox, inner: tintPublicAssetIconInner(iconBody, color, "missile") };
}

/** 航迹点/线填色：敌/中读 `factory.assetIcons`；我方读 `trackRendering.trackTypeStyles.*.idColor`（由调用方传入） */
export function resolveTrackMarkerFill(
  disposition: ForceDisposition,
  accent?: AssetDispositionIconAccent | null,
  friendlyFill?: string | null,
): string {
  const o = friendlyFill?.trim();
  if (o) return o;
  if (disposition === "hostile") return accent?.hostileIcon ?? FORCE_COLORS.hostile;
  if (disposition === "neutral") return accent?.neutralIcon ?? FORCE_COLORS.neutral;
  return FORCE_COLORS.friendly;
}

/**
 * 生成用于 2D/3D 的目标图标 SVG（64x64），无底板圆形，直接渲染目标轮廓。
 *
 * 颜色随态势（敌/友/中立）动态注入，黑色投影保证在浅色地图上的可见性。
 * 约定：图标默认朝"正北/向上"，旋转由地图层/引擎根据 heading 处理。
 */
export function buildMarkerSymbolSvg(
  type: TrackType,
  disposition: ForceDisposition,
  accent?: AssetDispositionIconAccent | null,
  virtual = false,
  friendlyFill?: string | null,
): string {
  const color = resolveTrackMarkerFill(disposition, accent ?? null, friendlyFill);
  const { viewBox, inner: glyphInner } = buildTrackGlyphInner(type, color, virtual);
  const opacity = virtual ? VIRTUAL_SYMBOL_OPACITY : 1;
  const northAttrs = `stroke="${color}" stroke-width="2.2" stroke-linecap="round"`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">`,
    `<defs>`,
    `<filter id="sh" x="-25%" y="-25%" width="150%" height="150%">`,
    `<feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#000" flood-opacity="0.85"/>`,
    `</filter>`,
    `</defs>`,
    `<g opacity="${opacity}">`,
    `<svg x="4" y="6" width="56" height="54" viewBox="${viewBox}" filter="url(#sh)">`,
    glyphInner,
    `</svg>`,
    `<path d="M32 2 L32 7" fill="none" ${northAttrs} opacity="0.9"/>`,
    `</g>`,
    `</svg>`,
  ].join("");
}

/**
 * 将 SVG 包装成 data URL，便于 MapLibre `addImage`/Cesium billboard 直接使用。
 *
 * Wrap the generated SVG into a data URL.
 */
export function buildMarkerSymbolDataUrl(
  type: TrackType,
  disposition: ForceDisposition,
  accent?: AssetDispositionIconAccent | null,
  virtual = false,
  friendlyFill?: string | null,
): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildMarkerSymbolSvg(type, disposition, accent ?? null, virtual, friendlyFill))}`;
}

/**
 * 枚举项目内所有"目标类型 × 态势"的图标 key，用于预注册到 MapLibre sprite/image cache。
 *
 * Enumerate all marker keys so we can pre-register images.
 */
export function getAllMarkerSymbolKeys(): Array<{
  id: string;
  type: TrackType;
  disposition: ForceDisposition;
  virtual: boolean;
}> {
  return getAllMarkerSymbolKeysForPrereg(null);
}

type TrackStylesForPrereg = {
  trackTypeStyles?: {
    sea?: { idColor?: string };
    air?: { idColor?: string };
    underwater?: { idColor?: string };
  };
  targetStateStyles?: Record<string | number, { color?: string } | undefined>;
};

/** 友方航迹符号：为每种 `trackTypeStyles.*.idColor` 预注册一套 tint（另含无 tint 的默认友方色） */
export function getAllMarkerSymbolKeysForPrereg(trackRendering: TrackStylesForPrereg | null): Array<{
  id: string;
  type: TrackType;
  disposition: ForceDisposition;
  virtual: boolean;
  friendlyFill?: string;
}> {
  const types: TrackType[] = ["air", "sea", "underwater"];
  const dispositions: ForceDisposition[] = ["hostile", "friendly", "neutral"];
  const friendlyTints = new Set<string>();
  friendlyTints.add("");
  if (trackRendering?.trackTypeStyles) {
    const tts = trackRendering.trackTypeStyles;
    for (const k of ["sea", "air", "underwater"] as const) {
      const c = tts[k]?.idColor;
      if (typeof c === "string" && c.trim()) friendlyTints.add(c.trim());
    }
  }
  const targetStateTints = new Set<string>();
  if (trackRendering?.targetStateStyles) {
    for (const style of Object.values(trackRendering.targetStateStyles)) {
      const c = style?.color;
      if (typeof c === "string" && c.trim()) targetStateTints.add(c.trim());
    }
  }
  const tintList = [...friendlyTints];
  const stateTintList = [...targetStateTints];
  const out: Array<{
    id: string;
    type: TrackType;
    disposition: ForceDisposition;
    virtual: boolean;
    friendlyFill?: string;
  }> = [];
  for (const type of types) {
    for (const disposition of dispositions) {
      for (const virtual of [false, true]) {
        if (disposition !== "friendly") {
          out.push({
            id: getMarkerSymbolId(type, disposition, virtual),
            type,
            disposition,
            virtual,
          });
          for (const tint of stateTintList) {
            out.push({
              id: getMarkerSymbolId(type, disposition, virtual, tint),
              type,
              disposition,
              virtual,
              friendlyFill: tint,
            });
          }
          continue;
        }
        for (const tint of [...new Set([...tintList, ...stateTintList])]) {
          out.push({
            id: getMarkerSymbolId(type, disposition, virtual, tint || undefined),
            type,
            disposition,
            virtual,
            friendlyFill: tint || undefined,
          });
        }
      }
    }
  }
  return out;
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

function resolveAssetIconAccentFill(
  disposition: ForceDisposition,
  _status: AssetStatus,
  accent?: AssetDispositionIconAccent | null,
  friendlyOverride?: string | null,
): string {
  if (disposition === "hostile") return accent?.hostileIcon ?? FORCE_COLORS.hostile;
  if (disposition === "neutral") return accent?.neutralIcon ?? FORCE_COLORS.neutral;
  const o = friendlyOverride?.trim();
  if (o) return o;
  return FORCE_COLORS.friendly;
}

/** 地图名称标注字色：敌/中由 `factory.assetIcons`；我方由各块 `label.fontColor`（经 `map_label_font_color` 或显式传入） */
export function assetMapLabelTextColor(
  disposition: ForceDisposition,
  status: AssetStatus,
  accent?: AssetDispositionIconAccent | null,
  friendlyOverride?: string | null,
): string {
  return resolveAssetIconAccentFill(disposition, status, accent ?? null, friendlyOverride);
}

/** 标牌等 UI 用：与 `assetMapLabelTextColor` 一致 */
export function assetPlacardHeaderColor(
  disposition: ForceDisposition,
  status: AssetStatus,
  accent?: AssetDispositionIconAccent | null,
  friendlyOverride?: string | null,
): string {
  return assetMapLabelTextColor(disposition, status, accent, friendlyOverride);
}

/**
 * `public/icons` 下与地图绑定的矢量文件名（`fetchPublicMapAssetFragment` 拉取并缓存）。
 * 其中 **`drone`** 在 `DRONE_MAP_ICON_SOURCE === "generated"` 时不参与网络请求，改由 `buildDroneTriangleDataUrl` 生成。
 */
export const PUBLIC_MAP_SVG_FILES = {
  radar: "固定装备实/雷达.svg",
  camera: "固定装备实/光电.svg",
  tower: "固定装备实/电侦.svg",
  laser: "固定装备实/激光.svg",
  tdoa: "固定装备实/TDOA.svg",
  airport: "固定装备实/无人机机场.svg",
  drone: "无人机.svg",
  usv: "移动实/水面目标.svg",
  missile: "移动实/飞弹.svg",
} as const;

const PUBLIC_MAP_VIRTUAL_SVG_FILES = {
  radar: "固定装备虚/雷达.svg",
  camera: "固定装备虚/光电.svg",
  tower: "固定装备虚/电侦.svg",
  laser: "固定装备虚/激光.svg",
  tdoa: "固定装备虚/TDOA.svg",
  airport: "固定装备虚/无人机机场.svg",
  drone: "无人机.svg",
  usv: "移动虚/水面目标虚.svg",
  missile: "移动虚/飞弹虚.svg",
} as const;

export type PublicMapSvgKey = keyof typeof PUBLIC_MAP_SVG_FILES;

export type SectorCenterIconKind = Extract<PublicMapSvgKey, "laser" | "tdoa">;

function publicPathPrefix(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BASE_PATH) {
    return String(process.env.NEXT_PUBLIC_BASE_PATH).replace(/\/$/, "");
  }
  return "";
}

/** 浏览器内请求 `public/icons` 下资源的绝对/根相对 URL（支持 basePath） */
export function publicIconFileUrl(filename: string): string {
  return `${publicPathPrefix()}/icons/${filename}`;
}

/** MapLibre `addImage` id，与 `laser-maplibre` / `tdoa-maplibre` 图层表达式一致 */
export function sectorCenterMapImageId(kind: SectorCenterIconKind, disposition: ForceDisposition): string {
  const p = kind === "laser" ? "nexus-laser" : "nexus-tdoa";
  return `${p}-ctr-${disposition}`;
}

export function getAllSectorCenterSymbolKeys(): Array<{
  id: string;
  kind: SectorCenterIconKind;
  disposition: ForceDisposition;
}> {
  const kinds: SectorCenterIconKind[] = ["laser", "tdoa"];
  return kinds.flatMap((kind) =>
    MAP_FORCE_DISPOSITIONS.map((disposition) => ({
      id: sectorCenterMapImageId(kind, disposition),
      kind,
      disposition,
    })),
  );
}

const publicAssetFragmentCache = new Map<string, SvgFragment>();
const publicAssetFragmentInflight = new Map<string, Promise<SvgFragment>>();

function assetIconCacheKey(type: AssetType, virtual: boolean): string {
  return `${type}:${virtual ? "v" : "r"}`;
}

function publicMapAssetIconFile(type: AssetType, virtual: boolean): string {
  return virtual ? PUBLIC_MAP_VIRTUAL_SVG_FILES[type] : PUBLIC_MAP_SVG_FILES[type];
}

/** 无人机地图中心图标：`svg` 读 `public/icons/无人机.svg` 装裱；`generated` 为 V2 `DroneRenderer.loadDroneIcon` 同款 Canvas 三角形（PNG） */
export type DroneMapIconSource = "generated";

/**
 * 硬编码切换（不读 app-config）。改此处即可在「矢量装裱」与「程序生成三角形」之间切换。
 */
export const DRONE_MAP_ICON_SOURCE: DroneMapIconSource = "generated";

/**
 * 与 V2 `ALERT_DRONE_SNS` 一致：列入此表的 SN 在 **`generated` 机队层** 使用蓝色三角形；仅 `generated` 时生效。
 * 示例（按需填入）：`['1581F6Q8D249300GJ0DJ', '1581F6Q8D244300C47RP']`
 */
export const STATIC_DRONE_MAP_ICON_ALERT_SNS: readonly string[] = ['1581F6Q8D249300GJ0DJ', '1581F6Q8D244300C47RP'];

/** 实时机队贴图 id（`generated` 模式）：友方 4 态 + 敌方 2 态 + 中立 2 态 */
export const DRONE_FLEET_MAP_IMAGE_FRIENDLY = "nexus-drone-fleet-friendly";
export const DRONE_FLEET_MAP_IMAGE_FRIENDLY_DASH = "nexus-drone-fleet-friendly-dash";
export const DRONE_FLEET_MAP_IMAGE_FRIENDLY_ALERT = "nexus-drone-fleet-friendly-alert";
export const DRONE_FLEET_MAP_IMAGE_FRIENDLY_ALERT_DASH = "nexus-drone-fleet-friendly-alert-dash";
export const DRONE_FLEET_MAP_IMAGE_HOSTILE = "nexus-drone-fleet-hostile";
export const DRONE_FLEET_MAP_IMAGE_HOSTILE_DASH = "nexus-drone-fleet-hostile-dash";
export const DRONE_FLEET_MAP_IMAGE_NEUTRAL = "nexus-drone-fleet-neutral";
export const DRONE_FLEET_MAP_IMAGE_NEUTRAL_DASH = "nexus-drone-fleet-neutral-dash";

/** V2 `DroneRenderer.loadDroneIcon`：向上三角 + 白描边，虚兵为虚线描边 */
export function buildDroneTriangleDataUrl(fillColor: string, dashedStroke: boolean): string {
  const cfg = getAssetIconFrameConfig();
  const size = cfg.droneTriangleCanvasPx;
  if (typeof document === "undefined") {
    throw new Error("[map-icons] buildDroneTriangleDataUrl 仅在浏览器环境可用");
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("[map-icons] Canvas 2D 不可用");
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = dashedStroke ? cfg.droneTriangleStrokeWidthPx + 0.5 : cfg.droneTriangleStrokeWidthPx;
  ctx.beginPath();
  ctx.moveTo(size / 2, size * 0.2);
  ctx.lineTo(size * 0.8, size * 0.8);
  ctx.lineTo(size / 2, size * 0.65);
  ctx.lineTo(size * 0.2, size * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.setLineDash(dashedStroke ? [5, 4] : []);
  ctx.stroke();
  ctx.setLineDash([]);
  return canvas.toDataURL("image/png");
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("[map-icons] 图片解码失败"));
    img.src = dataUrl;
  });
}

type MapImageSink = {
  hasImage(id: string): boolean;
  addImage(id: string, image: HTMLImageElement, options?: { pixelRatio?: number }): void;
};

/** 注册机队三角形贴图（友方 4 态 + 敌方 2 态 + 中立 2 态 = 8 张）
 *  友方：普通用配置色，告警用蓝色；敌/中立：强制用对应 force 色（告警不单独变色）
 */
export async function registerDroneFleetTriangleImages(
  map: MapImageSink,
  options?: {
    pixelRatio?: number;
    friendlyColor?: string;
    alertColor?: string;
    hostileColor?: string;
    neutralColor?: string;
  },
): Promise<void> {
  const pr = options?.pixelRatio ?? 2;
  const friendlyColor = options?.friendlyColor ?? "#6ee7b7";
  const alertColor = options?.alertColor ?? "#2196F3";
  const hostileColor = options?.hostileColor ?? FORCE_COLORS.hostile;
  const neutralColor = options?.neutralColor ?? FORCE_COLORS.neutral;
  const defs: [string, string, boolean][] = [
    [DRONE_FLEET_MAP_IMAGE_FRIENDLY, friendlyColor, false],
    [DRONE_FLEET_MAP_IMAGE_FRIENDLY_DASH, friendlyColor, true],
    [DRONE_FLEET_MAP_IMAGE_FRIENDLY_ALERT, alertColor, false],
    [DRONE_FLEET_MAP_IMAGE_FRIENDLY_ALERT_DASH, alertColor, true],
    [DRONE_FLEET_MAP_IMAGE_HOSTILE, hostileColor, false],
    [DRONE_FLEET_MAP_IMAGE_HOSTILE_DASH, hostileColor, true],
    [DRONE_FLEET_MAP_IMAGE_NEUTRAL, neutralColor, false],
    [DRONE_FLEET_MAP_IMAGE_NEUTRAL_DASH, neutralColor, true],
  ];
  for (const [id, fill, dash] of defs) {
    if (map.hasImage(id)) continue;
    const dataUrl = buildDroneTriangleDataUrl(fill, dash);
    const img = await loadImageFromDataUrl(dataUrl);
    map.addImage(id, img, { pixelRatio: pr });
  }
}

export function droneFleetIconUsesGeneratedMode(): boolean {
  return DRONE_MAP_ICON_SOURCE === "generated";
}

export function droneSnIsMapIconAlert(sn: string): boolean {
  return STATIC_DRONE_MAP_ICON_ALERT_SNS.includes(String(sn).trim());
}

/**
 * 从 `public/icons` 读取 SVG 正文并解析为内层片段（按 `type` 缓存，同会话只请求一次）。
 */
export async function fetchPublicMapAssetFragment(type: AssetType, virtual = false): Promise<{ viewBox: string; body: string }> {
  const key = assetIconCacheKey(type, virtual);
  const hit = publicAssetFragmentCache.get(key);
  if (hit) return hit;
  let inflight = publicAssetFragmentInflight.get(key);
  if (!inflight) {
    inflight = (async () => {
      const url = publicIconFileUrl(publicMapAssetIconFile(type, virtual));
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`[map-icons] 无法加载资产图标：${url}（HTTP ${res.status}）`);
      }
      const text = await res.text();
      const parsed = extractSvgInnerForMapAsset(text);
      publicAssetFragmentCache.set(key, parsed);
      return parsed;
    })();
    publicAssetFragmentInflight.set(key, inflight);
    void inflight.finally(() => {
      publicAssetFragmentInflight.delete(key);
    });
  }
  return inflight;
}

/** 预加载 `public/icons` 片段；`generated` 无人机不请求 `无人机.svg` */
export async function preloadPublicMapAssetFragments(types?: readonly AssetType[]): Promise<void> {
  const list = (types ?? [...PUBLIC_MAP_ASSET_TYPES]).filter(
    (t) => !(t === "drone" && DRONE_MAP_ICON_SOURCE === "generated"),
  );
  await Promise.all(list.flatMap((t) => [fetchPublicMapAssetFragment(t, false), fetchPublicMapAssetFragment(t, true)]));
}

export function extractSvgInnerForMapAsset(svgText: string): { viewBox: string; body: string } {
  const cleaned = svgText.replace(/^\uFEFF/, "").replace(/<\?xml[\s\S]*?\?>/gi, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  const m = cleaned.match(/<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/i);
  if (!m) throw new Error("invalid svg");
  const attrs = m[1];
  const body = m[2].trim();
  const viewBox =
    attrs.match(/\bviewBox\s*=\s*"([^"]+)"/i)?.[1]?.trim() ??
    attrs.match(/\bviewBox\s*=\s*'([^']+)'/i)?.[1]?.trim() ??
    "0 0 32 32";
  return { viewBox, body };
}

/** 从 `public/icons` 读取航迹 SVG（按类型缓存） */
export async function fetchTrackIconFragment(type: TrackType, virtual = false): Promise<{ viewBox: string; body: string }> {
  const key = trackIconCacheKey(type, virtual);
  const hit = trackIconFragmentCache.get(key);
  if (hit) return hit;
  let inflight = trackIconFragmentInflight.get(key);
  if (!inflight) {
    inflight = (async () => {
      const url = publicIconFileUrl(trackIconFile(type, virtual));
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`[map-icons] 无法加载航迹图标：${url}（HTTP ${res.status}）`);
      }
      const parsed = extractSvgInnerForMapAsset(await res.text());
      trackIconFragmentCache.set(key, parsed);
      return parsed;
    })();
    trackIconFragmentInflight.set(key, inflight);
    void inflight.finally(() => {
      trackIconFragmentInflight.delete(key);
    });
  }
  return inflight;
}

export function getTrackIconFragmentSync(type: TrackType, virtual = false): { viewBox: string; body: string } | null {
  return trackIconFragmentCache.get(trackIconCacheKey(type, virtual)) ?? null;
}

/** 地图 `addImage` 前预加载空/海/潜航迹图标 */
export async function preloadTrackIconFragments(types?: readonly TrackType[]): Promise<void> {
  const list = types ?? (["air", "sea", "underwater"] as TrackType[]);
  await Promise.all(list.flatMap((t) => [fetchTrackIconFragment(t, false), fetchTrackIconFragment(t, true)]));
}

function tintPublicAssetIconInner(inner: string, color: string, type: AssetType): string {
  let s = inner.replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/fill="#D1D7DD"/gi, `fill="${color}"`)
    .replace(/fill='#D1D7DD'/gi, `fill="${color}"`)
    .replace(/fill="#ffffff"/gi, `fill="${color}"`)
    .replace(/fill='#ffffff'/gi, `fill="${color}"`)
    .replace(/fill="#fff"/gi, `fill="${color}"`)
    .replace(/fill='#fff'/gi, `fill="${color}"`);
  if (type === "usv" || type === "missile") {
    return s
      .replace(/fill="#999"/gi, `fill="${color}"`)
      .replace(/fill='#999'/gi, `fill="${color}"`)
      .replace(/fill="#828282"/gi, `fill="${color}"`)
      .replace(/fill='#828282'/gi, `fill="${color}"`)
      .replace(/fill="#a0a0a0"/gi, `fill="${color}"`)
      .replace(/fill='#a0a0a0'/gi, `fill="${color}"`)
      .replace(/fill="#000000"/gi, `fill="${color}"`)
      .replace(/fill='#000000'/gi, `fill="${color}"`)
      .replace(/fill="#000"/gi, `fill="${color}"`)
      .replace(/fill='#000'/gi, `fill="${color}"`)
      .replace(/\bclass="[^"]*"/gi, `fill="${color}"`)
      .replace(/<(path|polygon|polyline|circle|ellipse|rect)\b(?![^>]*\bfill=)/gi, `<$1 fill="${color}"`)
      .replace(/\bstroke="(?!none)[^"]*"/gi, `stroke="${color}"`);
  }
  if (type === "tower") {
    s = s.replace(/fill:\s*#d1d7dd/gi, `fill: ${color}`);
  }
  s = s
    .replace(/fill="#a1f8db"/gi, `fill="${color}"`)
    .replace(/fill='#a1f8db'/gi, `fill="${color}"`)
    .replace(/fill="#19191d"/gi, `fill="rgba(9,9,11,0.9)"`)
    .replace(/fill='#19191d'/gi, `fill="rgba(9,9,11,0.9)"`)
    .replace(/\bclass="st0"/gi, `fill="rgba(9,9,11,0.9)"`)
    .replace(/\bclass="st1"/gi, `fill="${color}"`)
    .replace(/\bclass="[^"]*"/gi, `fill="${color}"`)
    .replace(/<(path|polygon|polyline|circle|ellipse|rect)\b(?![^>]*\bfill=)/gi, `<$1 fill="${color}"`)
    .replace(/\bstroke="(?!none)[^"]*"/gi, `stroke="${color}"`);
  return s;
}

function buildPublicGlyphSvgString(
  viewBox: string,
  tintedInnerSvg: string,
  virtual: boolean,
  size: number,
  pad = 0,
  applyVirtualOpacity = true,
): string {
  const cfg = getAssetIconFrameConfig();
  const inner = size - pad * 2;
  const opacity = virtual && applyVirtualOpacity ? VIRTUAL_SYMBOL_OPACITY : 1;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<defs>`,
    `<filter id="ag" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="0" stdDeviation="${cfg.shadowBlurPx}" flood-color="#000" flood-opacity="${cfg.shadowOpacity}"/></filter>`,
    `</defs>`,
    `<g opacity="${opacity}" filter="url(#ag)">`,
    `<svg x="${pad}" y="${pad}" width="${inner}" height="${inner}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">`,
    tintedInnerSvg,
    `</svg>`,
    `</g>`,
    `</svg>`,
  ].join("");
}

/**
 * 将任意 `public/icons` 内矢量体装裱成与资产图标一致的外框（用于激光/TDOA 中心等）。
 * `tintAsAssetType` 用 `radar` 时仅做通用灰/白填色替换，不走电侦 CSS 分支。
 */
export function buildFramedPublicGlyphSvgDataUrl(
  viewBox: string,
  iconBody: string,
  frameColor: string,
  virtual = false,
  pad = 8,
  tintAsAssetType: AssetType = "radar",
): string {
  const tinted = tintPublicAssetIconInner(iconBody, frameColor, tintAsAssetType);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    buildPublicGlyphSvgString(viewBox, tinted, virtual, getAssetIconFrameConfig().canvasPx, pad),
  )}`;
}

/** 激光/TDOA 中心点：敌/中读 factory；我方读扇区 bundle 的 `label.fontColor`（由调用方传入） */
export function sectorCenterGlyphColor(
  disposition: ForceDisposition,
  accent?: AssetDispositionIconAccent | null,
  friendlyOverride?: string | null,
): string {
  return resolveAssetIconAccentFill(disposition, "online", accent ?? null, friendlyOverride);
}

/** 将 `public/icons` 内图标体按当前颜色逻辑着色，虚目标只做 60% 透明。 */
export function buildAssetWrappedSvgFromPublicBody(
  viewBox: string,
  iconInner: string,
  type: AssetType,
  status: AssetStatus,
  virtual: boolean,
  disposition: ForceDisposition = "friendly",
  accent?: AssetDispositionIconAccent | null,
  friendlyOverride?: string | null,
  options?: AssetSymbolBuildOptions,
): string {
  const color = resolveAssetIconAccentFill(disposition, status, accent, friendlyOverride);
  const cfg = getAssetIconFrameConfig();
  const pad = 0;
  const applyVirtualOpacity = options?.applyVirtualOpacity ?? true;
  if (type === "usv") {
    const { viewBox: vb, inner } = plainGlyphUsvTrackInner(color, virtual);
    return buildPublicGlyphSvgString(vb, inner, virtual, cfg.plainCanvasPx, 0, applyVirtualOpacity);
  }
  if (type === "missile") {
    const { viewBox: vb, inner } = plainGlyphMissilePublicInner(viewBox, iconInner, color);
    return buildPublicGlyphSvgString(vb, inner, virtual, cfg.canvasPx, 0, applyVirtualOpacity);
  }
  const tinted = tintPublicAssetIconInner(iconInner, color, type);
  return buildPublicGlyphSvgString(viewBox, tinted, virtual, cfg.canvasPx, pad, applyVirtualOpacity);
}

export function getAssetSymbolId(
  type: AssetType,
  status: AssetStatus,
  virtual = false,
  disposition: ForceDisposition = "friendly",
  friendlyTint?: string | null,
): string {
  const base = `asset-${type}-${disposition}-${status}-${virtual ? "v" : "r"}`;
  if (disposition !== "friendly") return base;
  const suf = friendlyTintSuffix(friendlyTint);
  return suf ? `${base}${suf}` : base;
}

/**
 * 生成 56×56 资产图标 SVG；内层矢量来自 `fetchPublicMapAssetFragment`（与 `PUBLIC_MAP_SVG_FILES` 一一对应）。
 */
export async function buildAssetSymbolSvg(
  type: AssetType,
  status: AssetStatus,
  virtual = false,
  disposition: ForceDisposition = "friendly",
  accent?: AssetDispositionIconAccent | null,
  friendlyOverride?: string | null,
  options?: AssetSymbolBuildOptions,
): Promise<string> {
  if (type === "drone" && DRONE_MAP_ICON_SOURCE === "generated") {
    throw new Error("[map-icons] drone 为 generated 模式，请使用 buildAssetSymbolDataUrl");
  }
  const fr = await fetchPublicMapAssetFragment(type, virtual);
  return buildAssetWrappedSvgFromPublicBody(fr.viewBox, fr.body, type, status, virtual, disposition, accent, friendlyOverride, options);
}

export async function buildAssetSymbolDataUrl(
  type: AssetType,
  status: AssetStatus,
  virtual = false,
  disposition: ForceDisposition = "friendly",
  accent?: AssetDispositionIconAccent | null,
  friendlyOverride?: string | null,
  options?: AssetSymbolBuildOptions,
): Promise<string> {
  if (type === "drone" && DRONE_MAP_ICON_SOURCE === "generated") {
    const fill = resolveAssetIconAccentFill(disposition, status, accent ?? null, friendlyOverride ?? null);
    return buildDroneTriangleDataUrl(fill, virtual);
  }
  const svg = await buildAssetSymbolSvg(type, status, virtual, disposition, accent, friendlyOverride, options);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function getAllAssetSymbolKeys(): Array<{
  id: string;
  type: AssetType;
  status: AssetStatus;
  virtual: boolean;
  disposition: ForceDisposition;
}> {
  return getAllAssetSymbolKeysForPrereg([]);
}

function uniqueFriendlyTintsFromConfigAssets(
  assets: readonly { properties?: unknown }[],
  extraFriendlyTints?: readonly (string | null | undefined)[],
): string[] {
  const s = new Set<string>();
  s.add("");
  for (const a of assets) {
    const p = a.properties as Record<string, unknown> | null | undefined;
    const c = assetFriendlyColorFromProperties(p ?? null);
    if (c) s.add(c);
  }
  if (extraFriendlyTints) {
    for (const raw of extraFriendlyTints) {
      const c = typeof raw === "string" && raw.trim() ? raw.trim() : "";
      if (c) s.add(c);
    }
  }
  return [...s];
}

/**
 * 友方 `asset-*-friendly-*` 的 `addImage` 预注册键。
 *
 * `Map2D.adaptAssets` 友方着色：`properties.map_friendly_color` 缺省时会用各根键 **`assetFriendlyColor`**
 *（`getAssetFriendlyColorForAssetType`）。若仅扫第一个参数里的资产行（如 **`drones.devices` 为空**），
 * 根级 **`drones.assetFriendlyColor`** 不会出现在任何行的 `properties` 上，预注册会漏掉 `-mf#…` 后缀图，MapLibre 报缺图。
 * 调用方应传入 **`mergeDynamicAndStaticAssets`** 结果作第一参数，并把 **`PUBLIC_MAP_ASSET_TYPES.map(getAssetFriendlyColorForAssetType)`** 作第二参数（与上述回退一致，不改业务取色顺序）。
 */
export function getAllAssetSymbolKeysForPrereg(
  configAssetBase: readonly { properties?: unknown }[],
  extraFriendlyTints?: readonly (string | null | undefined)[],
): Array<{
  id: string;
  type: AssetType;
  status: AssetStatus;
  virtual: boolean;
  disposition: ForceDisposition;
  friendlyFill?: string;
}> {
  const tints = uniqueFriendlyTintsFromConfigAssets(configAssetBase, extraFriendlyTints);
  const types = [...PUBLIC_MAP_ASSET_TYPES] as AssetType[];
  const statuses: AssetStatus[] = ["online", "offline", "degraded"];
  const out: Array<{
    id: string;
    type: AssetType;
    status: AssetStatus;
    virtual: boolean;
    disposition: ForceDisposition;
    friendlyFill?: string;
  }> = [];
  for (const type of types) {
    for (const status of statuses) {
      for (const disposition of MAP_FORCE_DISPOSITIONS) {
        for (const virtual of [false, true]) {
          if (disposition !== "friendly") {
            out.push({
              id: getAssetSymbolId(type, status, virtual, disposition),
              type,
              status,
              virtual,
              disposition,
            });
            continue;
          }
          for (const tint of tints) {
            out.push({
              id: getAssetSymbolId(type, status, virtual, "friendly", tint || undefined),
              type,
              status,
              virtual,
              disposition,
              friendlyFill: tint || undefined,
            });
          }
        }
      }
    }
  }
  return out;
}

/* ── 选中目标高亮环（Track selection ring）96x96 SVG ── */

export const TRACK_SELECT_RING_ID = "track-select-ring";

/**
 * 生成目标选中高亮环 SVG：蓝色静态瞄准环。
 *
 * 设计：外层低透明度晕圈 + 内层主环 + 4 个刻度线，风格参考瞄准镜。
 */
export function buildSelectionRingSvg(): string {
  const c = "#60a5fa";
  const s = 96;
  const half = s / 2;
  const rO = 40;
  const rI = 33;
  const tA = half - rO;      // 8  刻度起（外环边缘）
  const tB = tA + 9;         // 17 刻度终（向内 9px）

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">`,
    `<circle cx="${half}" cy="${half}" r="${rO}" fill="none" stroke="${c}" stroke-width="5" opacity="0.1"/>`,
    `<circle cx="${half}" cy="${half}" r="${rI}" fill="none" stroke="${c}" stroke-width="1.8" opacity="0.8"/>`,
    `<line x1="${half}" y1="${tA}" x2="${half}" y2="${tB}" stroke="${c}" stroke-width="2" stroke-linecap="round" opacity="0.85"/>`,
    `<line x1="${half}" y1="${s - tA}" x2="${half}" y2="${s - tB}" stroke="${c}" stroke-width="2" stroke-linecap="round" opacity="0.85"/>`,
    `<line x1="${tA}" y1="${half}" x2="${tB}" y2="${half}" stroke="${c}" stroke-width="2" stroke-linecap="round" opacity="0.85"/>`,
    `<line x1="${s - tA}" y1="${half}" x2="${s - tB}" y2="${half}" stroke="${c}" stroke-width="2" stroke-linecap="round" opacity="0.85"/>`,
    `</svg>`,
  ].join("");
}

export function buildSelectionRingDataUrl(): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildSelectionRingSvg())}`;
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
 * 扇区内「圆环带」多边形：内弧 + 外弧（米→千米传入），与 V2 `createSectorRingGeometry` 一致，供激光/TDOA 径向扫描亮带。
 */
export function geoSectorRingCoords(
  centerLng: number,
  centerLat: number,
  innerRadiusKm: number,
  outerRadiusKm: number,
  headingDeg: number,
  fovDeg: number,
  segments = 24,
): Array<[number, number]> {
  const inner = Math.max(0, innerRadiusKm);
  const outer = Math.max(inner + 1e-6, outerRadiusKm);
  const half = fovDeg / 2;
  const start = headingDeg - half;
  const outerPts: Array<[number, number]> = [];
  const innerPts: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    const ang = start + (i / segments) * fovDeg;
    outerPts.push(offsetPoint(centerLng, centerLat, outer, ang));
  }
  for (let i = segments; i >= 0; i--) {
    const ang = start + (i / segments) * fovDeg;
    innerPts.push(offsetPoint(centerLng, centerLat, inner, ang));
  }
  return [...outerPts, ...innerPts, outerPts[0]!];
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
