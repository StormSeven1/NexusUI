import type { ThirdPartyDevStatusBasic } from "@/lib/eo-video/parseThirdPartyDevStatusBasic";
import {
  isThirdPartyCameraEntityId,
  normThirdPartyEntityId,
} from "@/lib/eo-video/thirdPartyEntityId";
import { normalizeAssetType } from "@/lib/map-entity-model";
import type { MapGisCameraMenuRow } from "@/lib/map-gis-camera-menu-rows";
import { isValid8090GeoPosition } from "@/lib/opto-camera-positions-8090";
import type { AssetData } from "@/stores/asset-store";
import type { EoCameraDdsStatusRow } from "@/stores/eo-camera-dds-status-store";

/** 第三方相机视场：固定开角 5° */
export const THIRD_PARTY_PTZ_FOV_DEG = 5;

/** 第三方相机视场：固定射程（米） */
export const THIRD_PARTY_PTZ_FOV_RANGE_M = 1500;

/** 第三方相机视场：正常态颜色（MapLibre fill / line） */
export const THIRD_PARTY_PTZ_FOV_FILL_COLOR = "#22c55e";
export const THIRD_PARTY_PTZ_FOV_LINE_COLOR = "#16a34a";
export const THIRD_PARTY_PTZ_FOV_ALERT_FILL_COLOR = "#ef4444";
export const THIRD_PARTY_PTZ_FOV_ALERT_LINE_COLOR = "#f87171";

/** DDS 状态超时（毫秒） */
export const THIRD_PARTY_DDS_STATUS_TTL_MS = 10_000;

/** UDP 0x1001 / 0x5001 状态超时（毫秒） */
export const THIRD_PARTY_UDP_STATUS_TTL_MS = 30_000;

export const THIRD_PARTY_DETECT_ALERT_TYPE = "第三方相机检测";

let ptzFovFlushListener: (() => void) | null = null;

/** Map2D 注册：0x5001 检测框变化时立即刷新扇形（不等待其它 store 订阅） */
export function registerThirdPartyPtzFovFlushListener(fn: (() => void) | null): void {
  ptzFovFlushListener = fn;
}

export function requestThirdPartyPtzFovFlush(): void {
  ptzFovFlushListener?.();
}

export function thirdPartyDetectAlertId(entityId: string): string {
  return `third-party-detect:${normThirdPartyEntityId(entityId)}`;
}

type UdpDevRow = {
  devStatus?: Pick<ThirdPartyDevStatusBasic, "panVehicle" | "lat" | "lng">;
  devStatusAt?: number;
  updatedAt?: number;
  hasTarget?: boolean;
};

function lookupDdsRow(
  ddsByEntityId: Record<string, EoCameraDdsStatusRow | undefined>,
  entityId: string,
): EoCameraDdsStatusRow | undefined {
  const norm = normThirdPartyEntityId(entityId);
  return ddsByEntityId[norm] ?? ddsByEntityId[entityId];
}

function lookupUdpRow(
  udpByEntityId: Record<string, UdpDevRow | undefined>,
  entityId: string,
): UdpDevRow | undefined {
  const norm = normThirdPartyEntityId(entityId);
  return udpByEntityId[norm] ?? udpByEntityId[entityId];
}

function isFreshAt(at: number | undefined, now: number, ttlMs: number): boolean {
  return at != null && now - at <= ttlMs;
}

