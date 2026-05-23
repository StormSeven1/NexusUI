/** 单台光电（camera）在图层面板下的子项显隐；缺省均为 true */
export type OptoDeviceVisibilityEntry = {
  fov?: boolean;
  icon?: boolean;
};

export type OptoDeviceVisibilityMap = Record<string, OptoDeviceVisibilityEntry>;

export function isOptoDeviceFovVisible(
  assetId: string,
  map: Readonly<OptoDeviceVisibilityMap>,
): boolean {
  return map[assetId]?.fov !== false;
}

export function isOptoDeviceIconVisible(
  assetId: string,
  map: Readonly<OptoDeviceVisibilityMap>,
): boolean {
  return map[assetId]?.icon !== false;
}

/**
 * 地图光电 FOV/图标是否允许绘制该 id。
 * `panelIds === null`：面板列表尚未加载，暂不按白名单过滤（避免首帧全空）。
 * `panelIds` 为 Set：仅图层面板列出的 PTZ 主相机可画；其余 asset-store 中的 camera（第三方、子路等）一律不画。
 */
export function isOptoCameraAllowedOnMap(
  assetId: string,
  panelIds: ReadonlySet<string> | null,
): boolean {
  if (panelIds === null) return true;
  return panelIds.has(assetId);
}

export function shouldRenderOptoCameraFov(
  assetId: string,
  map: Readonly<OptoDeviceVisibilityMap>,
  panelIds: ReadonlySet<string> | null,
): boolean {
  if (!isOptoCameraAllowedOnMap(assetId, panelIds)) return false;
  return isOptoDeviceFovVisible(assetId, map);
}

export function shouldRenderOptoCameraIcon(
  assetId: string,
  map: Readonly<OptoDeviceVisibilityMap>,
  panelIds: ReadonlySet<string> | null,
): boolean {
  if (!isOptoCameraAllowedOnMap(assetId, panelIds)) return false;
  return isOptoDeviceIconVisible(assetId, map);
}

/** 图层面板「已开启」：总开关开时，每台设备视场 + GIS 图标各计 1 项 */
export function countVisibleOptoDeviceLeaves(
  cameraIds: ReadonlyArray<string>,
  map: Readonly<OptoDeviceVisibilityMap>,
  masterOn: boolean,
): number {
  if (!masterOn) return 0;
  let n = 0;
  for (const id of cameraIds) {
    if (isOptoDeviceFovVisible(id, map)) n += 1;
    if (isOptoDeviceIconVisible(id, map)) n += 1;
  }
  return n;
}

/** 图层面板 UI 行数：每台光电 2 行（视场、GIS 图标） */
export function countOptoDevicePanelUiRows(cameraCount: number): number {
  return cameraCount > 0 ? cameraCount * 2 : 0;
}

export function pruneOptoDeviceVisibility(
  map: OptoDeviceVisibilityMap,
  cameraIds: ReadonlyArray<string>,
): OptoDeviceVisibilityMap {
  const valid = new Set(cameraIds);
  const next: OptoDeviceVisibilityMap = {};
  for (const id of Object.keys(map)) {
    if (valid.has(id)) next[id] = map[id]!;
  }
  for (const id of cameraIds) {
    if (!(id in next)) next[id] = {};
  }
  return next;
}
