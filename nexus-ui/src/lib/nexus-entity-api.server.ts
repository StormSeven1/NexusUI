/** 从 `NEXUS_ENTITIES_LIST_URL` 解析实体服务根地址（如 http://192.168.18.141:8090） */
export function resolveNexusEntityApiBase(): string {
  const list =
    process.env.NEXUS_ENTITIES_LIST_URL?.trim() ||
    "http://192.168.18.141:8090/api/v1/entities?page=1&size=100";
  try {
    const u = new URL(list);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "http://192.168.18.141:8090";
  }
}

export function nexusPublishEntityUrl(): string {
  return `${resolveNexusEntityApiBase()}/api/v1/publishEntity`;
}

export function nexusDeleteEntityUrl(entityId: string): string {
  return `${resolveNexusEntityApiBase()}/api/v1/entities/${encodeURIComponent(entityId)}`;
}
