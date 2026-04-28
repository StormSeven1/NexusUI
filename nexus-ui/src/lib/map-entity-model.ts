import type { ForceDisposition } from "./theme-colors";

/** 从 WS / 后端 properties 解析是否虚兵（供地图符号与适配器共用） */
export function isVirtualFromProperties(properties: Record<string, unknown> | null | undefined): boolean {
  if (!properties) return false;
  if (properties.virtualTroop === true || properties.virtual_troop === true) return true;
  const raw = properties.is_virtual ?? properties.virtual ?? properties.isVirtual;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "virtual";
  }
  return false;
}

export interface Track {
  /** 缓存主键（= uniqueID），整个工程用此字段做 key */
  id: string;
  /** 缓存主键，与 id 同值；显式标记以便区分 */
  showID: string;
  /** 后端唯一标识（报文 uniqueID / uniqueId） */
  uniqueID: string;
  /** 业务 trackId（告警匹配用；18.141 全部走此字段，28.9 仅对空走此字段） */
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
  /** 对空 / 对海（is_air_track） */
  isAirTrack?: boolean;
  /** 目标类型（target_type，如目标名称/分类） */
  targetType?: string;
  /** 原始航向（degree，未经对空偏移） */
  course?: number;
  /** 方位角 */
  azimuth?: number;
  /** 距离（range） */
  distance?: number;
  /** 数据源标识 */
  dataSourceId?: string;
  /** 虚兵：航迹符号外框为虚线样式（与资产 `virtual_troop` 一致） */
  isVirtual?: boolean;
  /** 无人机等目标：为 true 时超时阈值用 `trackRendering.trackTimeout.uavSeconds` */
  isUav?: boolean;
  /**
   * 前端在相邻 WS 报文之间累积的**历史采样点** `[lng, lat]`（不含当前 `lng/lat`），存在 **`useTrackStore` 每条 `Track` 上**。
   * 条数上限由 `trackRendering.trackDisplay.maxHistoryPointsPerTrack` 控制；地图在 `maxViewportPoints` 全图顶点预算内才画折线，超预算时**仅不绘制**折线，**不**从本字段删除数据。
   */
  historyTrail?: [number, number][];
  /** 查证图片 data URL（由 image polling 写入） */
  verificationImage?: string;
}

/** 与 `map-icons.PUBLIC_MAP_SVG_FILES` 键一致；含 WS 动态机场 / 无人机 */
export const PUBLIC_MAP_ASSET_TYPES = ["radar", "camera", "tower", "laser", "tdoa", "airport", "drone"] as const;
export type PublicMapAssetType = (typeof PUBLIC_MAP_ASSET_TYPES)[number];

export type AssetStatus = "online" | "offline" | "degraded";

/**
 * 配置文件 / 静态解析用：字段须为 **`PUBLIC_MAP_ASSET_TYPES`** 之一，否则抛错。
 */
export function parseMapAssetTypeStrict(raw: unknown, ctx: string): PublicMapAssetType {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || !(PUBLIC_MAP_ASSET_TYPES as readonly string[]).includes(s)) {
    throw new Error(`${ctx}：必须提供有效 assetType，允许值：${PUBLIC_MAP_ASSET_TYPES.join(", ")}`);
  }
  return s as PublicMapAssetType;
}

/**
 * 将 WS 等动态字符串规范为 `Asset.type`。
 *
 * 注意："tower" 是电侦（电子侦察）专用类型，不要和 camera（光电）混用。
 * 空值或未知类型直接抛错，不回退——回退只会掩盖数据问题。
 */
export function normalizeAssetType(raw: string | undefined | null): PublicMapAssetType {
  const s = String(raw ?? "").toLowerCase().trim();
  if (!s) {
    console.trace("[normalizeAssetType] ✘ 资产类型为空，raw=", JSON.stringify(raw));
    throw new Error("[normalizeAssetType] ✘ 资产类型为空，调用方应确保 asset_type 有值");
  }
  if (s === "dock" || s === "gateway" || s === "airport" || s === "无人机机场") return "airport";
  if (s === "uav" || s === "drone" || s === "无人机") return "drone";
  if ((PUBLIC_MAP_ASSET_TYPES as readonly string[]).includes(s)) return s as PublicMapAssetType;
  /* 不在已知类型列表中 —— 直接抛错 */
  throw new Error(`[normalizeAssetType] ✘ 未知资产类型 "${raw}"，不在已知类型 ${PUBLIC_MAP_ASSET_TYPES.join("/")} 中`);
}

