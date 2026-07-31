/** 单台雷达在图层面板下的子项显隐；图标缺省 true，能力缺省 false（需点开）。距离环已取消。 */
export type RadarDeviceVisibilityEntry = {
  /**
   * @deprecated 距离环已下线，忽略此字段；保留仅为兼容 localStorage 旧数据。
   */
  coverage?: boolean;
  /** 雷达站中心 GIS 图标 */
  icon?: boolean;
  /** 能力扫描（360° 旋转亮带）；缺省关闭 */
  capability?: boolean;
};

export type RadarDeviceVisibilityMap = Record<string, RadarDeviceVisibilityEntry>;

/** @deprecated 距离环已下线，恒为 false */
export function isRadarDeviceCoverageVisible(
  _radarId: string,
  _map: Readonly<RadarDeviceVisibilityMap>,
): boolean {
  return false;
}

export function isRadarDeviceIconVisible(
  radarId: string,
  map: Readonly<RadarDeviceVisibilityMap>,
): boolean {
  return map[radarId]?.icon !== false;
}

/** 能力扫描：显式 true 才开启 */
export function isRadarDeviceCapabilityVisible(
  radarId: string,
  map: Readonly<RadarDeviceVisibilityMap>,
): boolean {
  return map[radarId]?.capability === true;
}

/** @deprecated 距离环已下线，恒为 false */
export function shouldRenderRadarCoverage(
  _radarId: string,
  _map: Readonly<RadarDeviceVisibilityMap>,
): boolean {
  return false;
}

export function shouldRenderRadarIcon(
  radarId: string,
  map: Readonly<RadarDeviceVisibilityMap>,
): boolean {
  return isRadarDeviceIconVisible(radarId, map);
}

/** 图层面板「已开启」：总开关开时，每台雷达 GIS 图标 + 能力 各计 1 项 */
export function countVisibleRadarDeviceLeaves(
  radarIds: ReadonlyArray<string>,
  map: Readonly<RadarDeviceVisibilityMap>,
  masterOn: boolean,
): number {
  if (!masterOn) return 0;
  let n = 0;
  for (const id of radarIds) {
    if (isRadarDeviceIconVisible(id, map)) n += 1;
    if (isRadarDeviceCapabilityVisible(id, map)) n += 1;
  }
  return n;
}

/** 图层面板 UI 行数：每台雷达 2 行（GIS 图标、能力） */
export function countRadarDevicePanelUiRows(radarCount: number): number {
  return radarCount > 0 ? radarCount * 2 : 0;
}

export function pruneRadarDeviceVisibility(
  map: RadarDeviceVisibilityMap,
  radarIds: ReadonlyArray<string>,
): RadarDeviceVisibilityMap {
  const valid = new Set(radarIds);
  const next: RadarDeviceVisibilityMap = {};
  for (const id of Object.keys(map)) {
    if (valid.has(id)) next[id] = map[id]!;
  }
  for (const id of radarIds) {
    if (!(id in next)) next[id] = { icon: false, capability: false };
  }
  return next;
}
