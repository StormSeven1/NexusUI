import type { ForceDisposition } from "./theme-colors";

export function isVirtualFromProperties(properties: Record<string, unknown> | null | undefined): boolean {
  if (!properties) return false;
  if (
    properties.virtualTroop === true ||
    properties.virtual_troop === true ||
    properties.isVirtualWeapon === true
  ) {
    return true;
  }
  const raw =
    properties.is_virtual ??
    properties.virtual ??
    properties.isVirtual ??
    properties.isVirtualWeapon;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "virtual" || s === "虚兵";
  }
  const realityType = properties.reality_type ?? properties.realityType;
  if (typeof realityType === "number") return realityType === 2;
  if (typeof realityType === "string") {
    const s = realityType.trim().toLowerCase();
    return s === "2" || s === "virtual" || s === "虚兵";
  }
  return false;
}

export interface Track {
  id: string;
  showID: string;
  uniqueID: string;
  trackId?: string;
  name: string;
  type: "air" | "underwater" | "sea";
  disposition: ForceDisposition;
  lat: number;
  lng: number;
  altitude?: number;
  heading: number;
  speed: number;
  sensor: string;
  lastUpdate: string;
  starred: boolean;
  isAirTrack?: boolean;
  targetType?: string;
  course?: number;
  azimuth?: number;
  distance?: number;
  dataSourceId?: string;
  isVirtual?: boolean;
  isUav?: boolean;
  historyTrail?: [number, number][];
  verificationImage?: string;
}

export const PUBLIC_MAP_ASSET_TYPES = ["radar", "camera", "tower", "laser", "tdoa", "airport", "drone", "usv", "missile"] as const;
export type PublicMapAssetType = (typeof PUBLIC_MAP_ASSET_TYPES)[number];

export type AssetStatus = "online" | "offline" | "degraded";

export function parseMapAssetTypeStrict(raw: unknown, ctx: string): PublicMapAssetType {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || !(PUBLIC_MAP_ASSET_TYPES as readonly string[]).includes(s)) {
    throw new Error(`${ctx}: invalid assetType, expected one of ${PUBLIC_MAP_ASSET_TYPES.join(", ")}`);
  }
  return s as PublicMapAssetType;
}

export function normalizeAssetType(raw: string | undefined | null): PublicMapAssetType {
  const s = String(raw ?? "").toLowerCase().trim();
  if (!s) {
    console.trace("[normalizeAssetType] empty asset_type", JSON.stringify(raw));
    throw new Error("[normalizeAssetType] empty asset_type");
  }
  if (s === "dock" || s === "gateway" || s === "airport" || s === "无人机场") return "airport";
  if (s === "uav" || s === "drone" || s === "无人机") return "drone";
  if (s === "usv" || s === "无人船" || s === "unmanned_ship" || s === "unmanned-ship") return "usv";
  if (s === "missile" || s === "飞弹" || s === "导弹" || s === "munition" || s === "巡飞弹") return "missile";
  if ((PUBLIC_MAP_ASSET_TYPES as readonly string[]).includes(s)) return s as PublicMapAssetType;
  throw new Error(`[normalizeAssetType] unknown asset_type "${raw}"`);
}

export interface Asset {
  id: string;
  name: string;
  type: PublicMapAssetType;
  status: AssetStatus;
  disposition?: ForceDisposition;
  lat: number;
  lng: number;
  range?: number;
  heading?: number;
  fovAngle?: number;
  isVirtual?: boolean;
  showRings?: boolean;
  centerIconVisible?: boolean;
  nameLabelVisible?: boolean;
  showFov?: boolean;
  friendlyMapColor?: string;
  labelFontColor?: string;
  fovFillColor?: string;
  fovFillOpacity?: number;
}

export interface Alert {
  id: string;
  severity: "critical" | "warning" | "info";
  message: string;
  timestamp: string;
  trackId?: string;
}

export type DataLayerPanelRow = { id: string; name: string };

export const LYR_TRACKS = "lyr-tracks";
export const LYR_TRACKS_AIR = "lyr-tracks-air";
export const LYR_TRACKS_SEA = "lyr-tracks-sea";
export const LYR_DRONES = "lyr-drones";
export const LYR_RADAR_COVERAGE = "lyr-radar-coverage";
export const LYR_OPTO_FOV = "lyr-opto-fov";
export const LYR_AIRPORT = "lyr-airport";
export const LYR_USV = "lyr-usv";
export const LYR_MISSILE = "lyr-missile";
export const LYR_LASER = "lyr-laser";
export const LYR_TDOA = "lyr-tdoa";
export const LYR_TOWER = "lyr-tower";
export const LYR_DB_AREAS = "lyr-db-areas";
export const LYR_MEASURE = "lyr-measure";

export const ALL_DATA_LAYER_IDS = [
  LYR_TRACKS_AIR,
  LYR_TRACKS_SEA,
  LYR_DRONES,
  LYR_RADAR_COVERAGE,
  LYR_OPTO_FOV,
  LYR_TOWER,
  LYR_AIRPORT,
  LYR_USV,
  LYR_MISSILE,
  LYR_LASER,
  LYR_TDOA,
  LYR_DB_AREAS,
] as const;

export function buildDataLayerPanelRows(assets: ReadonlyArray<{ asset_type: string }>): DataLayerPanelRow[] {
  const types = new Set<PublicMapAssetType>();
  for (const a of assets) {
    types.add(normalizeAssetType(a.asset_type));
  }
  const rows: DataLayerPanelRow[] = [
    { id: LYR_TRACKS, name: "目标" },
    { id: LYR_DRONES, name: "无人机" },
  ];
  if (types.has("radar")) rows.push({ id: LYR_RADAR_COVERAGE, name: "雷达装备" });
  if (types.has("camera")) rows.push({ id: LYR_OPTO_FOV, name: "光电装备" });
  if (types.has("tower")) rows.push({ id: LYR_TOWER, name: "电子侦察装备" });
  if (types.has("airport")) rows.push({ id: LYR_AIRPORT, name: "无人机场" });
  if (types.has("usv")) rows.push({ id: LYR_USV, name: "无人船" });
  if (types.has("missile")) rows.push({ id: LYR_MISSILE, name: "飞弹" });
  if (types.has("laser")) rows.push({ id: LYR_LASER, name: "激光武器" });
  if (types.has("tdoa")) rows.push({ id: LYR_TDOA, name: "TDOA" });
  rows.push({ id: LYR_DB_AREAS, name: "区域" });
  return rows;
}
