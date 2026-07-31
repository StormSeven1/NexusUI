import type { PanelId } from "@/components/dock/types";

/** 工作区布局模式：自由 dock / 经典固定布局 */
export type WorkspaceLayoutMode = "free" | "classic";

/** 经典布局内各区域高度/宽度比例（0–1） */
export interface ClassicSplitRatios {
  /** 右侧栏光电区占右侧列高度 */
  eoAreaRatio: number;
  /** 光电区内主窗口占宽度 */
  eoMainRatio: number;
  /** 信息区目标档案占宽度 */
  infoLeftRatio: number;
  /** 右侧三个小光电窗口高度占比（和为 1） */
  eoSubRatios: [number, number, number];
}

export const DEFAULT_CLASSIC_SPLIT_RATIOS: ClassicSplitRatios = {
  eoAreaRatio: 0.5,
  eoMainRatio: 0.62,
  infoLeftRatio: 0.48,
  eoSubRatios: [1 / 3, 1 / 3, 1 / 3],
};

export const CLASSIC_MAIN_EO_PANEL_ID = "electro-optical-1" as PanelId;

export const CLASSIC_SUB_EO_PANEL_IDS: PanelId[] = [
  "electro-optical-2",
  "electro-optical-3",
  "electro-optical-4",
];

/** 经典布局：右侧小窗是否属于可「设为主屏」的副光电位 */
export function isClassicSubEoPanelId(panelId: string | undefined | null): boolean {
  const id = (panelId ?? "").trim();
  return CLASSIC_SUB_EO_PANEL_IDS.some((p) => p === id);
}

export const MIN_CLASSIC_RATIO = 0.12;

/** 经典布局右侧栏最小宽度（像素） */
export const CLASSIC_RIGHT_MIN_WIDTH = 360;

/** 经典布局：右侧栏默认占「地图+右侧」行的宽度比例（态势 vs 光电信息区各一半） */
export const CLASSIC_RIGHT_DEFAULT_ROW_RATIO = 0.5;

/** 经典布局：右侧栏最多占该行宽度比例（向左拖至中间） */
export const CLASSIC_RIGHT_MAX_ROW_RATIO = 0.5;

export function clampClassicRightRowRatio(ratio: number): number {
  const minRatio = CLASSIC_RIGHT_MIN_WIDTH / 4000;
  return Math.max(minRatio, Math.min(CLASSIC_RIGHT_MAX_ROW_RATIO, ratio));
}

/** 根据工作区行宽与比例计算右侧栏像素宽 */
export function classicRightWidthFromRow(
  rowWidth: number,
  ratio = CLASSIC_RIGHT_DEFAULT_ROW_RATIO,
): number {
  if (rowWidth <= 0) return CLASSIC_RIGHT_MIN_WIDTH;
  const clampedRatio = clampClassicRightRowRatio(ratio);
  const byRatio = Math.floor(rowWidth * clampedRatio);
  const maxAllowed = Math.floor(rowWidth * CLASSIC_RIGHT_MAX_ROW_RATIO);
  return Math.max(CLASSIC_RIGHT_MIN_WIDTH, Math.min(maxAllowed, byRatio));
}

/** 像素宽 → 行内比例 */
export function classicRightRowRatioFromWidth(rowWidth: number, width: number): number {
  if (rowWidth <= 0) return CLASSIC_RIGHT_DEFAULT_ROW_RATIO;
  return clampClassicRightRowRatio(width / rowWidth);
}

export function clampClassicRightWidth(width: number, rowWidth?: number): number {
  const rw = rowWidth ?? (typeof window !== "undefined" ? window.innerWidth : 1920);
  const maxAllowed = Math.floor(rw * CLASSIC_RIGHT_MAX_ROW_RATIO);
  return Math.max(CLASSIC_RIGHT_MIN_WIDTH, Math.min(maxAllowed, Math.round(width)));
}

/** @deprecated 使用 classicRightWidthFromRow */
export function classicRightMaxWidth(rowWidth = typeof window !== "undefined" ? window.innerWidth : 1920): number {
  return classicRightWidthFromRow(rowWidth, CLASSIC_RIGHT_MAX_ROW_RATIO);
}

/** @deprecated 使用 classicRightWidthFromRow */
export function classicRightDefaultWidth(rowWidth = typeof window !== "undefined" ? window.innerWidth : 1920): number {
  return classicRightWidthFromRow(rowWidth, CLASSIC_RIGHT_DEFAULT_ROW_RATIO);
}
