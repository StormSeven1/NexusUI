import { normalizeEntityPlaybackJson, type EntityPlaybackNormalized } from "./normalizeEntityPlayback";

export type CameraEntityPlayback = EntityPlaybackNormalized;

/**
 * 浏览器侧：请求同源 /api/entity-v1/{id}，解析与 base-vue VideoWall 相同的实体 JSON。
 */
export async function fetchCameraEntityPlayback(entityId: string): Promise<CameraEntityPlayback> {
  const id = entityId.trim();
  const res = await fetch(`/api/entity-v1/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`实体接口 ${res.status}: ${t.slice(0, 200)}`);
  }
  const data: unknown = await res.json();
  return normalizeEntityPlaybackJson(data, id);
}

/** 任意实体 id（无人机机巢/机体等），走 /api/entity-playback 代理 */
export async function fetchEntityPlaybackAny(entityId: string): Promise<CameraEntityPlayback> {
  const id = entityId.trim();
  const res = await fetch(`/api/entity-playback/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`实体播放 ${res.status}: ${t.slice(0, 200)}`);
  }
  const data: unknown = await res.json();
  return normalizeEntityPlaybackJson(data, id);
}
