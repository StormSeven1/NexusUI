/**
 * 光电视频调试 UI：左上角 WebRTC 状态条（EoVideoViewport）+ 底部「目标跟踪 · 调试」面板（EoVideoTaskTracePanel）。
 *
 * 构建时读取：`NEXT_PUBLIC_EO_VIDEO_DEBUG_UI=false`（或 `0` / `no` / `off`）时不挂载上述区块。
 * 未设置或其它值：保持原有行为（显示）。
 */
export function isEoVideoDebugUiEnabled(): boolean {
  const raw =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_EO_VIDEO_DEBUG_UI != null
      ? String(process.env.NEXT_PUBLIC_EO_VIDEO_DEBUG_UI).trim().toLowerCase()
      : "";
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") return false;
  return true;
}
