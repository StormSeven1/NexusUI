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

/** 中立融合航迹符号 id 后缀（与友方 `-mf` 区分） */
export function neutralFusionFillSuffix(tint: string | null | undefined): string {
  const s = String(tint ?? "").trim();
  if (!s) return "";
  const safe = s.replace(/[^#a-zA-Z0-9]/g, "").slice(0, 28);
  return safe ? `-nf${safe}` : "";
}

/** 资产图标、激光/TDOA 扇区中心图标共用的敌我维度 */
export const MAP_FORCE_DISPOSITIONS: ForceDisposition[] = ["friendly", "hostile", "neutral"];

/* ── 目标航迹图标：使用 public/icons/ 中的 SVG 资源，viewBox 自动缩放至渲染尺寸 ── */

type TrackIconDef = { viewBox: string; pathD: string };

const TRACK_SVG_ICONS: Record<TrackType, TrackIconDef> = {
  // 来自 public/icons/空中目标.svg（viewBox 0 0 1024 1024）
  air: {
    viewBox: "0 0 1024 1024",
    pathD: "M950.208 208.64c16-48.128 12.8-89.888-12.8-118.784l-3.2-3.2c-28.8-25.696-70.368-28.896-118.368-12.832-41.6 12.832-80 38.528-115.168 70.624l-83.2 83.488L240 138.016c-16-3.2-35.2 0-48 12.864L115.2 227.936c-9.6 9.6-16 25.696-12.8 44.96 3.2 16.032 12.8 28.896 25.6 35.296l265.568 144.512-112 112.352-95.968-25.664c-6.4-3.2-12.8-3.2-16-3.2-12.8 0-25.6 6.4-35.2 16.032l-54.4 57.792C67.2 619.648 64 635.712 64 648.544c0 16.064 9.6 28.896 19.2 35.328l147.168 109.152 108.8 147.712c9.6 12.832 22.4 19.264 35.2 19.264h3.168c12.8 0 25.6-6.4 35.2-16.064l57.6-57.792c12.8-12.832 19.2-32.096 12.8-48.16l-25.6-96.32 111.968-112.384 143.968 266.496c9.6 16.064 22.4 22.496 32 25.696 6.4 3.2 9.6 3.2 12.8 3.2 12.8 0 22.4-3.2 32-9.6l76.768-57.824c16-12.832 22.4-32.096 19.2-51.36l-89.6-398.144 83.2-83.488c32-32.096 57.6-70.624 70.4-115.584z m-224.896 180.8l97.376 425.92-58.432 41.92-181.76-329.12-201.28 200.064 35.68 125.824L377.952 896l-103.872-138.752L128 647.552l42.208-41.92 126.592 35.456 201.28-200.032-334.4-180.704 58.464-58.08 412.256 96.8 110.4-106.464c25.92-25.824 58.4-45.184 90.88-58.08 35.712-12.896 48.672-3.232 55.168 0 3.264 6.432 9.76 19.36 0 54.848a197.76 197.76 0 0 1-58.432 90.336l-107.104 109.696z",
  },
  // 来自 public/icons/水面目标.svg（viewBox 0 0 1024 1024）
  sea: {
    viewBox: "0 0 1024 1024",
    pathD: "M625.777778 284.444444v56.888889h28.444444a56.888889 56.888889 0 0 1 56.888889 56.888889v102.769778l57.144889 18.688a56.888889 56.888889 0 0 1 35.527111 74.24l-52.622222 138.951111c21.020444-5.745778 36.778667-12.828444 44.856889-17.720889a28.444444 28.444444 0 0 1 29.297778 48.810667c-28.444444 17.066667-102.286222 44.657778-189.326223 32.199111a589.368889 589.368889 0 0 1-30.634666-5.347556c-23.210667-4.494222-44.373333-8.590222-93.354667-8.590222-48.952889 0-70.144 4.096-93.354667 8.590222a589.368889 589.368889 0 0 1-30.606222 5.347556c-87.04 12.430222-160.881778-15.132444-189.326222-32.199111a28.444444 28.444444 0 0 1 29.269333-48.810667c8.106667 4.892444 23.836444 11.975111 44.885334 17.720889l-52.622223-138.979555a56.888889 56.888889 0 0 1 35.498667-74.24L312.888889 501.020444V398.222222a56.888889 56.888889 0 0 1 56.888889-56.888889h28.444444v-56.888889a56.888889 56.888889 0 0 1 56.888889-56.888888h113.777778a56.888889 56.888889 0 0 1 56.888889 56.888888z m-170.666667 0v56.888889h113.777778v-56.888889h-113.777778z m-85.333333 197.973334l49.834666-16.298667-1.137777-0.369778 30.464-9.187555 16.952889-5.546667c2.702222-0.853333 5.404444-1.536 8.106666-1.991111l19.911111-6.030222a56.149333 56.149333 0 0 1 36.209778 0l19.854222 6.001778c2.702222 0.483556 5.404444 1.137778 8.135111 2.019555l16.952889 5.546667 2.816 0.853333-0.085333 0.028445L654.222222 482.417778V398.222222H369.777778v84.195556z m113.777778 22.670222l-210.147556 68.664889 63.857778 168.561778a256.568889 256.568889 0 0 0 42.723555-2.474667c8.732444-1.251556 16.839111-2.816 25.315556-4.465778A461.852444 461.852444 0 0 1 483.555556 725.902222v-220.785778z m267.036444 68.664889L540.444444 505.088v220.785778c36.693333 1.450667 58.481778 5.688889 78.279112 9.500444 8.448 1.649778 16.554667 3.214222 25.315555 4.465778 14.791111 2.104889 29.098667 2.816 42.666667 2.474667l63.886222-168.561778z",
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
  neutralFusionFill?: string | null,
): string {
  const base = `track-${type}-${disposition}-${virtual ? "v" : "r"}`;
  if (disposition === "friendly") {
    const suf = friendlyTintSuffix(friendlyTint);
    return suf ? `${base}${suf}` : base;
  }
  if (disposition === "neutral") {
    const suf = neutralFusionFillSuffix(neutralFusionFill);
    return suf ? `${base}${suf}` : base;
  }
  return base;
}

/** 融合航迹中立态配色：对海/水下白、对空浅紫、对空无人机黄 */
export const FUSION_TRACK_NEUTRAL_SEA = "#ffffff";
export const FUSION_TRACK_NEUTRAL_AIR = "#d8b4fe";
export const FUSION_TRACK_NEUTRAL_UAV = "#facc15";

export function getFusionTrackMarkerFill(track: Pick<Track, "type" | "isUav">): string {
  if (track.type === "sea" || track.type === "underwater") return FUSION_TRACK_NEUTRAL_SEA;
  if (track.type === "air") {
    return track.isUav === true ? FUSION_TRACK_NEUTRAL_UAV : FUSION_TRACK_NEUTRAL_AIR;
  }
  return FORCE_COLORS.neutral;
}

/** 航迹点/线/标签颜色：中立用融合配色；其余同 `resolveTrackMarkerFill` */
export function resolveTrackPointFill(
  track: Pick<Track, "type" | "isUav">,
  disposition: ForceDisposition,
  accent?: AssetDispositionIconAccent | null,
  friendlyFill?: string | null,
): string {
  if (disposition === "neutral") return getFusionTrackMarkerFill(track);
  return resolveTrackMarkerFill(disposition, accent ?? null, friendlyFill);
}

/** 航迹点/线填色：敌/中读 `factory.assetIcons`；我方读 `trackRendering.trackTypeStyles.*.idColor`（由调用方传入） */
export function resolveTrackMarkerFill(
  disposition: ForceDisposition,
  accent?: AssetDispositionIconAccent | null,
  friendlyFill?: string | null,
): string {
  if (disposition === "hostile") return accent?.hostileIcon ?? FORCE_COLORS.hostile;
  if (disposition === "neutral") return accent?.neutralIcon ?? FORCE_COLORS.neutral;
  const o = friendlyFill?.trim();
  if (o) return o;
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
  neutralFusionFill?: string | null,
): string {
  const color =
    disposition === "neutral" && neutralFusionFill?.trim()
      ? neutralFusionFill.trim()
      : resolveTrackMarkerFill(disposition, accent ?? null, friendlyFill);
  const icon = TRACK_SVG_ICONS[type];
  const virtualFrame =
    virtual
      ? `<rect x="1" y="1" width="62" height="62" rx="10" fill="none" stroke="${color}" stroke-width="1.8" stroke-dasharray="5 4" opacity="0.92"/>`
      : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">`,
    `<defs>`,
    `<filter id="sh" x="-25%" y="-25%" width="150%" height="150%">`,
    `<feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#000" flood-opacity="0.85"/>`,
    `</filter>`,
    `</defs>`,
    virtualFrame,
    `<svg x="4" y="6" width="56" height="54" viewBox="${icon.viewBox}" filter="url(#sh)">`,
    `<path d="${icon.pathD}" fill="${color}"/>`,
    `</svg>`,
    `<path d="M32 2 L32 7" stroke="${color}" stroke-width="2.2" stroke-linecap="round" opacity="0.9"/>`,
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
  neutralFusionFill?: string | null,
): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildMarkerSymbolSvg(type, disposition, accent ?? null, virtual, friendlyFill, neutralFusionFill))}`;
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
};

/** 友方航迹符号：为每种 `trackTypeStyles.*.idColor` 预注册一套 tint（另含无 tint 的默认友方色） */
export function getAllMarkerSymbolKeysForPrereg(trackRendering: TrackStylesForPrereg | null): Array<{
  id: string;
  type: TrackType;
  disposition: ForceDisposition;
  virtual: boolean;
  friendlyFill?: string;
  neutralFusionFill?: string;
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
  const tintList = [...friendlyTints];
  const out: Array<{
    id: string;
    type: TrackType;
    disposition: ForceDisposition;
    virtual: boolean;
    friendlyFill?: string;
    neutralFusionFill?: string;
  }> = [];
  for (const type of types) {
    for (const disposition of dispositions) {
      for (const virtual of [false, true]) {
        if (disposition !== "friendly") {
          if (disposition === "neutral") {
            const fills =
              type === "air"
                ? [FUSION_TRACK_NEUTRAL_AIR, FUSION_TRACK_NEUTRAL_UAV]
                : [FUSION_TRACK_NEUTRAL_SEA];
            for (const fill of fills) {
              out.push({
                id: getMarkerSymbolId(type, disposition, virtual, undefined, fill),
                type,
                disposition,
                virtual,
                neutralFusionFill: fill,
              });
            }
          } else {
            out.push({
              id: getMarkerSymbolId(type, disposition, virtual),
              type,
              disposition,
              virtual,
            });
          }
          continue;
        }
        for (const tint of tintList) {
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

const ASSET_STATUS_COLORS: Record<AssetStatus, string> = {
  online: "#34d399",
  offline: "#f87171",
  degraded: "#fbbf24",
};

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
  radar: "雷达.svg",
  camera: "光电.svg",
  tower: "电侦.svg",
  laser: "激光.svg",
  tdoa: "TDOA.svg",
  airport: "无人机机场.svg",
  drone: "无人机.svg",
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

const publicAssetFragmentCache = new Map<AssetType, { viewBox: string; body: string }>();
const publicAssetFragmentInflight = new Map<AssetType, Promise<{ viewBox: string; body: string }>>();

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

const DRONE_TRIANGLE_CANVAS_PX = 72;

/** V2 `DroneRenderer.loadDroneIcon`：向上三角 + 白描边，虚兵为虚线描边 */
export function buildDroneTriangleDataUrl(fillColor: string, dashedStroke: boolean): string {
  const size = DRONE_TRIANGLE_CANVAS_PX;
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
  ctx.lineWidth = dashedStroke ? 2.5 : 2;
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
export async function fetchPublicMapAssetFragment(type: AssetType): Promise<{ viewBox: string; body: string }> {
  const hit = publicAssetFragmentCache.get(type);
  if (hit) return hit;
  let inflight = publicAssetFragmentInflight.get(type);
  if (!inflight) {
    inflight = (async () => {
      const url = publicIconFileUrl(PUBLIC_MAP_SVG_FILES[type]);
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`[map-icons] 无法加载资产图标：${url}（HTTP ${res.status}）`);
      }
      const text = await res.text();
      const parsed = extractSvgInnerForMapAsset(text);
      publicAssetFragmentCache.set(type, parsed);
      return parsed;
    })();
    publicAssetFragmentInflight.set(type, inflight);
    void inflight.finally(() => {
      publicAssetFragmentInflight.delete(type);
    });
  }
  return inflight;
}

/** 预加载 `public/icons` 片段；`generated` 无人机不请求 `无人机.svg` */
export async function preloadPublicMapAssetFragments(types?: readonly AssetType[]): Promise<void> {
  const list = (types ?? [...PUBLIC_MAP_ASSET_TYPES]).filter(
    (t) => !(t === "drone" && DRONE_MAP_ICON_SOURCE === "generated"),
  );
  await Promise.all(list.map((t) => fetchPublicMapAssetFragment(t)));
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

function tintPublicAssetIconInner(inner: string, color: string, type: AssetType): string {
  let s = inner
    .replace(/fill="#D1D7DD"/gi, `fill="${color}"`)
    .replace(/fill='#D1D7DD'/gi, `fill="${color}"`)
    .replace(/fill="#ffffff"/gi, `fill="${color}"`)
    .replace(/fill='#ffffff'/gi, `fill="${color}"`)
    .replace(/fill="#fff"/gi, `fill="${color}"`)
    .replace(/fill='#fff'/gi, `fill="${color}"`);
  if (type === "tower") {
    s = s.replace(/fill:\s*#d1d7dd/gi, `fill: ${color}`);
  }
  return s;
}

/** 与资产图层相同的 56×56 圆角底板 + 投影（内层已着色 SVG 片段） */
function buildFramedGlyphSvgString(
  viewBox: string,
  tintedInnerSvg: string,
  frameColor: string,
  virtual: boolean,
  pad: number,
): string {
  const frameStrokeAttrs = virtual
    ? `stroke="${frameColor}" stroke-width="2" stroke-dasharray="4 3"`
    : `stroke="${frameColor}" stroke-width="2"`;
  const inner = 56 - pad * 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">`,
    `<defs>`,
    `<filter id="ag" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="0" stdDeviation="1.5" flood-color="${frameColor}" flood-opacity="0.5"/></filter>`,
    `</defs>`,
    `<rect x="3" y="3" width="50" height="50" rx="7" fill="rgba(9,9,11,0.9)" ${frameStrokeAttrs} filter="url(#ag)"/>`,
    `<svg x="${pad}" y="${pad}" width="${inner}" height="${inner}" viewBox="${viewBox}">`,
    tintedInnerSvg,
    `</svg>`,
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
    buildFramedGlyphSvgString(viewBox, tinted, frameColor, virtual, pad),
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

/** 将 `public/icons` 内图标体包进与原先一致的 56×56 资产底板（状态色描边 + 投影） */
export function buildAssetWrappedSvgFromPublicBody(
  viewBox: string,
  iconInner: string,
  type: AssetType,
  status: AssetStatus,
  virtual: boolean,
  disposition: ForceDisposition = "friendly",
  accent?: AssetDispositionIconAccent | null,
  friendlyOverride?: string | null,
): string {
  const color = resolveAssetIconAccentFill(disposition, status, accent, friendlyOverride);
  const pad = type === "camera" ? 12 : 8;
  const tinted = tintPublicAssetIconInner(iconInner, color, type);
  return buildFramedGlyphSvgString(viewBox, tinted, color, virtual, pad);
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
): Promise<string> {
  if (type === "drone" && DRONE_MAP_ICON_SOURCE === "generated") {
    throw new Error("[map-icons] drone 为 generated 模式，请使用 buildAssetSymbolDataUrl");
  }
  const fr = await fetchPublicMapAssetFragment(type);
  return buildAssetWrappedSvgFromPublicBody(fr.viewBox, fr.body, type, status, virtual, disposition, accent, friendlyOverride);
}

export async function buildAssetSymbolDataUrl(
  type: AssetType,
  status: AssetStatus,
  virtual = false,
  disposition: ForceDisposition = "friendly",
  accent?: AssetDispositionIconAccent | null,
  friendlyOverride?: string | null,
): Promise<string> {
  if (type === "drone" && DRONE_MAP_ICON_SOURCE === "generated") {
    const fill = resolveAssetIconAccentFill(disposition, status, accent ?? null, friendlyOverride ?? null);
    return buildDroneTriangleDataUrl(fill, virtual);
  }
  const svg = await buildAssetSymbolSvg(type, status, virtual, disposition, accent, friendlyOverride);
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
