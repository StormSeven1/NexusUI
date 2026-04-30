export interface ResolvedUavPlaybackIds {
  entityId: string;
  airportSN: string | null;
  deviceSN: string | null;
  dockPlaybackEntityId: string | null;
  airPlaybackEntityId: string | null;
}

export async function fetchResolvedUavPlaybackIds(entityId: string): Promise<ResolvedUavPlaybackIds> {
  const id = entityId.trim();
  const res = await fetch(`/api/eo-drone-registry/resolve/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok || data.ok !== true) {
    throw new Error(`无人机实体解析 ${res.status}: ${text.slice(0, 300)}`);
  }
  return {
    entityId: String(data.entityId ?? id),
    airportSN: typeof data.airportSN === "string" ? data.airportSN : null,
    deviceSN: typeof data.deviceSN === "string" ? data.deviceSN : null,
    dockPlaybackEntityId: typeof data.dockPlaybackEntityId === "string" ? data.dockPlaybackEntityId : null,
    airPlaybackEntityId: typeof data.airPlaybackEntityId === "string" ? data.airPlaybackEntityId : null,
  };
}
