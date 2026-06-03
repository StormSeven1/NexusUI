/** 单台雷达在图层面板下的子项显隐；缺省均为 true */
export type RadarDeviceVisibilityEntry = {
  /** 距离环、环间填充、十字线、距离/角度标签、中心名称 */
  coverage?: boolean;
  /** 雷达站中心 GIS 图标 */
  icon?: boolean;
};

export type RadarDeviceVisibilityMap = Record<string, RadarDeviceVisibilityEntry>;

export function isRadarDeviceCoverageVisible(
  radarId: string,
  map: Readonly<RadarDeviceVisibilityMap>,
): boolean {
  return map[radarId]?.coverage !== false;
}

export function isRadarDeviceIconVisible(
  radarId: string,
  map: Readonly<RadarDeviceVisibilityMap>,
): boolean {
  return map[radarId]?.icon !== false;
}

export function shouldRenderRadarCoverage(
  radarId: string,
  map: Readonly<RadarDeviceVisibilityMap>,
): boolean {
  return isRadarDeviceCoverageVisible(radarId, map);
}

export function shouldRenderRadarIcon(
  radarId: string,
  map: Readonly<RadarDeviceVisibilityMap>,
): boolean {
  return isRadarDeviceIconVisible(radarId, map);
}

/** 图层面板「已开启」：总开关开时，每台雷达距离环 + GIS 图标各计 1 项 */
export function countVisibleRadarDeviceLeaves(
  radarIds: ReadonlyArray<string>,
  map: Readonly<RadarDeviceVisibilityMap>,
  masterOn: boolean,
): number {
  if (!masterOn) return 0;
  let n = 0;
  for (const id of radarIds) {
    if (isRadarDeviceCoverageVisible(id, map)) n += 1;
    if (isRadarDeviceIconVisible(id, map)) n += 1;
  }
  return n;
}

/** 图层面板 UI 行数：每台雷达 2 行（距离环、GIS 图标） */
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
    if (!(id in next)) next[id] = {};
  }
  return next;
}
