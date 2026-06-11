/** 叠层 letterbox 用的 intrinsic：WebCodecs 呈现尺寸优先于 `<video>`（后者常为 0 或与 Canvas 不一致） */
export function resolveEoVideoIntrinsicSize(
  video: Pick<HTMLVideoElement, "videoWidth" | "videoHeight"> | null | undefined,
  fallbackW = 0,
  fallbackH = 0,
): { w: number; h: number } {
  if (fallbackW > 0 && fallbackH > 0) return { w: fallbackW, h: fallbackH };
  const vw = video?.videoWidth ?? 0;
  const vh = video?.videoHeight ?? 0;
  return { w: vw, h: vh };
}

/**
 * 视频内容在容器内的像素矩形，根据 object-fit 模式计算。
 * - contain: 居中缩放，可能有黑边（letterbox）
 * - cover: 居中缩放铺满，可能裁切超出部分
 */
export function getVideoContentRect(
  containerW: number,
  containerH: number,
  intrinsicW: number,
  intrinsicH: number,
  fit: "contain" | "cover" = "cover",
): { x: number; y: number; w: number; h: number } {
  if (containerW <= 0 || containerH <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  if (intrinsicW <= 0 || intrinsicH <= 0) {
    return { x: 0, y: 0, w: containerW, h: containerH };
  }
  const scale =
    fit === "contain"
      ? Math.min(containerW / intrinsicW, containerH / intrinsicH)
      : Math.max(containerW / intrinsicW, containerH / intrinsicH);
  const w = intrinsicW * scale;
  const h = intrinsicH * scale;
  const x = (containerW - w) / 2;
  const y = (containerH - h) / 2;
  return { x, y, w, h };
}
