/** 调整相邻两段 ratio 数组中 index 与 index+1 的分界（两段之和不变） */
export function adjustAdjacentRatios(
  ratios: number[],
  dividerIndex: number,
  newLeadingRatio: number,
  minRatio: number,
): number[] {
  if (dividerIndex < 0 || dividerIndex >= ratios.length - 1) return ratios;
  const total = ratios[dividerIndex] + ratios[dividerIndex + 1];
  const constrained = Math.max(minRatio, Math.min(total - minRatio, newLeadingRatio));
  const next = [...ratios];
  next[dividerIndex] = constrained;
  next[dividerIndex + 1] = total - constrained;
  return next;
}
