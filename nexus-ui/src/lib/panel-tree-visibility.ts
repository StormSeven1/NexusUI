/** 图层面板树形节点显隐：全显 / 全隐 / 半显（部分子项开启） */
export type PanelTreeVisibilityState = "all" | "none" | "partial";

export function aggregatePanelVisibility(
  flags: readonly boolean[],
): PanelTreeVisibilityState {
  if (flags.length === 0) return "all";
  let on = 0;
  for (const f of flags) if (f) on += 1;
  if (on === 0) return "none";
  if (on === flags.length) return "all";
  return "partial";
}

/** 点击母节点：半显或全隐 → 全开；全显 → 全关 */
export function parentToggleTurnOn(state: PanelTreeVisibilityState): boolean {
  return state !== "all";
}

export function isPanelTreeLit(state: PanelTreeVisibilityState): boolean {
  return state !== "none";
}

export function visibilityFromBoolean(visible: boolean): PanelTreeVisibilityState {
  return visible ? "all" : "none";
}

/** 图层面板设备子项 persisted 条目（光电 / 雷达 / 无人机共用字段子集） */
export type DeviceLayerVisibilityEntry = {
  fov?: boolean;
  icon?: boolean;
  coverage?: boolean;
  position?: boolean;
  route?: boolean;
  airport?: boolean;
};

/**
 * 子项 → 母项：仅当全部子项关闭时联动关闭母开关。
 * 不因子项缺省 true 自动打开母开关，避免刷新后 localStorage 中的「已关」被覆盖。
 */
export function syncMasterOffWhenAllLeavesOff(
  masterOn: boolean,
  anyLeafOn: boolean,
  setMasterOn: (on: boolean) => void,
): void {
  if (!anyLeafOn && masterOn) setMasterOn(false);
}

function leafHasExplicitOff(entry: DeviceLayerVisibilityEntry | undefined): boolean {
  return (
    entry?.fov === false ||
    entry?.icon === false ||
    entry?.coverage === false ||
    entry?.position === false ||
    entry?.route === false ||
    entry?.airport === false
  );
}

function leafHasExplicitOn(entry: DeviceLayerVisibilityEntry | undefined): boolean {
  return (
    entry?.fov === true ||
    entry?.icon === true ||
    entry?.coverage === true ||
    entry?.position === true ||
    entry?.route === true ||
    entry?.airport === true
  );
}

/**
 * 子项列表就绪后同步实体图层母开关：
 * - 子项全关 → 关母开关
 * - 母开关关但存在显式子项配置且仍有子项可见 → 开母开关（恢复部分显示；不因缺省 {} 误开）
 */
export function syncEntityLayerMasterFromDeviceLeaves<T extends DeviceLayerVisibilityEntry>(
  ready: boolean,
  masterOn: boolean,
  leafIds: readonly string[],
  visibilityMap: Readonly<Record<string, T | undefined>>,
  isLeafVisible: (id: string) => boolean,
  setMasterOn: (on: boolean) => void,
): void {
  if (!ready) return;

  const anyOn = leafIds.some(isLeafVisible);
  syncMasterOffWhenAllLeavesOff(masterOn, anyOn, setMasterOn);

  if (masterOn || !anyOn) return;

  const anyExplicit = leafIds.some((id) => {
    const entry = visibilityMap[id];
    return leafHasExplicitOff(entry) || leafHasExplicitOn(entry);
  });
  if (anyExplicit) setMasterOn(true);
}
