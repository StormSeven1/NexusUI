import { canonicalEntityId } from "@/lib/camera-entity-id";
import { extractEntityRecords, extractDroneSnsFromEntityRaw } from "@/lib/eo-video/mapEntitiesToDroneDevices";
import { fetchDroneDevicesForAssetPanel } from "@/lib/eo-video/mergeEoVideoRegistry";
import { mapOneEntityRow } from "@/lib/map-app-config";
import {
  ASSET_PANEL_TOP_CATEGORIES,
  classifyAssetPanelCategory,
  isHomePanelAsset,
  resolveAssetPanelDisplayLabel,
  type AssetPanelCategoryId,
} from "@/lib/asset-panel-tree";
import { normalizeAssetType } from "@/lib/map-entity-model";
import { fetchMapGisEoMenuContext, type MapGisEoMenuContext } from "@/lib/map-gis-eo-menu-context";
import { useAssetStore, type AssetData } from "@/stores/asset-store";
import { useDroneStore } from "@/stores/drone-store";

/** 资产列表侧边栏全量刷新间隔（实体 API + 与 store 合并） */
export const ASSET_PANEL_REFRESH_MS = 5 * 60 * 1000;

export type DroneFleetOnlineStatus = "online" | "offline";

export type DroneFleetStatus = {
  airport: DroneFleetOnlineStatus;
  drone: DroneFleetOnlineStatus;
};

export type AssetPanelTreeRow = {
  asset: AssetData;
  label: string;
  hasCoords: boolean;
  /** 无人机分组：一行展示机场 + 机体双状态 */
  droneFleetStatus?: DroneFleetStatus;
};

const DRONE_TELEMETRY_ONLINE_MS = 30_000;
const DOCK_STATUS_ONLINE_MS = 90_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 不在 8090 列表、但需出现在侧边栏的 WS/静态设备（激光、TDOA、HOME、机场等） */
function shouldIncludeLiveOnlyInPanel(asset: AssetData): boolean {
  if (isHomePanelAsset(asset)) return true;
  const t = normalizeAssetType(asset.asset_type);
  return t === "laser" || t === "tdoa" || t === "tower" || t === "airport" || t === "radar";
}

function pickEntityIdFromDroneLiveProps(properties: Record<string, unknown> | null): string {
  if (!properties) return "";
  const raw = properties.entity_id ?? properties.entityId ?? "";
  return canonicalEntityId(String(raw).trim());
}

function hasValidCoords(asset: AssetData): boolean {
  const p = asset.properties;
  if (p && p._assetPanelNoCoords === true) return false;
  return Number.isFinite(asset.lat) && Number.isFinite(asset.lng);
}

/** 8090 全量实体 → 资产列表行（不做地图显隐黑名单、不要求有坐标） */
export function buildCatalogFromEntitiesPayload(payload: unknown): AssetData[] {
  const records = extractEntityRecords(payload);
  const byId = new Map<string, AssetData>();
  for (const raw of records) {
    if (!isRecord(raw)) continue;
    const a = mapOneEntityRow(raw, { allowMissingCoords: true });
    if (!a) continue;
    byId.set(a.id, a);
  }
  return [...byId.values()];
}

