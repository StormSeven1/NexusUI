import type { EoDetectionBox } from "@/lib/eo-video/types";
import { mapEoBoxToPresentationNorm } from "@/lib/eo-video/detectionSyncUtils";
import { getVideoContentRect, resolveEoVideoIntrinsicSize } from "@/lib/eo-video/videoContentRect";

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export type EoDetectionHitResult = {
  normalizedX: number;
  normalizedY: number;
  hitBoxId: string | null;
  hitBox: EoDetectionBox | null;
};

/** 与 `EoDetectionOverlay::resolveHit` 一致，供无人机穿透双击等场景复用 */
export function resolveEoDetectionHitAtClient(args: {
  container: HTMLElement;
  video: HTMLVideoElement | null;
  boxes: EoDetectionBox[];
  videoObjectFit?: "contain" | "cover";
  videoIntrinsicWidth?: number;
  videoIntrinsicHeight?: number;
  clientX: number;
  clientY: number;
}): EoDetectionHitResult | null {
  const rect = args.container.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const px = args.clientX - rect.left;
  const py = args.clientY - rect.top;
  const { w: vw, h: vh } = resolveEoVideoIntrinsicSize(
    args.video,
    args.videoIntrinsicWidth,
    args.videoIntrinsicHeight,
  );
  const content = getVideoContentRect(rect.width, rect.height, vw, vh, args.videoObjectFit ?? "cover");
  const pad = 10;
  let hitBoxId: string | null = null;
  let hitBox: EoDetectionBox | null = null;
  const tryHit = (b: EoDetectionBox) => {
    const norm = mapEoBoxToPresentationNorm(b, vw, vh);
    const bx = content.x + norm.x * content.w;
    const by = content.y + norm.y * content.h;
    const bw = norm.w * content.w;
    const bh = norm.h * content.h;
    return px >= bx - pad && px <= bx + bw + pad && py >= by - pad && py <= by + bh + pad;
  };
  for (let i = args.boxes.length - 1; i >= 0; i--) {
    const b = args.boxes[i]!;
    if (b.variant === "singleTrack") continue;
    if (tryHit(b)) {
      hitBoxId = b.id;
      hitBox = b;
      break;
    }
  }
  if (!hitBox) {
    for (let i = args.boxes.length - 1; i >= 0; i--) {
      const b = args.boxes[i]!;
      if (tryHit(b)) {
        hitBoxId = b.id;
        hitBox = b;
        break;
      }
    }
  }
  const nx = content.w > 0 ? (px - content.x) / content.w : 0;
  const ny = content.h > 0 ? (py - content.y) / content.h : 0;
  return {
    normalizedX: clamp01(nx),
    normalizedY: clamp01(ny),
    hitBoxId,
    hitBox,
  };
}