/** 图层面板行中 `kind=thirdParty` 的 entityId */
export function listHasPtzThirdPartyEntityIds(menuRows: readonly MapGisCameraMenuRow[]): string[] {
  const out: string[] = [];
  for (const row of menuRows) {
    if (row.kind !== "thirdParty") continue;
    const id = normThirdPartyEntityId(row.entityId);
    if (!id) continue;
    out.push(id);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * 地图扇形白名单：菜单第三方行 + UDP/DDS store 键 + 资产库中的第三方相机。
 * 避免菜单 API 未就绪时 `fovRows` 恒为 []。
 */
export function collectThirdPartyEntityIdsForFov(
  menuRows: readonly MapGisCameraMenuRow[],
  assets: readonly AssetData[],
  ddsByEntityId: Record<string, EoCameraDdsStatusRow | undefined>,
  udpByEntityId: Record<string, UdpDevRow | undefined>,
): string[] {
  const ids = new Set<string>();
  const add = (raw: string | undefined) => {
    if (!raw?.trim() || !isThirdPartyCameraEntityId(raw)) return;
    const norm = normThirdPartyEntityId(raw);
    if (norm) ids.add(norm);
  };
  for (const r of menuRows) {
    if (r.kind === "thirdParty") add(r.entityId);
  }
  for (const k of Object.keys(udpByEntityId)) add(k);
  for (const k of Object.keys(ddsByEntityId)) add(k);
  for (const a of assets) {
    if (normalizeAssetType(a.asset_type) !== "camera") continue;
    add(a.id);
  }
  return [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function thirdPartyEntityIdsFromMenu(menuRows: readonly MapGisCameraMenuRow[]): Set<string> {
  return new Set(listHasPtzThirdPartyEntityIds(menuRows));
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
  /** 地图扇形朝向（°）：优先 DDS originPtz.pan，其次 UDP panVehicle */
  panVehicleDeg: number;
  hasTarget: boolean;
};

function resolveBearingDeg(
  dds: EoCameraDdsStatusRow | undefined,
  udp: UdpDevRow | undefined,
  asset: AssetData | undefined,
  now: number,
): number | undefined {
  const originPan = dds?.originPtzPanDeg;
  if (
    originPan != null &&
    Number.isFinite(originPan) &&
    isFreshAt(dds?.updatedAt, now, THIRD_PARTY_DDS_STATUS_TTL_MS)
  ) {
    return originPan;
  }
  const panVehicle = udp?.devStatus?.panVehicle;
  const udpAt = udp?.devStatusAt ?? udp?.updatedAt;
  if (
    panVehicle != null &&
    Number.isFinite(panVehicle) &&
    isFreshAt(udpAt, now, THIRD_PARTY_UDP_STATUS_TTL_MS)
  ) {
    return panVehicle;
  }
  const heading = asset?.heading;
  if (heading != null && Number.isFinite(Number(heading))) {
    return Number(heading);
  }
  return undefined;
}

function resolveGeo(
  asset: AssetData | undefined,
  udp: UdpDevRow | undefined,
): { lat: number; lng: number } | null {
  let lat = Number(asset?.lat);
  let lng = Number(asset?.lng);
  if (isValid8090GeoPosition(lat, lng)) return { lat, lng };
  const geoLat = udp?.devStatus?.lat;
  const geoLng = udp?.devStatus?.lng;
  if (geoLat != null && geoLng != null && isValid8090GeoPosition(geoLat, geoLng)) {
    return { lat: geoLat, lng: geoLng };
  }
  return null;
}

export type ThirdPartyPtzFovSkipReason = {
  entityId: string;
  reason: string;
};

/** 诊断 `fovRows` 为空时每一步被跳过的原因（控制台调试用） */
export function diagnoseThirdPartyPtzFovSkips(
  menuRows: readonly MapGisCameraMenuRow[],
  assets: readonly AssetData[],
  ddsByEntityId: Record<string, EoCameraDdsStatusRow | undefined>,
  udpByEntityId: Record<string, UdpDevRow | undefined>,
  now = Date.now(),
): ThirdPartyPtzFovSkipReason[] {
  const ids = collectThirdPartyEntityIdsForFov(menuRows, assets, ddsByEntityId, udpByEntityId);
  if (ids.length === 0) {
    return [{ entityId: "*", reason: "无第三方 id（菜单/UDP/DDS/资产均为空）" }];
  }
  const assetById = new Map<string, AssetData>();
  for (const a of assets) {
    assetById.set(a.id, a);
    const norm = normThirdPartyEntityId(a.id);
    if (norm) assetById.set(norm, a);
  }
  const out: ThirdPartyPtzFovSkipReason[] = [];
  for (const id of ids) {
    const dds = lookupDdsRow(ddsByEntityId, id);
    const udp = lookupUdpRow(udpByEntityId, id);
    const asset = assetById.get(id) ?? assetById.get(normThirdPartyEntityId(id));
    const bearing = resolveBearingDeg(dds, udp, asset, now);
    if (bearing == null || !Number.isFinite(bearing)) {
      out.push({
        entityId: id,
        reason: `无方位: dds.originPtzPan=${dds?.originPtzPanDeg ?? "—"} udp.panVehicle=${udp?.devStatus?.panVehicle ?? "—"} asset.heading=${asset?.heading ?? "—"}`,
      });
      continue;
    }
    if (!resolveGeo(asset, udp)) {
      out.push({ entityId: id, reason: "无有效坐标（8090 资产或 UDP lat/lon）" });
    }
  }
  return out;
}

export function resolveThirdPartyPtzFovRows(
  menuRows: readonly MapGisCameraMenuRow[],
  assets: readonly AssetData[],
  ddsByEntityId: Record<string, EoCameraDdsStatusRow | undefined>,
  udpByEntityId: Record<string, UdpDevRow | undefined>,
  now = Date.now(),
): ThirdPartyPtzFovRow[] {
  const allowed = collectThirdPartyEntityIdsForFov(menuRows, assets, ddsByEntityId, udpByEntityId);
  if (allowed.length === 0) return [];

  const assetById = new Map<string, AssetData>();
  for (const a of assets) {
    assetById.set(a.id, a);
    const norm = normThirdPartyEntityId(a.id);
    if (norm) assetById.set(norm, a);
  }
  const labelById = new Map<string, string>();
  for (const r of menuRows) {
    labelById.set(normThirdPartyEntityId(r.entityId), r.label);
  }

  const out: ThirdPartyPtzFovRow[] = [];
  for (const id of allowed) {
    const dds = lookupDdsRow(ddsByEntityId, id);
    const udp = lookupUdpRow(udpByEntityId, id);
    const asset = assetById.get(id) ?? assetById.get(normThirdPartyEntityId(id));
    const bearing = resolveBearingDeg(dds, udp, asset, now);
    if (bearing == null || !Number.isFinite(bearing)) continue;

    const geo = resolveGeo(asset, udp);
    if (!geo) continue;

    const name = String(asset?.name ?? labelById.get(id) ?? id).trim() || id;
    out.push({
      entityId: id,
      name,
      lat: geo.lat,
      lng: geo.lng,
      panVehicleDeg: normalizeHeadingDeg(bearing),
      hasTarget: udp?.hasTarget === true,
    });
  }
  return out;
}