/** 合并实体目录 + 实时 store（store 覆盖状态/坐标）；相机再并入 eo 注册表中的全部 entityId */
export function mergeAssetPanelCatalog(
  entityCatalog: AssetData[],
  liveAssets: AssetData[],
  eoCtx: MapGisEoMenuContext | null,
): AssetData[] {
  const byId = new Map<string, AssetData>();

  for (const a of entityCatalog) {
    byId.set(a.id, a);
  }

  const catalogUavIds = new Set(
    entityCatalog
      .filter((a) => normalizeAssetType(a.asset_type) === "drone")
      .map((a) => a.id),
  );

  for (const a of liveAssets) {
    const t = normalizeAssetType(a.asset_type);
    const prev = byId.get(a.id);

    /* WS 无人机（deviceSn）→ 合并到同条 8090 UAV（entity_id）的在线状态 */
    if (t === "drone") {
      const linkedUavId = pickEntityIdFromDroneLiveProps(a.properties);
      if (linkedUavId && catalogUavIds.has(linkedUavId)) {
        const uavPrev = byId.get(linkedUavId)!;
        byId.set(linkedUavId, {
          ...uavPrev,
          ...a,
          id: linkedUavId,
          name: uavPrev.name,
          asset_type: "drone",
          status: a.status ?? uavPrev.status,
        });
        continue;
      }
      if (catalogUavIds.has(a.id)) {
        const uavPrev = byId.get(a.id)!;
        byId.set(a.id, {
          ...uavPrev,
          ...a,
          name: uavPrev.name,
          asset_type: "drone",
        });
        continue;
      }
    }

    if (prev) {
      /* 相机在线态以 8090 实体列表（NEXUS_ENTITIES_LIST_URL）为准，不用 WS/asset-store 覆盖 */
      if (t === "camera") {
        byId.set(a.id, {
          ...prev,
          ...a,
          status: prev.status,
          name: a.name?.trim() ? a.name : prev.name,
        });
        continue;
      }
      byId.set(a.id, { ...prev, ...a, name: a.name?.trim() ? a.name : prev.name });
      continue;
    }

    if (shouldIncludeLiveOnlyInPanel(a)) {
      byId.set(a.id, a);
    }
  }

  if (eoCtx) {
    for (const entityId of eoCtx.cameraLabelByEntityId.keys()) {
      const id = canonicalEntityId(entityId);
      if (!id || byId.has(id)) continue;
      byId.set(id, {
        id,
        name: eoCtx.cameraLabelByEntityId.get(id) ?? id,
        asset_type: "camera",
        status: "offline",
        lat: 0,
        lng: 0,
        range_km: null,
        heading: null,
        fov_angle: null,
        properties: null,
        mission_status: "idle",
        assigned_target_id: null,
        target_lat: null,
        target_lng: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  return [...byId.values()].map((a) =>
    a.mission_status === "idle" ? a : { ...a, mission_status: "idle" },
  );
}

function resolveDockOnline(dockSn: string, liveAirport?: AssetData): DroneFleetOnlineStatus {
  const ds = useDroneStore.getState();
  const ap = ds.relationships?.airports.find((a) => a.dockSn === dockSn);
  const inRel = !!ap;
  const dock = ds.docks[dockSn];
  if (dock?.updatedAt) {
    const age = Date.now() - new Date(dock.updatedAt).getTime();
    if (age <= DOCK_STATUS_ONLINE_MS) return "online";
  }
  if (liveAirport?.status === "online") return "online";
  /* entity_status 已登记且有坐标的机场：8090/relationships 层视为可用（无 dock_status 时不一律标离线） */
  if (inRel && ap?.latitude != null && ap?.longitude != null) return "online";
  if (!inRel) return liveAirport?.status === "online" ? "online" : "offline";
  return "offline";
}

function resolveDroneTelemetryOnline(
  droneSn: string,
  liveDrone?: AssetData,
  catalogEntity?: AssetData,
): DroneFleetOnlineStatus {
  const d = useDroneStore.getState().drones[droneSn];
  if (d && Date.now() - d.lastPacketAtMs <= DRONE_TELEMETRY_ONLINE_MS) return "online";
  if (liveDrone?.status === "online") return "online";
  /* 无 DDS 遥测时：8090 实体目录 health=HEALTHY → online（与 mapOneEntityRow 一致） */
  if (catalogEntity?.status === "online") return "online";
  return "offline";
}

type DroneFleetEntry = {
  droneSn: string;
  airportSn: string;
  label: string;
  entityId?: string;
};

function buildDroneFleetPanelRows(
  assets: AssetData[],
  eoCtx: MapGisEoMenuContext | null,
): AssetPanelTreeRow[] {
  const ds = useDroneStore.getState();
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const entries = new Map<string, DroneFleetEntry>();

  const put = (droneSn: string, airportSn: string, label: string, entityId?: string) => {
    const sn = droneSn.trim();
    const ap = airportSn.trim();
    if (!ap) return;
    const key = sn || `dock:${ap}`;
    const prev = entries.get(key);
    entries.set(key, {
      droneSn: sn,
      airportSn: ap,
      label: label.trim() || prev?.label || sn || ap,
      entityId: entityId ?? prev?.entityId,
    });
  };

  for (const r of eoCtx?.registryDroneRows ?? []) {
    put(r.sn, r.airportSN, r.label);
  }

  for (const ap of ds.relationships?.airports ?? []) {
    const dockSn = ap.dockSn.trim();
    if (!dockSn) continue;
    const dockLabel = ds.docks[dockSn]?.displayName?.trim() || `机场 · ${dockSn}`;
    if (!ap.drones.length) {
      put("", dockSn, dockLabel);
      continue;
    }
    for (const dr of ap.drones) {
      const droneSn = dr.deviceSn.trim();
      if (!droneSn) continue;
      const label =
        dr.name?.trim() ||
        eoCtx?.droneLabelByDeviceSn.get(droneSn)?.trim() ||
        ds.drones[droneSn]?.displayName?.trim() ||
        droneSn;
      put(droneSn, dockSn, label, dr.entityId);
    }
  }

  for (const a of assets) {
    if (normalizeAssetType(a.asset_type) !== "drone") continue;
    const props =
      a.properties && typeof a.properties === "object"
        ? (a.properties as Record<string, unknown>)
        : null;
    const entityId = a.id;
    const fromAliases = props ? extractDroneSnsFromEntityRaw(props) : { deviceSN: "", airportSN: "" };
    const deviceSn =
      ds.entityIdToDeviceSn[entityId]?.trim() ||
      String(props?.device_sn ?? props?.deviceSn ?? "").trim() ||
      fromAliases.deviceSN.trim() ||
      (ds.drones[entityId] ? entityId : "");
    const dockSn =
      String(props?.dock_sn ?? props?.dockSn ?? "").trim() ||
      fromAliases.airportSN.trim() ||
      (deviceSn ? ds.droneToAirport[deviceSn] ?? "" : "");
    if (!dockSn && !deviceSn && !entityId) continue;
    put(deviceSn || entityId, dockSn, resolveAssetPanelDisplayLabel(a, eoCtx), entityId);
  }

  const now = new Date().toISOString();
  const rows: AssetPanelTreeRow[] = [];

  for (const ent of entries.values()) {
    const catalogEntity =
      (ent.entityId ? assetById.get(ent.entityId) : undefined) ??
      assetById.get(canonicalEntityId(ent.entityId ?? ""));
    const airportStatus = (() => {
      const base = resolveDockOnline(ent.airportSn, assetById.get(ent.airportSn));
      if (base === "online") return "online";
      /* 无 entity_status 关系时：8090 UAV 目录 HEALTHY 且能解析出同一 gateway → 机场在线 */
      if (catalogEntity?.status === "online" && ent.airportSn.trim()) return "online";
      return base;
    })();
    const droneStatus = ent.droneSn
      ? resolveDroneTelemetryOnline(
          ent.droneSn,
          assetById.get(ent.droneSn) ?? catalogEntity,
          catalogEntity,
        )
      : "offline";

    const catalog =
      catalogEntity ??
      assetById.get(ent.droneSn) ??
      assetById.get(canonicalEntityId(ent.entityId ?? ""));
    const liveDrone = ent.droneSn ? ds.drones[ent.droneSn] : undefined;
    const apRel = ds.relationships?.airports.find((a) => a.dockSn === ent.airportSn);

    let lat = catalog?.lat ?? 0;
    let lng = catalog?.lng ?? 0;
    if (liveDrone?.lat != null && liveDrone.lng != null) {
      lat = liveDrone.lat;
      lng = liveDrone.lng;
    } else if (apRel?.latitude != null && apRel.longitude != null) {
      lat = apRel.latitude;
      lng = apRel.longitude;
    }

    const rowId = ent.droneSn || ent.airportSn;
    const asset: AssetData = {
      id: rowId,
      name: ent.label,
      asset_type: "drone",
      status: airportStatus === "online" || droneStatus === "online" ? "online" : "offline",
      disposition: catalog?.disposition ?? "friendly",
      lat,
      lng,
      range_km: catalog?.range_km ?? null,
      heading: catalog?.heading ?? null,
      fov_angle: catalog?.fov_angle ?? null,
      properties: {
        dock_sn: ent.airportSn,
        device_sn: ent.droneSn,
        entity_id: ent.entityId ?? "",
      },
      mission_status: "idle",
      assigned_target_id: null,
      target_lat: null,
      target_lng: null,
      created_at: catalog?.created_at ?? now,
      updated_at: now,
    };

    rows.push({
      asset,
      label: ent.label,
      hasCoords: hasValidCoords(asset),
      droneFleetStatus: { airport: airportStatus, drone: droneStatus },
    });
  }

  rows.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  return rows;
}

export function groupAssetsForPanelTree(
  assets: AssetData[],
  eoCtx: MapGisEoMenuContext | null,
  search: string,
  onlineOnly = false,
): Map<AssetPanelCategoryId, AssetPanelTreeRow[]> {
  const q = search.trim().toLowerCase();
  const buckets = new Map<AssetPanelCategoryId, AssetPanelTreeRow[]>();
  for (const { id } of ASSET_PANEL_TOP_CATEGORIES) {
    buckets.set(id, []);
  }

  for (const asset of assets) {
    const t = normalizeAssetType(asset.asset_type);
    if (t === "drone" || t === "airport") continue;

    if (onlineOnly && asset.status !== "online") continue;
    const label = resolveAssetPanelDisplayLabel(asset, eoCtx);
    if (q) {
      const hay = `${label} ${asset.id}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    const cat = classifyAssetPanelCategory(asset);
    buckets.get(cat)!.push({
      asset,
      label,
      hasCoords: hasValidCoords(asset),
    });
  }

  for (const row of buildDroneFleetPanelRows(assets, eoCtx)) {
    const fs = row.droneFleetStatus;
    const anyOnline = fs?.airport === "online" || fs?.drone === "online";
    if (onlineOnly && !anyOnline) continue;
    if (q) {
      const dockSn =
        row.asset.properties && typeof row.asset.properties === "object"
          ? String((row.asset.properties as Record<string, unknown>).dock_sn ?? "")
          : "";
      const hay = `${row.label} ${row.asset.id} ${dockSn}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    buckets.get("drone")!.push(row);
  }

  for (const [cat, list] of buckets) {
    list.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  }

  return buckets;
}

/** 拉取实体目录 + 光电菜单上下文，并与当前 asset-store 合并为展示用列表 */
export async function refreshAssetPanelSnapshot(): Promise<{
  catalog: AssetData[];
  eoCtx: MapGisEoMenuContext;
  merged: AssetData[];
}> {
  const [eoCtx, catalog, panelDrones] = await Promise.all([
    fetchMapGisEoMenuContext(),
    fetchAssetPanelEntityCatalog(),
    fetchDroneDevicesForAssetPanel(),
  ]);
  const panelEoCtx: MapGisEoMenuContext = {
    ...eoCtx,
    registryDroneRows: mergeRegistryDroneRows(eoCtx.registryDroneRows, panelDrones),
    droneLabelByDeviceSn: new Map([
      ...eoCtx.droneLabelByDeviceSn,
      ...panelDrones.map((d) => [d.deviceSN, (d.name ?? "").trim() || d.entityId] as const),
    ]),
  };
  const merged = mergeAssetPanelCatalog(catalog, useAssetStore.getState().assets, panelEoCtx);
  return { catalog, eoCtx: panelEoCtx, merged };
}

function mergeRegistryDroneRows(
  base: MapGisEoMenuContext["registryDroneRows"],
  extra: Awaited<ReturnType<typeof fetchDroneDevicesForAssetPanel>>,
): MapGisEoMenuContext["registryDroneRows"] {
  const bySn = new Map(base.map((r) => [r.sn, r]));
  for (const d of extra) {
    const sn = d.deviceSN.trim();
    const ap = d.airportSN.trim();
    if (!sn || !ap) continue;
    const label = (d.name ?? "").trim() || d.entityId;
    const prev = bySn.get(sn);
    bySn.set(sn, { sn, airportSN: ap, label: label || prev?.label || sn });
  }
  return [...bySn.values()].sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
}

export async function fetchAssetPanelEntityCatalog(): Promise<AssetData[]> {
  try {
    /* 浏览器侧 `buildCatalogFromEntitiesPayload`，与 HMR 同步；避免 API Route 服务端 bundle 滞后 */
    const res = await fetch("/api/nexus-entities/asset-panel?format=upstream", { cache: "no-store" });
    if (!res.ok) return [];
    const j = (await res.json()) as { ok?: boolean; payload?: unknown; items?: AssetData[] };
    if (j.ok !== true) return [];
    if (j.payload != null) {
      return buildCatalogFromEntitiesPayload(j.payload);
    }
    if (Array.isArray(j.items)) return j.items;
    return [];
  } catch {
    return [];
  }
}
