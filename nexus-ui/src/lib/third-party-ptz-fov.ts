import { canonicalEntityId } from "@/lib/camera-entity-id";
import { getEntitiesTrackTaskCacheRow } from "@/lib/entities-track-task-cache";
import type { MapGisCameraMenuRow } from "@/lib/map-gis-camera-menu-rows";
import { isValid8090GeoPosition } from "@/lib/opto-camera-positions-8090";
import type { AssetData } from "@/stores/asset-store";

/** 第三方 UDP 相机视场：固定开角 5° */
export const THIRD_PARTY_PTZ_FOV_DEG = 5;

/** 超过此时间未收到 `MSG_DEV_STATUS_BASIC` 则取消视场显示 */
export const THIRD_PARTY_DEV_STATUS_TTL_MS = 10_000;

export const THIRD_PARTY_DETECT_ALERT_TYPE = "第三方相机检测";

export function thirdPartyDetectAlertId(entityId: string): string {
  return `third-party-detect:${canonicalEntityId(entityId)}`;
}

/** 图层面板行中 `kind=thirdParty` 且实体快照 `hasPtz=true` 的 entityId */
export function listHasPtzThirdPartyEntityIds(menuRows: readonly MapGisCameraMenuRow[]): string[] {
  const out: string[] = [];
  for (const row of menuRows) {
    if (row.kind !== "thirdParty") continue;
    const id = canonicalEntityId(row.entityId);
    if (!id) continue;
    const snap = getEntitiesTrackTaskCacheRow(id);
    if (snap?.hasPtz) out.push(id);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function normalizeHeadingDeg(deg: number): number {
  const n = deg % 360;
  return n < 0 ? n + 360 : n;
}

export function formatPanVehicleDeg(panVehicle: number): string {
  return String(Math.round(normalizeHeadingDeg(panVehicle)));
}

export type ThirdPartyPtzFovRow = {
  entityId: string;
  name: string;
  lat: number;
  lng: number;
  panVehicleDeg: number;
  hasTarget: boolean;
};

export function resolveThirdPartyPtzFovRows(
  menuRows: readonly MapGisCameraMenuRow[],
  assets: readonly AssetData[],
  udpByEntityId: Record<
    string,
    | {
        devStatus?: { panVehicle?: number };
        devStatusAt?: number;
        hasTarget?: boolean;
      }
    | undefined
  >,
  now = Date.now(),
): ThirdPartyPtzFovRow[] {
  const allowed = new Set(listHasPtzThirdPartyEntityIds(menuRows));
  if (allowed.size === 0) return [];

  const assetById = new Map<string, AssetData>();
  for (const a of assets) assetById.set(a.id, a);
  const labelById = new Map<string, string>();
  for (const r of menuRows) labelById.set(canonicalEntityId(r.entityId), r.label);

  const out: ThirdPartyPtzFovRow[] = [];
  for (const id of allowed) {
    const udp = udpByEntityId[id];
    const devStatusAt = udp?.devStatusAt;
    if (devStatusAt == null || now - devStatusAt > THIRD_PARTY_DEV_STATUS_TTL_MS) continue;

    const panVehicle = udp?.devStatus?.panVehicle;
    if (panVehicle == null || !Number.isFinite(panVehicle)) continue;

    const asset = assetById.get(id);
    const lat = Number(asset?.lat);
    const lng = Number(asset?.lng);
    if (!isValid8090GeoPosition(lat, lng)) continue;

    const name = String(asset?.name ?? labelById.get(id) ?? id).trim() || id;
    out.push({
      entityId: id,
      name,
      lat,
      lng,
      panVehicleDeg: normalizeHeadingDeg(panVehicle),
      hasTarget: udp?.hasTarget === true,
    });
  }
  return out;
}
