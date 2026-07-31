/**
 * 后端检测框烧录流识别（与 camServer `EoBurnInConfig::webMediaNameFor` 一致）。
 *
 * 约定流名：`live/{entityId}_burn`，常见形态：
 * - `webrtc://host:91/live/camera_004_burn`
 * - `http://host:91/index/api/webrtc?app=live&stream=camera_004_burn&type=play`
 * - 裸流名 `camera_004_burn` / 路径 `live/camera_004_burn`
 */

const BURN_SUFFIX = /_burn$/i;

function pathLooksBurnIn(pathOrStream: string): boolean {
  const raw = pathOrStream.trim();
  if (!raw) return false;
  const noQuery = raw.split("?")[0]?.split("#")[0] ?? raw;
  const parts = noQuery.split("/").filter(Boolean);
  // webrtc://host:port/app/stream → 去掉 host:port
  const media = parts[0]?.includes(":") ? parts.slice(1) : parts;
  if (media.some((p) => BURN_SUFFIX.test(p))) return true;
  return BURN_SUFFIX.test(noQuery);
}

/** 当前播放地址是否为后端烧录流（框/标牌已烧进画面，前端勿再叠检测绘制） */
export function isEoBurnInPlaybackUrl(url: string | null | undefined): boolean {
  const s = (url ?? "").trim();
  if (!s) return false;

  if (/[?&]stream=/i.test(s)) {
    try {
      const u = new URL(s, "http://local.invalid");
      const stream = (u.searchParams.get("stream") ?? "").trim();
      if (stream && pathLooksBurnIn(stream)) return true;
    } catch {
      const m = s.match(/[?&]stream=([^&]+)/i);
      if (m?.[1] && pathLooksBurnIn(decodeURIComponent(m[1]))) return true;
    }
  }

  let path = s;
  if (/^webrtc:\/\//i.test(path)) path = path.slice("webrtc://".length);
  return pathLooksBurnIn(path);
}