export interface Asset {
  id: string;
  name: string;
  /** 与 `AssetData.asset_type` 一致；决定图层面板专题项与资产列表图标（`PUBLIC_MAP_ASSET_TYPES` / `public/icons`） */
  type: PublicMapAssetType;
  status: AssetStatus;
  /** 敌我属性；未写视为友方（我方） */
  disposition?: ForceDisposition;
  lat: number;
  lng: number;
  range?: number;
  /** 传感器朝向（从正北顺时针，度） */
  heading?: number;
  /** 视场角（度）；雷达为 360 表示全向扫描 */
  fovAngle?: number;
  /** 虚兵：地图图标最外框为虚线；实兵为实线 */
  isVirtual?: boolean;
  /**
   * 雷达：是否绘制最大距离填充环（与 V2 `radar[].showRings` 一致；默认 true）。
   * 由 `app-config.json` 的 `radar` 表写入 `AssetData.properties.showRings` 再经 `adaptAssets` 传入。
   */
  showRings?: boolean;
  /** 为 false 时隐藏该资产在 2D 图上的图标（雷达 `centerIconVisible`、光电根/设备 `centerIconVisible`） */
  centerIconVisible?: boolean;
  /** 为 false 时不绘制资产名称标签（光电名称等） */
  nameLabelVisible?: boolean;
  /** 为 false 时不绘制非雷达的覆盖扇区/圆（光电 `showSector`） */
  showFov?: boolean;
  /** 友方图标主色：由配置 `*.assetFriendlyColor` 解析进 `AssetData.properties.map_friendly_color` 再经 `adaptAssets` 传入 */
  friendlyMapColor?: string;
  /** 友方名称字色：由配置 `*.label.fontColor` 解析进 `AssetData.properties.map_label_font_color` 再经 `adaptAssets` 传入 */
  labelFontColor?: string;
}

export interface Alert {
  id: string;
  severity: "critical" | "warning" | "info";
  message: string;
  timestamp: string;
  trackId?: string;
}

export interface RestrictedZone {
  id: string;
  name: string;
  type: "no-fly" | "warning" | "exercise";
  /** polygon 坐标环 [lng, lat][] */
  coordinates: Array<[number, number]>;
  /** WS `fill_color`；与 `fillOpacity` 在 3D 中合并，缺省用内置 `ZONE_STYLES` */
  fillColor?: string | null;
  /** WS `color`（边线/标签） */
  lineColor?: string | null;
  fillOpacity?: number;
}

/** 图层面板「数据图层」行：仅 `buildDataLayerPanelRows` 返回的项 */
export type DataLayerPanelRow = { id: string; name: string };

export const LYR_TRACKS = "lyr-tracks";
/** 实时无人机位置与任务航线（`useDroneStore` + `drones-maplibre`） */
export const LYR_DRONES = "lyr-drones";
export const LYR_RADAR_COVERAGE = "lyr-radar-coverage";
export const LYR_OPTO_FOV = "lyr-opto-fov";
/** 机场 Dock / 静态机场 图标与名称（Map2D：`opto-asset-icon-airport` + `fov-label-airport`） */
export const LYR_AIRPORT = "lyr-airport";
export const LYR_LASER = "lyr-laser";
export const LYR_TDOA = "lyr-tdoa";
/** 电侦（电子侦察）图标图层；与光电（LYR_OPTO_FOV）为不同类型 */
export const LYR_TOWER = "lyr-tower";
export const LYR_ZONES = "lyr-zones";
/** Map2D 量算/标绘图层分组 id（**不进** `layerVisibility` 初始键；显隐用 `applyLayerPanelVisibilityFromStore` 的 `?? true`） */
export const LYR_MEASURE = "lyr-measure";

/** `useAppStore.layerVisibility` 初始键（图层面板「数据图层」）；缺省在 Map2D 按 `?? true` */
export const ALL_DATA_LAYER_IDS = [
  LYR_TRACKS,
  LYR_DRONES,
  LYR_RADAR_COVERAGE,
  LYR_OPTO_FOV,
  LYR_TOWER,
  LYR_AIRPORT,
  LYR_LASER,
  LYR_TDOA,
  LYR_ZONES,
] as const;

/**
 * 按当前资产列表生成**数据图层**面板行（航迹、按类型出现的专题、限制区）。
 * **光电**（camera）和**电侦**（tower）为不同类型，分别显示。
 */
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
  if (types.has("camera")) {
    rows.push({ id: LYR_OPTO_FOV, name: "光电装备" });
  }
  if (types.has("tower")) {
    rows.push({ id: LYR_TOWER, name: "电侦装备" });
  }
  if (types.has("airport")) {
    rows.push({ id: LYR_AIRPORT, name: "无人机场" });
  }
  if (types.has("laser")) rows.push({ id: LYR_LASER, name: "激光武器" });
  if (types.has("tdoa")) rows.push({ id: LYR_TDOA, name: "TDOA" });
  rows.push({ id: LYR_ZONES, name: "限制区域" });
  return rows;
}
