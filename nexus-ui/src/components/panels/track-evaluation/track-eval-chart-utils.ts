export const CHART_WIDTH = 420;
export const CHART_HEIGHT = 220;
export const CHART_PADDING = 44;

export function chartX(
  index: number,
  count: number,
  width = CHART_WIDTH,
  pad = CHART_PADDING,
): number {
  if (count <= 1) return pad + (width - pad * 2) / 2;
  return pad + ((width - pad * 2) * index) / (count - 1);
}

export function chartY(
  value: number,
  min: number,
  max: number,
  height = CHART_HEIGHT,
  pad = CHART_PADDING,
): number {
  const range = max - min || 1;
  const ratio = (value - min) / range;
  return pad + (height - pad * 2) * (1 - ratio);
}

export function buildLinearYAxisLabels(
  min: number,
  max: number,
  steps = 4,
): { value: number; ratio: number }[] {
  if (steps <= 0) return [{ value: min, ratio: 0 }];
  const range = max - min || 1;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const ratio = i / steps;
    return { value: min + range * ratio, ratio };
  });
}

export function rateClass(value: number): "high" | "medium" | "low" {
  if (value >= 0.8) return "high";
  if (value >= 0.6) return "medium";
  return "low";
}

export const RATE_CLASS_COLORS = {
  high: "text-emerald-400 bg-emerald-500/10",
  medium: "text-amber-400 bg-amber-500/10",
  low: "text-red-400 bg-red-500/10",
} as const;
