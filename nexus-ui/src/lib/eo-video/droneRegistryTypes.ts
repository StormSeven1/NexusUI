export type UavVendor = "dji" | "jouav";

export interface EoDroneDeviceRow {
  entityId: string;
  /** 实体展示名（与设备管理 entity.name 等对齐，供右键菜单显示） */
  name?: string;
  deviceSN: string;
  airportSN: string;
  vendor: UavVendor;
  /** 机巢/机场画面对应的实体 id（缺省则用 entityId） */
  dockPlaybackEntityId?: string;
  /** 空中主摄画面对应的实体 id（缺省则用 entityId） */
  airPlaybackEntityId?: string;
}

export interface EoDroneDevicesFile {
  syncedAt: string;
  sourceUrl: string;
  devices: EoDroneDeviceRow[];
}
