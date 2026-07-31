/**
 * 航迹报告摘要图条目：支持百分比 / 次数 / 误差量纲。
 */

export type TrackChartValueFormat = "percent" | "count" | "number";

export type TrackChartItem = {
  label: string;
  value: number | null;
  format?: TrackChartValueFormat;
  /** number/count 时的单位，如 "次"、" m"、"°" */
  unit?: string;
  digits?: number;
};

export function formatTrackChartValue(item: {
  value: number;
  format?: TrackChartValueFormat;
  unit?: string;
  digits?: number;
}): string {
  const format = item.format ?? "percent";
  const digits = item.digits ?? (format === "percent" ? 1 : 2);
  if (format === "percent") return `${(item.value * 100).toFixed(digits)}%`;
  const unit = item.unit ?? (format === "count" ? " 次" : "");
  return `${item.value.toFixed(digits)}${unit}`;
}

export function trackChartBarRatio(
  item: { value: number; format?: TrackChartValueFormat },
  maxAbs: number,
): number {
  const format = item.format ?? "percent";
  if (format === "percent") return Math.max(0, Math.min(1, item.value));
  if (maxAbs <= 0) return 0;
  return Math.max(0, Math.min(1, Math.abs(item.value) / maxAbs));
}
