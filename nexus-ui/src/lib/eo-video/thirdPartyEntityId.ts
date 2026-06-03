/** 第三方相机 entityId：8090 / 0x1001 多为 `camera-hs-001`，二进制头偶为 `camera_hs_001` */
export function normThirdPartyEntityId(s: string | undefined): string {
  const i = (s ?? "").indexOf("\0");
  const t = i >= 0 ? (s ?? "").slice(0, i) : (s ?? "");
  return t.trim().toLowerCase().replace(/_/g, "-");
}

/** 标准光电 `camera_001` / `camera-001`（三位数字后缀） */
export function isStandardOptoCameraEntityId(id: string | undefined): boolean {
  const raw = (id ?? "").trim();
  if (!raw) return false;
  if (/^camera_?\d{3}$/i.test(raw)) return true;
  const norm = normThirdPartyEntityId(raw);
  return /^camera-\d{3}$/.test(norm);
}

/** 8090 第三方相机（如 `camera-hs-001`）；勿把 `camera_001` 规范化后的 `camera-001` 误判进来 */
export function isThirdPartyCameraEntityId(id: string | undefined): boolean {
  if (isStandardOptoCameraEntityId(id)) return false;
  const norm = normThirdPartyEntityId(id);
  if (!norm) return false;
  return norm.startsWith("camera-");
}
