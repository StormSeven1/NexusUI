import type { MapGisDroneRow } from "@/lib/map-gis-drone-rows";
import { collectMapGisDroneRowsSync } from "@/lib/map-gis-drone-rows";
import { useAppStore } from "@/stores/app-store";
import { useDroneDeviceLayerStore } from "@/stores/drone-device-layer-store";
import { LYR_DRONES } from "@/lib/map-entity-model";

/** 单架无人机在图层面板下的子项显隐；缺省均为 true */
export type DroneDeviceVisibilityEntry = {
  /** 自报位：实时图标 + 名称 + 历史飞迹 + FOV + 静态站址 */
  position?: boolean;
  /** 任务航线 + 航线终点脉冲环 */
  route?: boolean;
  /** 该机巢/机场站址（`airportSN`） */
  airport?: boolean;
};

export type DroneDeviceVisibilityMap = Record<string, DroneDeviceVisibilityEntry>;

export function isDroneDevicePositionVisible(
  deviceSn: string,
  map: Readonly<DroneDeviceVisibilityMap>,
): boolean {
  return map[deviceSn]?.position !== false;
}

export function isDroneDeviceRouteVisible(
  deviceSn: string,
  map: Readonly<DroneDeviceVisibilityMap>,
): boolean {
  return map[deviceSn]?.route !== false;
}

export function isDroneDeviceAirportVisible(
  deviceSn: string,
  map: Readonly<DroneDeviceVisibilityMap>,
): boolean {
  return map[deviceSn]?.airport !== false;
}

/** 图层面板开启的机场 id（`MapGisDroneRow.airportSN`） */
export function collectVisibleAirportIdsForDronePanel(
  droneRows: ReadonlyArray<Pick<MapGisDroneRow, "sn" | "airportSN">>,
  map: Readonly<DroneDeviceVisibilityMap>,
  droneMasterOn: boolean,
): Set<string> {
  const ids = new Set<string>();
  if (!droneMasterOn) return ids;
  for (const row of droneRows) {
    const ap = row.airportSN.trim();
    if (!ap) continue;
    if (isDroneDeviceAirportVisible(row.sn, map)) ids.add(ap);
  }
  return ids;
}

export function filterAssetsByVisibleDroneAirports<T extends { type: string; id: string }>(
  assets: readonly T[],
  visibleAirportIds: ReadonlySet<string>,
): T[] {
  return assets.filter((a) => a.type !== "airport" || visibleAirportIds.has(a.id));
}

/** 从当前 store 汇总图层面板应显示的机场 id */
export function getVisibleDroneAirportIdsFromStores(): Set<string> {
  const layerVis = useAppStore.getState().layerVisibility;
  const deviceVis = useDroneDeviceLayerStore.getState().deviceVisibility;
  return collectVisibleAirportIdsForDronePanel(
    collectMapGisDroneRowsSync(),
    deviceVis,
    layerVis[LYR_DRONES] !== false,
  );
}

export function shouldRenderDronePosition(
  deviceSn: string,
  map: Readonly<DroneDeviceVisibilityMap>,
): boolean {
  return isDroneDevicePositionVisible(deviceSn, map);
}

export function shouldRenderDroneRoute(
  deviceSn: string,
  map: Readonly<DroneDeviceVisibilityMap>,
): boolean {
  return isDroneDeviceRouteVisible(deviceSn, map);
}

/** 图层面板「已开启」：总开关开时，每架无人机自报位 + 航线 + 机场各计 1 项 */
export function countVisibleDroneDeviceLeaves(
  droneRows: ReadonlyArray<Pick<MapGisDroneRow, "sn" | "airportSN">>,
  map: Readonly<DroneDeviceVisibilityMap>,
  masterOn: boolean,
): number {
  if (!masterOn) return 0;
  let n = 0;
  for (const row of droneRows) {
    if (isDroneDevicePositionVisible(row.sn, map)) n += 1;
    if (isDroneDeviceRouteVisible(row.sn, map)) n += 1;
    if (row.airportSN.trim() && isDroneDeviceAirportVisible(row.sn, map)) n += 1;
  }
  return n;
}

/** 图层面板 UI 行数：每架无人机最多 3 行（自报位、航线、机场） */
export function countDroneDevicePanelUiRows(droneRows: ReadonlyArray<Pick<MapGisDroneRow, "airportSN">>): number {
  let n = 0;
  for (const row of droneRows) {
    n += 2;
    if (row.airportSN.trim()) n += 1;
  }
  return n;
}

export function pruneDroneDeviceVisibility(
  map: DroneDeviceVisibilityMap,
  droneSns: ReadonlyArray<string>,
): DroneDeviceVisibilityMap {
  const valid = new Set(droneSns);
  const next: DroneDeviceVisibilityMap = {};
  for (const sn of Object.keys(map)) {
    if (valid.has(sn)) next[sn] = map[sn]!;
  }
  for (const sn of droneSns) {
    if (!(sn in next)) next[sn] = {};
  }
  return next;
}
