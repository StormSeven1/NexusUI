/**
 * 光电实体 id 规范化（WebSocket、静态 `cameras.devices`、地图资产 store 共用）。
 * 与是否加载 eo_video / 视频墙 UI 无关。
 */
export function canonicalEntityId(id: string | number | null | undefined): string {
  if (id == null || id === "") return "";
  if (typeof id === "number" && Number.isFinite(id)) {
    const n = Math.trunc(id);
    if (n < 0) return "";
    return `camera_${n.toString().padStart(3, "0")}`;
  }
  const t = String(id).trim();
  if (!t) return "";
  const m = t.match(/^camera_?(\d+)$/i);
  if (m) return `camera_${parseInt(m[1], 10).toString().padStart(3, "0")}`;
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    if (Number.isFinite(n) && n >= 0) return `camera_${n.toString().padStart(3, "0")}`;
  }
  return t;
}

/**
 * 从流/通道 id 解析相机实体（如 `camera_004_zlm` → `camera_004`），供检测订阅等使用。
 */
export function parseCameraEntityIdFromStreamId(streamId: string): string {
  const t = String(streamId ?? "").trim();
  if (!t) return "";
  const m = t.match(/^camera_(\d+)/i);
  if (m) return canonicalEntityId(`camera_${m[1]}`);
  const m2 = t.match(/^camera-(\d+)/i);
  if (m2) return canonicalEntityId(`camera_${m2[1]}`);
  return "";
}
