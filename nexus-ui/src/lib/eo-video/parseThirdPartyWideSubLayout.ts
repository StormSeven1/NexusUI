/**
 * 广角第三方相机：UDP `MSG_DEV_STATUS_BASIC`（0x1001）JSON 等载荷中的子相机观测框（与主画面像素坐标一致）。
 * 例：`boxCount` + `boxes[].{ x, y, width, height, subCam }`（`subCam` 为子相机 entityId）。
 */

export type ThirdPartyWideSubCamBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  subCam: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 从单条 Camera 载荷解析广角子区；无 `boxCount`/`box_count` 键时返回 `undefined`（不覆盖 store 旧值）。
 * `boxCount <= 0` 时返回 `[]` 表示清空。
 */
export function parseThirdPartyWideSubLayoutFromPayload(d: Record<string, unknown>): ThirdPartyWideSubCamBox[] | undefined {
  if (!("boxCount" in d) && !("box_count" in d)) return undefined;
  const nRaw = d.boxCount ?? d.box_count;
  const n = Math.trunc(Number(nRaw));
  if (!Number.isFinite(n) || n < 0) return undefined;
  if (n === 0) return [];

  const raw = d.boxes;
  if (!Array.isArray(raw)) return [];

  const out: ThirdPartyWideSubCamBox[] = [];
  for (let i = 0; i < Math.min(n, raw.length, 32); i++) {
    const r = asRecord(raw[i]);
    if (!r) continue;
    const x = num(r.x);
    const y = num(r.y);
    const w = num(r.width ?? r.w);
    const h = num(r.height ?? r.h);
    const subCam = String(r.subCam ?? r.sub_cam ?? "").trim();
    if (x === undefined || y === undefined || w === undefined || h === undefined) continue;
    if (w <= 0 || h <= 0) continue;
    if (!subCam) continue;
    out.push({ x, y, w, h, subCam });
  }
  return out;
}
