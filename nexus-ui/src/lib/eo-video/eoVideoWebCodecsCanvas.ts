export function isEoVideoWebCodecsCanvasEnabled(): boolean {
  const raw =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_EO_VIDEO_WEBCODECS_CANVAS != null
      ? String(process.env.NEXT_PUBLIC_EO_VIDEO_WEBCODECS_CANVAS).trim().toLowerCase()
      : "";
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

export type EoWebCodecsPresentation = {
  active: boolean;
  width: number;
  height: number;
  canvas: HTMLCanvasElement | null;
};
