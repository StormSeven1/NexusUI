import { normalizeEntityPlaybackJson, type EntityPlaybackNormalized } from "./normalizeEntityPlayback";

export type CameraEntityPlayback = EntityPlaybackNormalized;

/** 内存缓存条目 */
type CacheEntry = {
  data: CameraEntityPlayback;
  /** 缓存写入时间 */
  at: number;
  /** 正在飞行中的 Promise（避免并发重复请求） */
  inflight?: Promise<CameraEntityPlayback>;
};

/** 实体播放 URL 短 TTL 缓存（60s）：切流时命中缓存则无需等待 HTTP，近似瞬间出画 */
const entityPlaybackCache = new Map<string, CacheEntry>();
const ENTITY_CACHE_TTL_MS = 60_000;

function getCachedEntry(id: string): CacheEntry | null {
  const entry = entityPlaybackCache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.at > ENTITY_CACHE_TTL_MS) {
    entityPlaybackCache.delete(id);
    return null;
  }
  return entry;
}

/**
 * 浏览器侧：请求同源 /api/entity-v1/{id}，解析与 base-vue VideoWall 相同的实体 JSON。
 */
export async function fetchCameraEntityPlayback(entityId: string): Promise<CameraEntityPlayback> {
  const id = entityId.trim();
  const cached = getCachedEntry(id);
  if (cached) return cached.data;

  const res = await fetch(`/api/entity-v1/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`实体接口 ${res.status}: ${t.slice(0, 200)}`);
  }
  const data: unknown = await res.json();
  const result = normalizeEntityPlaybackJson(data, id);
  entityPlaybackCache.set(id, { data: result, at: Date.now() });
  return result;
}

/** 任意实体 id（无人机机巢/机体等），走 /api/entity-playback 代理 */
export async function fetchEntityPlaybackAny(entityId: string): Promise<CameraEntityPlayback> {
  const id = entityId.trim();
  const cached = getCachedEntry(id);
  if (cached) return cached.data;

  // 并发去重：同一 id 飞行中只发一次请求
  const existing = entityPlaybackCache.get(id);
  if (existing?.inflight) return existing.inflight;

  const inflight = (async () => {
    const res = await fetch(`/api/entity-playback/${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`实体播放 ${res.status}: ${t.slice(0, 200)}`);
    }
    const data: unknown = await res.json();
    const result = normalizeEntityPlaybackJson(data, id);
    entityPlaybackCache.set(id, { data: result, at: Date.now() });
    return result;
  })();

  entityPlaybackCache.set(id, { data: null as unknown as CameraEntityPlayback, at: 0, inflight });
  inflight.catch(() => entityPlaybackCache.delete(id));
  return inflight;
}

/**
 * 预加载一批实体 URL（cfg 加载完成后调用）。
 * 命中缓存后切流无需等待 HTTP 请求，第一帧几乎与点击同时出现。
 */
export function prefetchEntityPlaybackUrls(entityIds: string[]): void {
  for (const id of entityIds) {
    if (!id.trim()) continue;
    if (getCachedEntry(id.trim())) continue;
    // 静默预加载，忽略错误
    void fetchEntityPlaybackAny(id.trim()).catch(() => {});
  }
}
