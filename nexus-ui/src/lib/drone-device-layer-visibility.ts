/** 单架无人机在图层面板下的子项显隐；缺省均为 true */
export type DroneDeviceVisibilityEntry = {
  /** 自报位：实时图标 + 名称 + 历史飞迹 + FOV + 静态站址 */
  position?: boolean;
  /** 任务航线 + 航线终点脉冲环 */
  route?: boolean;
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

/** 图层面板「已开启」：总开关开时，每架无人机自报位 + 航线各计 1 项 */
export function countVisibleDroneDeviceLeaves(
  droneSns: ReadonlyArray<string>,
  map: Readonly<DroneDeviceVisibilityMap>,
  masterOn: boolean,
): number {
  if (!masterOn) return 0;
  let n = 0;
  for (const sn of droneSns) {
    if (isDroneDevicePositionVisible(sn, map)) n += 1;
    if (isDroneDeviceRouteVisible(sn, map)) n += 1;
  }
  return n;
}

/** 图层面板 UI 行数：每架无人机 2 行（自报位、航线） */
export function countDroneDevicePanelUiRows(droneCount: number): number {
  return droneCount > 0 ? droneCount * 2 : 0;
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
