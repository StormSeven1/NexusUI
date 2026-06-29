/**
 * WebCodecs + Canvas 主画面：`NEXT_PUBLIC_EO_VIDEO_WEBCODECS_CANVAS=true`（或 `1` / `yes` / `on`）时启用。
 * 需同时存在 Insertable Streams（`encodedSyncHub`）；否则仍走纯 `<video>` 硬件解码。
 */
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
  /** WebCodecs 已上屏最新 RTP timestamp；检测对齐优先于 hub 固定 lag */
  lastRenderedRtpTimestamp: number;
};
