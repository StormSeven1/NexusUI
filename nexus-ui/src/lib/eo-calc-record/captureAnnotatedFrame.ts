import type { EoDetectionBox } from "@/lib/eo-video/types";
import { captureEoPlaybackToPngBlob } from "@/lib/eo-video/eoVideoCapture";
import type { CalcRecordRectPx } from "@/lib/eo-calc-record/buildRecordLine";

export function pickSingleTrackRect(
  boxes: readonly EoDetectionBox[],
  presentationW: number,
  presentationH: number,
): CalcRecordRectPx | null {
  const single = boxes.find((b) => b.variant === "singleTrack");
  if (!single) return null;
  const fw = (single.frameWidth ?? 0) > 0 ? single.frameWidth! : presentationW;
  const fh = (single.frameHeight ?? 0) > 0 ? single.frameHeight! : presentationH;
  if (fw <= 0 || fh <= 0) return null;
  return {
    x: single.x * fw,
    y: single.y * fh,
    width: single.w * fw,
    height: single.h * fh,
  };
}

export async function captureAnnotatedJpegBlob(opts: {
  video: HTMLVideoElement | null;
  snapshotCanvas: HTMLCanvasElement | null;
  rect: CalcRecordRectPx | null;
}): Promise<Blob | null> {
  const { video, snapshotCanvas, rect } = opts;
  if (!video) return null;
  try {
    const png = await captureEoPlaybackToPngBlob(video, snapshotCanvas);
    const bmp = await createImageBitmap(png);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    if (rect && rect.width > 0 && rect.height > 0) {
      ctx.strokeStyle = "rgb(147, 253, 255)";
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
    bmp.close();
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92);
    });
  } catch {
    return null;
  }
}
