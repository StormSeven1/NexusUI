/** 光电视频呈现：与 CSS `object-fit` 及检测/PTZ 坐标映射一致 */
export type EoVideoObjectFit = "contain" | "cover" | "fill";

/**
 * 构建时读取 `NEXT_PUBLIC_EO_VIDEO_OBJECT_FIT`：
 * - `fill`（默认）：拉伸铺满，与 Qt 光电窗一致
 * - `cover`：等比裁边
 * - `contain`：等比完整 + 黑边
 */
export function resolveEoVideoObjectFit(): EoVideoObjectFit {
  const raw =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_EO_VIDEO_OBJECT_FIT?.trim().toLowerCase() : "";
  if (raw === "contain" || raw === "cover" || raw === "fill") return raw;
  return "fill";
}

export function eoVideoObjectFitToTailwindClass(fit: EoVideoObjectFit): string {
  switch (fit) {
    case "contain":
      return "object-contain";
    case "cover":
      return "object-cover";
    case "fill":
      return "object-fill";
  }
}
