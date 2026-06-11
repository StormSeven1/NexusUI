export function getVideoContentRect(
  containerW: number,
  containerH: number,
  intrinsicW: number,
  intrinsicH: number,
  fit: "contain" | "cover" | "fill" = "cover",
): { x: number; y: number; w: number; h: number } {
  if (containerW <= 0 || containerH <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  if (fit === "fill") return { x: 0, y: 0, w: containerW, h: containerH };
  if (intrinsicW <= 0 || intrinsicH <= 0) return { x: 0, y: 0, w: containerW, h: containerH };
  const scale =
    fit === "contain"
      ? Math.min(containerW / intrinsicW, containerH / intrinsicH)
      : Math.max(containerW / intrinsicW, containerH / intrinsicH);
  const w = intrinsicW * scale;
  const h = intrinsicH * scale;
  return {
    x: (containerW - w) / 2,
    y: (containerH - h) / 2,
    w,
    h,
  };
}
