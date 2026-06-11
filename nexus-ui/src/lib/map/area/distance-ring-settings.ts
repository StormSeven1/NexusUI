/**
 * 区域/航线图层样式默认值。
 *
 * 当前主工程只需要最小接口：
 * - 默认边线颜色
 * - 默认边线宽度
 * - 可选样式类型定义
 */

export const DEFAULT_AREA_LAYER_LINE_COLOR = "#22d3ee";
export const DEFAULT_AREA_LAYER_LINE_WIDTH = 2;

export type SituationAreaLayerStyle = {
  lineColor?: string;
  lineOpacity?: number;
  lineWidth?: number;
  lineStyle?: "solid" | "dashed" | "dotted";
  labelOpacity?: number;
};
