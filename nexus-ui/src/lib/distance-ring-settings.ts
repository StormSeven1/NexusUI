/** 1 海里 = 1852 米 */
export const NM_TO_METERS = 1852;

export const DISTANCE_RING_MAX_COUNT = 20;

export const DISTANCE_RING_DEFAULT_CENTER_LAT = 37.5453;
export const DISTANCE_RING_DEFAULT_CENTER_LNG = 122.0887;
export const DISTANCE_RING_DEFAULT_RING_COLOR = "#d1d5db";

/** 图层面板「区域图层」（Postgres area_table）默认边线色 */
export const DEFAULT_AREA_LAYER_LINE_COLOR = "#c8d1dd";
export const AREA_LAYER_LINE_WIDTH_MIN = 0.5;
export const AREA_LAYER_LINE_WIDTH_MAX = 8;
export const DEFAULT_AREA_LAYER_LINE_WIDTH = 2;

export type AreaLayerLineStyle = "solid" | "dashed" | "dotted";

export const AREA_LAYER_LINE_STYLE_OPTIONS: { id: AreaLayerLineStyle; label: string }[] = [
  { id: "solid", label: "实线" },
  { id: "dashed", label: "虚线" },
  { id: "dotted", label: "点线" },
];

/** 间距选项：0.5 ~ 10 NM，步长 0.5 */
export const DISTANCE_RING_SPACING_NM_OPTIONS: number[] = Array.from(
  { length: 20 },
  (_, i) => (i + 1) * 0.5,
);

export type SituationAreaLayerStyle = {
  lineColor: string;
  lineOpacity: number;
  labelOpacity: number;
  lineWidth: number;
  lineStyle: AreaLayerLineStyle;
  /** MapLibre `line-dasharray`；实线为 null */
  lineDash: number[] | null;
};

export type DistanceRingSettings = {
  ringCount: number;
  spacingNm: number;
  centerLat: number;
  centerLng: number;
  /** 距离环线条颜色 */
  ringColor: string;
  /** 距离环线条透明度 0–1 */
  ringOpacity: number;
  /** 环上标注文字透明度 0–1（颜色与距离环线条一致） */
  labelOpacity: number;
  /** 区域图层（area_table）边线颜色 */
  areaLineColor: string;
  /** 区域图层边线透明度 0–1 */
  areaLineOpacity: number;
  /** 区域图层名称标注透明度 0–1 */
  areaLabelOpacity: number;
  /** 区域图层边线宽度（像素） */
  areaLineWidth: number;
  /** 区域图层边线线型 */
  areaLineStyle: AreaLayerLineStyle;
};

export const DEFAULT_DISTANCE_RING_SETTINGS: DistanceRingSettings = {
  ringCount: 5,
  spacingNm: 1,
  centerLat: DISTANCE_RING_DEFAULT_CENTER_LAT,
  centerLng: DISTANCE_RING_DEFAULT_CENTER_LNG,
  ringColor: DISTANCE_RING_DEFAULT_RING_COLOR,
  ringOpacity: 0.5,
  labelOpacity: 1,
  areaLineColor: DEFAULT_AREA_LAYER_LINE_COLOR,
  areaLineOpacity: 1,
  areaLabelOpacity: 0.95,
  areaLineWidth: DEFAULT_AREA_LAYER_LINE_WIDTH,
  areaLineStyle: "solid",
};

export function clampRingCount(n: number): number {
  return Math.min(DISTANCE_RING_MAX_COUNT, Math.max(1, Math.round(n)));
}

export function coerceSpacingNm(v: number): number {
  const nearest = DISTANCE_RING_SPACING_NM_OPTIONS.reduce((best, opt) =>
    Math.abs(opt - v) < Math.abs(best - v) ? opt : best,
  );
  return nearest;
}

export function clampOpacity(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

export function clampAreaLineWidth(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_AREA_LAYER_LINE_WIDTH;
  return Math.min(AREA_LAYER_LINE_WIDTH_MAX, Math.max(AREA_LAYER_LINE_WIDTH_MIN, v));
}

export function coerceAreaLineStyle(v: unknown): AreaLayerLineStyle {
  if (v === "dashed" || v === "dotted" || v === "solid") return v;
  return "solid";
}

/** MapLibre 线型 → dasharray；实线返回 null（图层不设置 dash） */
export function areaLineDashFromStyle(style: AreaLayerLineStyle): number[] | null {
  if (style === "dashed") return [8, 4];
  if (style === "dotted") return [1, 3];
  return null;
}

export function formatRingLabelNm(nm: number): string {
  return Number.isInteger(nm) ? `${nm} NM` : `${nm.toFixed(1)} NM`;
}

export function pickDistanceRingSettings(
  s: Partial<DistanceRingSettings> & { color?: string; regionColor?: string; regionOpacity?: number },
): DistanceRingSettings {
  return normalizeDistanceRingSettings(s);
}

export function pickSituationAreaLayerStyle(
  s: Partial<DistanceRingSettings> & { regionColor?: string; regionOpacity?: number },
): SituationAreaLayerStyle {
  const full = normalizeDistanceRingSettings(s);
  return {
    lineColor: full.areaLineColor,
    lineOpacity: full.areaLineOpacity,
    labelOpacity: full.areaLabelOpacity,
    lineWidth: full.areaLineWidth,
    lineStyle: full.areaLineStyle,
    lineDash: areaLineDashFromStyle(full.areaLineStyle),
  };
}

export function normalizeDistanceRingSettings(
  raw: Partial<DistanceRingSettings> & {
    color?: string;
    regionColor?: string;
    regionOpacity?: number;
  },
  fallback: DistanceRingSettings = DEFAULT_DISTANCE_RING_SETTINGS,
): DistanceRingSettings {
  const ringColor =
    typeof raw.ringColor === "string" && raw.ringColor.trim()
      ? raw.ringColor.trim()
      : typeof raw.color === "string" && raw.color.trim()
        ? raw.color.trim()
        : fallback.ringColor;
  const areaLineColor =
    typeof raw.areaLineColor === "string" && raw.areaLineColor.trim()
      ? raw.areaLineColor.trim()
      : typeof raw.regionColor === "string" && raw.regionColor.trim()
        ? raw.regionColor.trim()
        : fallback.areaLineColor;
  return {
    ringCount: clampRingCount(raw.ringCount ?? fallback.ringCount),
    spacingNm: coerceSpacingNm(raw.spacingNm ?? fallback.spacingNm),
    centerLat: Number.isFinite(raw.centerLat) ? raw.centerLat! : fallback.centerLat,
    centerLng: Number.isFinite(raw.centerLng) ? raw.centerLng! : fallback.centerLng,
    ringColor,
    ringOpacity: clampOpacity(raw.ringOpacity ?? fallback.ringOpacity),
    labelOpacity: clampOpacity(raw.labelOpacity ?? fallback.labelOpacity),
    areaLineColor,
    areaLineOpacity: clampOpacity(
      raw.areaLineOpacity ?? raw.regionOpacity ?? fallback.areaLineOpacity,
    ),
    areaLabelOpacity: clampOpacity(raw.areaLabelOpacity ?? fallback.areaLabelOpacity),
    areaLineWidth: clampAreaLineWidth(raw.areaLineWidth ?? fallback.areaLineWidth),
    areaLineStyle: coerceAreaLineStyle(raw.areaLineStyle ?? fallback.areaLineStyle),
  };
}
