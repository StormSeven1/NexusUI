/**
 * 实体 REST 上游（camera / UAV 等设备），与 eo-webrtc-sources 中逻辑一致。
 * 服务端 BFF：`/api/entity-v1/*`、`/api/entity-playback/*` 转发到此 base。
 */

export const DEFAULT_CAMERA_ENTITY_BASE = "http://192.168.18.141:8088";

export function getCameraEntityBaseUrl(): string {
  return (process.env.CAMERA_ENTITY_BASE_URL ?? DEFAULT_CAMERA_ENTITY_BASE).replace(/\/$/, "");
}

export function buildEntityV1UpstreamUrl(entityId: string): string {
  const id = entityId.trim();
  return `${getCameraEntityBaseUrl()}/api/v1/entity/${encodeURIComponent(id)}`;
}

/** 与 eo-drone-registry resolve 一致，防路径注入 */
export function isSafeEntityIdForProxy(id: string): boolean {
  const t = id.trim();
  if (!t || t.length > 200) return false;
  return /^[a-zA-Z0-9_.:-]+$/.test(t);
}
