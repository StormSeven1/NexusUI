import { fetchAssetPanelEntityCatalog } from "@/lib/asset-panel-catalog";
import { normalizeAssetType } from "@/lib/map-entity-model";
import type { AssetData } from "@/stores/asset-store";

/** 8090 `location.position` 解析后：0,0 视为未配置 */
export function isValid8090GeoPosition(lat: unknown, lng: unknown): boolean {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  if (la === 0 && ln === 0) return false;
  return true;
}

export function filterOptoCamerasFrom8090Catalog(items: readonly AssetData[]): AssetData[] {
  return items.filter((a) => normalizeAssetType(a.asset_type) === "camera");
}

/** 拉取 8090（`NEXUS_ENTITIES_LIST_URL`）全量实体中的光电行 */
export async function fetch8090OptoCameraCatalog(): Promise<AssetData[]> {
  const items = await fetchAssetPanelEntityCatalog();
  return filterOptoCamerasFrom8090Catalog(items);
}

/**
 * 地图光电经纬度与显示名以 8090 为准；PTZ/视场/量程走 camServer→DDS→Camera WS。
 * 8090 有坐标但尚未出现在合并列表中的相机，会补入资产快照。
 */
export function apply8090CameraPositionsToAssets(
  assets: AssetData[],
  catalog8090: readonly AssetData[],
  staticBase: readonly AssetData[] = [],
): AssetData[] {
  const catalog = filterOptoCamerasFrom8090Catalog(catalog8090);
  const pos8090 = new Map<string, { lat: number; lng: number }>();
  const row8090 = new Map<string, AssetData>();
  for (const c of catalog) {
    row8090.set(c.id, c);
    if (isValid8090GeoPosition(c.lat, c.lng)) {
      pos8090.set(c.id, { lat: Number(c.lat), lng: Number(c.lng) });
    }
  }
  const staticById = new Map(staticBase.filter((s) => s.id).map((s) => [s.id, s]));

  const resolve8090CameraName = (id: string): string | undefined => {
    const raw = String(row8090.get(id)?.name ?? "").trim();
    return raw || undefined;
  };

  const resolveCameraGeo = (id: string): { lat: number; lng: number } | null => {
    const p = pos8090.get(id);
    if (p) return p;
    const st = staticById.get(id);
    if (st && isValid8090GeoPosition(st.lat, st.lng)) {
      return { lat: Number(st.lat), lng: Number(st.lng) };
    }
    return null;
  };

  const with8090Fields = (a: AssetData, geo: { lat: number; lng: number } | null): AssetData => {
    const props =
      a.properties && typeof a.properties === "object"
        ? { ...(a.properties as Record<string, unknown>) }
        : {};
    props.catalog_source = "8090";
    const name8090 = resolve8090CameraName(a.id);
    const next: AssetData = {
      ...a,
      ...(name8090 ? { name: name8090 } : {}),
      properties: props,
    };
    if (!geo) {
      return isValid8090GeoPosition(a.lat, a.lng) ? next : { ...next, lat: 0, lng: 0 };
    }
    props.geo_source = "8090";
    return { ...next, lat: geo.lat, lng: geo.lng, properties: props };
  };

  const seen = new Set<string>();
  const out: AssetData[] = assets.map((a) => {
    if (normalizeAssetType(a.asset_type) !== "camera") return a;
    seen.add(a.id);
    return with8090Fields(a, resolveCameraGeo(a.id));
  });

  for (const c of catalog) {
    if (seen.has(c.id)) continue;
    const geo = pos8090.get(c.id);
    if (!geo) continue;
    out.push(with8090Fields(c, geo));
  }

  return out;
}
