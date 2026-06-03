import { isEoVideoWebCodecsCanvasEnabled } from "@/lib/eo-video/eoVideoWebCodecsCanvas";

/**
 * WebRTC 编码帧是否继续送入 `<video>` 硬件解码（Insertable Streams writable passthrough + srcObject）。
 *
 * `NEXT_PUBLIC_EO_VIDEO_HARDWARE_PASSTHROUGH=false`：仅消费 readable 环写 hub/WebCodecs，不 passthrough；
 * 需同时 `NEXT_PUBLIC_EO_VIDEO_WEBCODECS_CANVAS=true`，否则无画面。
 */
export function isEoVideoHardwarePassthroughEnabled(): boolean {
  const raw =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_EO_VIDEO_HARDWARE_PASSTHROUGH != null
      ? String(process.env.NEXT_PUBLIC_EO_VIDEO_HARDWARE_PASSTHROUGH).trim().toLowerCase()
      : "";
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") return false;
  return true;
}

/** 当前配置下是否应切断 hidden video 解码（WebCodecs 主画面 + 显式关闭 passthrough） */
export function shouldCutEoVideoHardwarePassthrough(hasWebCodecsEncodedPath: boolean): boolean {
  return hasWebCodecsEncodedPath && isEoVideoWebCodecsCanvasEnabled() && !isEoVideoHardwarePassthroughEnabled();
}
