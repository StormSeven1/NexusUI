/**
 * `app-config.json` 解析：静态内容在 **`radar` / `cameras` / `laserWeapons` / `tdoa`**。
 * 与 WS 合并进 `asset-store` 的底数 **`configAssetBase`** = **`radar` + `cameras.devices` + `laserWeapons.devices` + `tdoa.devices` + `airports.devices` + `drones.devices`**
 *（同 id 后写覆盖先写；见 `mergeConfigAssetBase`）。
 * - **`radar[]` → `AssetData`**：`radar-range-rings-maplibre.ts`；**`cameras.devices[]`**：`optoelectronic-fov-maplibre.ts`；**`airports.devices[]`**：`airport-maplibre.ts`；**`drones.devices[]`**：`drones-maplibre.ts`（**与 TDOA 一样写入资产 store**）。
 * - **激光 / TDOA**：由扇区 bundle 转成 `AssetData`（`asset_type` 为 `laser` / `tdoa`，`properties.center_icon_visible: false`，
 *   地图中心点由 `LaserMaplibre` / `TdoaMaplibre` 绘制；2D 已无中央 `assets-symbol` 点层。
 *
 * - `loadResolvedAppConfig()`：模块内 Promise 单例 fetch + 解析 JSON，不读写 zustand。
 * - `fetchConfigAssetBase()`：仅返回 `configAssetBase`；与动态侧列表的合并由调用方执行 `mergeDynamicAndStaticAssets`。
 * - `Map2D` 专题层仍用 `laserDevicesFromSectorBundle` / `tdoaDevicesFromSectorBundle`（含 `scan` 动画参数）。
 * - **航迹 / 无人机渲染**：同文件下方 `parseTrackRenderingConfig` / `parseDroneMapRenderingConfig`、`getTrackRenderingConfig`、`filterTracksByTimeout`（**仅**定时剔除 store，**不参与**地图顶点预算）等（原独立 `app-config-rendering.ts` 已并入）。
 * - **`resolvedTrackRenderingConfig` / `resolvedDroneMapRenderingConfig` / `resolvedAirportMapConfig`**：
 *   根键 **`trackRendering`**、**`drones`（内嵌原 `droneMapRendering` 字段）**、**`airports`（根级 Dock 显隐 + 扇区块）** 解析后的对象，在 **`loadResolvedAppConfig()`** 写入本模块内存；**兼容**旧根键 **`droneMapRendering`**、**`airportMap` / `airport`**。
 *   **不是** WebSocket 航迹数据、**不是**磁盘缓存；`getTrackRenderingConfig()` 等读的是「当前已加载的 **`app-config.json` 配置**」。
 *   **动态航迹列表**在 **`useTrackStore`**。
 * - **机场 Dock 默认**：**`airports.centerIconVisible` / `airports.centerNameVisible`**（或旧 `airportMap`）→ `getAirportMapDefaults()`；**虚兵/实兵**仍只认 WS 报文。
 */

import type { AssetData } from "@/stores/asset-store";
import { normalizeAssetType, parseMapAssetTypeStrict, type Track } from "@/lib/map-entity-model";
import { parseForceDisposition, type ForceDisposition } from "@/lib/theme-colors";
import { mergeRootAndDeviceVisible } from "@/lib/utils";
import type { AssetDispositionIconAccent } from "@/lib/map-icons";
import { MAP_FRIENDLY_COLOR_PROP } from "@/lib/map-icons";
import { mapRadarPayload, type RadarVisibilityGlobal } from "@/components/map/modules/radar-range-rings-maplibre";
import { mapAirportsDevicesPayload } from "@/components/map/modules/airport-maplibre";
import { mapCamerasDevicesPayload } from "@/components/map/modules/optoelectronic-fov-maplibre";
import { mapDronesDevicesPayload } from "@/components/map/modules/drones-maplibre";
import type { LaserMaplibreLayerVisibility } from "@/components/map/modules/laser-maplibre";
import type { LaserDevice, LaserScanParams } from "@/components/map/modules/laser-maplibre";
import type { TdoaMaplibreLayerVisibility } from "@/components/map/modules/tdoa-maplibre";
import type { TdoaDevice, TdoaScanParams } from "@/components/map/modules/tdoa-maplibre";
function isoNow() {
  return new Date().toISOString();
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function finiteNumberOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** WS 实体 ontology / 业务类型 → `normalizeAssetType` 输入串 */
function wsEntityTypeRaw(r: Record<string, unknown>): string {
  const st = String(r.specificType ?? r.ontologySpecificType ?? "").trim();
  const stu = st.toUpperCase();
  if (stu === "DOCK" || stu === "AIRPORT" || stu === "GATEWAY") return "airport";
  if (stu === "DRONE" || stu === "UAV") return "drone";
  return String(r.asset_type ?? r.type ?? r.specificType ?? "tower");
}

/** WebSocket 等动态载荷中的实体行 → `AssetData`（与配置无关） */
export function mapOneEntityRow(r: Record<string, unknown>): AssetData | null {
  const id = String(r.id ?? r.entityId ?? r.drone_sn ?? r.asset_id ?? r.dock_sn ?? "");
  if (!id) return null;
  const lat = Number(r.lat ?? r.latitude);
  const lng = Number(r.lng ?? r.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const now = isoNow();
  /* 光电扇区朝向：与 `cameras.devices[].bearing` 一致，WS 常发 `bearing` 而非 `heading` */
  const headingDeg = finiteNumberOrNull(r.heading ?? r.bearing ?? r.azimuth);
  const fovDeg = finiteNumberOrNull(r.fov_angle ?? r.fovAngle ?? r.openingDeg ?? r.angle);
  return {
    id,
    name: String(r.name ?? r.entityName ?? id),
    asset_type: normalizeAssetType(wsEntityTypeRaw(r)),
    status: String(r.status ?? "online"),
    disposition: parseForceDisposition(
      r.disposition ??
        (r as Record<string, unknown>).forceDisposition ??
        (r.properties && typeof r.properties === "object"
          ? (r.properties as Record<string, unknown>).disposition
          : undefined),
      "friendly",
    ),
    lat,
    lng,
    range_km: r.range_km != null ? Number(r.range_km) : r.range != null ? Number(r.range) : null,
    heading: headingDeg,
    fov_angle: fovDeg,
    properties: (r.properties as Record<string, unknown> | null) ?? { ...r },
    mission_status: String(r.mission_status ?? "monitoring"),
    assigned_target_id: r.assigned_target_id != null ? String(r.assigned_target_id) : null,
    target_lat: r.target_lat != null ? Number(r.target_lat) : null,
    target_lng: r.target_lng != null ? Number(r.target_lng) : null,
    created_at: String(r.created_at ?? now),
    updated_at: now,
  };
}

export function mapEntitiesPayload(payload: unknown): AssetData[] {
  if (!Array.isArray(payload)) return [];
  const out: AssetData[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const a = mapOneEntityRow(item as Record<string, unknown>);
    if (a) out.push(a);
  }
  return out;
}

/** 从 `AssetData` 行解析敌我：优先顶栏 `disposition`，否则 `properties.disposition` / `forceDisposition`。 */
export function dispositionFromAssetData(a: AssetData): ForceDisposition {
  if (a.disposition != null && String(a.disposition).trim() !== "") {
    return parseForceDisposition(a.disposition, "friendly");
  }
  const p = a.properties;
  if (p && typeof p === "object") {
    const o = p as Record<string, unknown>;
    return parseForceDisposition(o.disposition ?? o.forceDisposition, "friendly");
  }
  return "friendly";
}

function mergeConfigAssetBase(
  camerasAssets: AssetData[],
  radarAssets: AssetData[],
  laserAssets: AssetData[],
  tdoaAssets: AssetData[],
  airportAssets: AssetData[],
  droneAssets: AssetData[],
): AssetData[] {
  const byId = new Map<string, AssetData>();
  for (const c of camerasAssets) {
    if (c.id) byId.set(c.id, c);
  }
  for (const r of radarAssets) {
    if (r.id) byId.set(r.id, r);
  }
  for (const l of laserAssets) {
    if (l.id) byId.set(l.id, l);
  }
  for (const t of tdoaAssets) {
    if (t.id) byId.set(t.id, t);
  }
  for (const ap of airportAssets) {
    if (ap.id) byId.set(ap.id, ap);
  }
  for (const d of droneAssets) {
    if (d.id) byId.set(d.id, d);
  }
  return [...byId.values()];
}

/** 与 V2 `LaserManager`/`TdoaManager` 扫描参数对齐（径向亮带） */
export type AppConfigSectorScan = {
  enabled?: boolean;
  /** 亮带沿半径走一圈的周期 ms（V2 默认 2000）；兼容旧字段 `periodMs` */
  cycleMs?: number;
  periodMs?: number;
  periodSec?: number;
  /** 刷新间隔 ms（激光 V2=90，TDOA V2=100） */
  tickMs?: number;
  /** 同心亮带条数（V2=9） */
  bandCount?: number;
  /** 每条亮带径向厚度（米；激光 V2=1，TDOA V2=2） */
  bandWidthMeters?: number;
};

export type AppConfigSectorDevice = {
  deviceId?: string;
  id?: string;
  name?: string;
  center?: [number, number];
  bearing?: number;
  angle?: number;
  range?: number;
  color?: string;
  opacity?: number;
  showSector?: boolean;
  virtualTroop?: boolean;
  /** 敌我：friendly / hostile / neutral（及中文别名），默认友方 */
  disposition?: string;
  /** 中心名称；显式 boolean 覆盖根 `visibility.centerNameVisible`，不写则继承根级 */
  centerNameVisible?: boolean;
  /** 中心图标；显式 boolean 覆盖根 `visibility.centerIconVisible`，不写则继承根级 */
  centerIconVisible?: boolean;
  /** 必填：在 `laserWeapons` 内须为 `laser`，在 `tdoa` 内须为 `tdoa`（与 `PUBLIC_MAP_SVG_FILES` 键一致） */
  assetType?: string;
  scan?: AppConfigSectorScan;
  /**
   * 与 V2 `LaserSectorOverlayTool` 一致：true 时扫描为「激活 / 间歇」交替（默认 10s 有扫描、3s 仅底色），
   * 间歇期不生成 scan 要素且可停表；非脉冲时仍由 `scan.enabled` 决定是否始终扫描。
   */
  laserPulseActive?: boolean;
  /** 覆盖根级默认；激活阶段时长 ms */
  pulseOnMs?: number;
  /** 覆盖根级默认；间歇阶段时长 ms */
  pulseOffMs?: number;
};

/** 与 V2 `label` 块一致（激光 / TDOA / 光电名称） */
export type AppConfigLabelBlock = {
  fontSize?: number;
  fontColor?: string;
  haloColor?: string;
  haloWidth?: number;
  textOffset?: [number, number];
  textFont?: string[];
};

export type AppConfigSectorBundle = {
  defaultRange?: number;
  defaultSectorRange?: number;
  scan?: AppConfigSectorScan;
  label?: AppConfigLabelBlock;
  sectorBorder?: {
    lineWidth?: number;
    lineColor?: string | null;
    lineDash?: number[];
  };
  visibility?: {
    sectorFillVisible?: boolean;
    sectorScanVisible?: boolean;
    centerIconVisible?: boolean;
    centerNameVisible?: boolean;
  };
  /** 激光脉冲：激活阶段默认 ms（V2 = 10000） */
  laserPulseOnMs?: number;
  /** 激光脉冲：间歇阶段默认 ms（V2 = 3000） */
  laserPulseOffMs?: number;
  devices?: AppConfigSectorDevice[];
};

/* =============================================================================
 * 航迹 / 无人机 / 机场 —— 与 `public/app-config.json` 对应（仅保留**代码里真会读**的字段）
 *
 * | 配置键 | 读取方 |
 * |--------|--------|
 * | `trackRendering` | `track-ws-normalize`（空中航向角）；`useUnifiedWsFeed`（超时轮询、`mergeTrackWsPayloadWithHistory`）；`tracks-maplibre`（`maxViewportPoints` 顶点预算内才画历史折线） |
 * | `drones`（内嵌渲染键） | `parseDroneMapRenderingConfig` → `drone-store`、`drones-maplibre`；兼容旧根键 `droneMapRendering` |
 * | `airports`（根级 Dock 显隐） | `useUnifiedWsFeed` Dock 分支 → `getAirportMapDefaults()`；兼容旧 `airportMap` / `airport` |
 *
 * 兼容：根级仍可出现 V2 的 `trackTypeStyles` / `trackDisplay` / `trackTimeout` 等，解析器会拾取**上表用到的子集**，其余键忽略不写回类型。
 * ============================================================================= */
/** 配置 JSON 对象（排除数组），供 `trackRendering` / `drones` 等块解析 */
function asCfgObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** JSON 原始值 → 有限数字，否则用默认值 `d`（用于 `app-config.json` 解析） */
function num(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** 布尔或 0/1 / "0"/"1"，否则用默认值 */
function bool(v: unknown, d: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1") return true;
  if (v === 0 || v === "0") return false;
  return d;
}

/** 非空字符串，否则用默认值 */
function str(v: unknown, d: string): string {
  return typeof v === "string" && v.trim() ? v : d;
}

/** Dock / 机场：仅**中心图标 / 名称**两类默认显隐（根键 `airportMap`，兼容 `airport`）；虚兵由报文决定 */
export type AppConfigAirportMap = {
  centerIconVisible: boolean;
  centerNameVisible: boolean;
};

export const DEFAULT_AIRPORT_MAP: AppConfigAirportMap = {
  centerIconVisible: true,
  centerNameVisible: true,
};

let resolvedAirportMapConfig: AppConfigAirportMap = { ...DEFAULT_AIRPORT_MAP };

function applyResolvedAirportConfig(a: AppConfigAirportMap) {
  resolvedAirportMapConfig = a;
}

export function getAirportMapDefaults(): AppConfigAirportMap {
  return resolvedAirportMapConfig;
}

function parseAirportMapConfig(root: Record<string, unknown>): AppConfigAirportMap {
  const ap = asCfgObject(root.airports);
  const legacy = asCfgObject(root.airportMap) ?? asCfgObject(root.airport);
  const o = ap ?? legacy;
  const b = DEFAULT_AIRPORT_MAP;
  if (!o) return { ...b };
  return {
    centerIconVisible: o.centerIconVisible !== false,
    centerNameVisible: o.centerNameVisible !== false,
  };
}

/** 按 `sea` / `air` / `underwater` 控制 `tracks-maplibre` 里符号缩放与名称标签颜色/字号（友方符号填充参考 `idColor`；敌/中见 `factory.assetIcons`） */
export type AppConfigTrackTypeStyle = {
  idColor: string;
  pointSize: number;
  idSize: number;
};

export type AppConfigTrackRendering = {
  trackTypeStyles: {
    sea: AppConfigTrackTypeStyle;
    air: AppConfigTrackTypeStyle;
    underwater: AppConfigTrackTypeStyle;
  };
  /** 仅 `showTrackId`、`maxViewportPoints` 被读取；其余旧 JSON 字段若存在会被忽略 */
  trackDisplay: {
    showTrackId: boolean;
    maxViewportPoints: number;
  };
  trackTimeout: {
    enabled: boolean;
    seconds: number;
    uavSeconds: number;
    /** 无新 WS 包时仍定时按 `lastUpdate` 从 store 剔除航迹的轮询间隔（毫秒） */
    checkIntervalMs: number;
  };
  /** 空中图标相对服务端航向的附加角（度）；`track-ws-normalize` */
  airIconHeadingOffsetDeg: number;
  /** 空中无报文航向时的默认原始航向（度）；`track-ws-normalize` */
  airDefaultCourseDeg: number;
};

/** `drones-maplibre` + `drone-store` 实际读取的子集（根键 **`drones`**，兼容旧 `droneMapRendering`；根级 `drone` 仅合并 `maxFovRange` / `horizontalFov`） */
export type AppConfigDroneMapRendering = {
  maxFovRange: number;
  horizontalFov: number;
  showFovSector: boolean;
  maxHistoryPoints: number;
  timeoutSeconds: number;
  timeoutCheckIntervalMs: number;
  highFreqPositionMaxAgeMs: number;
  showHistoryTrail: boolean;
  showPlannedRoute: boolean;
  showSnLabel: boolean;
  routeLineColor: string;
  routeLineWidth: number;
  routeLineOpacity: number;
  fovFillColor: string;
  fovFillOpacity: number;
  fovLineColor: string;
  /** 解析自 `drones.label.fontColor`：友方无人机资产符号预染 */
  mapFriendlyColor?: string;
};

const DEFAULT_TYPE_STYLE: AppConfigTrackTypeStyle = {
  idColor: "#FFFFFF",
  pointSize: 2,
  idSize: 8,
};

export const DEFAULT_TRACK_RENDERING: AppConfigTrackRendering = {
  trackTypeStyles: {
    sea: { ...DEFAULT_TYPE_STYLE },
    air: {
      idColor: "#FFFF00",
      pointSize: 2,
      idSize: 8,
    },
    underwater: { ...DEFAULT_TYPE_STYLE },
  },
  trackDisplay: {
    showTrackId: true,
    maxViewportPoints: 2000,
  },
  trackTimeout: {
    enabled: true,
    seconds: 10,
    uavSeconds: 60,
    checkIntervalMs: 2000,
  },
  airIconHeadingOffsetDeg: 45,
  airDefaultCourseDeg: 45,
};

export const DEFAULT_DRONE_MAP_RENDERING: AppConfigDroneMapRendering = {
  maxFovRange: 3000,
  horizontalFov: 30,
  showFovSector: false,
  maxHistoryPoints: 100,
  timeoutSeconds: 30,
  timeoutCheckIntervalMs: 2000,
  highFreqPositionMaxAgeMs: 2500,
  showHistoryTrail: true,
  showPlannedRoute: true,
  showSnLabel: true,
  routeLineColor: "#38bdf8",
  routeLineWidth: 2,
  routeLineOpacity: 0.75,
  fovFillColor: "#38bdf8",
  fovFillOpacity: 0.12,
  fovLineColor: "#7dd3fc",
};

function parseTypeStyle(o: unknown, base: AppConfigTrackTypeStyle): AppConfigTrackTypeStyle {
  const r = asCfgObject(o);
  if (!r) return { ...base };
  return {
    idColor: str(r.idColor, base.idColor),
    pointSize: num(r.pointSize, base.pointSize),
    idSize: num(r.idSize, base.idSize),
  };
}

/** 解析根对象上的 `trackRendering`，或 V2 根级 `trackTypeStyles` / `trackDisplay` / `trackTimeout` / 航向角键 */
export function parseTrackRenderingConfig(root: Record<string, unknown>): AppConfigTrackRendering {
  let tr = asCfgObject(root.trackRendering);
  if (!tr) {
    const legacy =
      root.trackTypeStyles != null ||
      root.trackDisplay != null ||
      root.trackTimeout != null ||
      root.airIconHeadingOffsetDeg != null ||
      root.airDefaultCourseDeg != null;
    if (legacy) {
      tr = {
        trackTypeStyles: root.trackTypeStyles,
        trackDisplay: root.trackDisplay,
        trackTimeout: root.trackTimeout,
        airIconHeadingOffsetDeg: root.airIconHeadingOffsetDeg,
        airDefaultCourseDeg: root.airDefaultCourseDeg,
      } as Record<string, unknown>;
    }
  }
  if (!tr) return { ...DEFAULT_TRACK_RENDERING };

  const tts = asCfgObject(tr.trackTypeStyles);
  const td = asCfgObject(tr.trackDisplay);
  const tt = asCfgObject(tr.trackTimeout);

  const base = DEFAULT_TRACK_RENDERING;
  return {
    trackTypeStyles: {
      sea: parseTypeStyle(tts?.sea, base.trackTypeStyles.sea),
      air: parseTypeStyle(tts?.air, base.trackTypeStyles.air),
      underwater: parseTypeStyle(tts?.underwater, base.trackTypeStyles.underwater),
    },
    trackDisplay: {
      showTrackId: bool(td?.showTrackId, base.trackDisplay.showTrackId),
      maxViewportPoints: num(td?.maxViewportPoints, base.trackDisplay.maxViewportPoints),
    },
    trackTimeout: {
      enabled: bool(tt?.enabled, base.trackTimeout.enabled),
      seconds: num(tt?.seconds, base.trackTimeout.seconds),
      uavSeconds: num(tt?.uavSeconds, base.trackTimeout.uavSeconds),
      checkIntervalMs: num(tt?.checkIntervalMs, base.trackTimeout.checkIntervalMs),
    },
    airIconHeadingOffsetDeg: num(tr.airIconHeadingOffsetDeg, base.airIconHeadingOffsetDeg),
    airDefaultCourseDeg: num(tr.airDefaultCourseDeg, base.airDefaultCourseDeg),
  };
}

const DRONE_BUNDLE_NESTED_KEYS = new Set([
  "devices",
  "visibility",
  "label",
  "sectorBorder",
  "defaultRange",
  "defaultSectorRange",
  "scan",
  "laserPulseOnMs",
  "laserPulseOffMs",
]);

/** 从根键 `drones` 抽出与 `AppConfigDroneMapRendering` 同形的渲染字段（排除 devices/label/visibility 等扇区块） */
function droneRenderingPickFromDronesRoot(dronesRoot: Record<string, unknown>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dronesRoot)) {
    if (DRONE_BUNDLE_NESTED_KEYS.has(k)) continue;
    if (k === "centerIconVisible" || k === "centerNameVisible") continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** 解析 `drones` 内嵌渲染块；兼容旧根键 `droneMapRendering`；`drone.*` 作补充 */
export function parseDroneMapRenderingConfig(root: Record<string, unknown>): AppConfigDroneMapRendering {
  const dBundle = asCfgObject(root.drones);
  const dm =
    (dBundle ? droneRenderingPickFromDronesRoot(dBundle) : null) ??
    asCfgObject(root.droneMapRendering) ??
    ({} as Record<string, unknown>);
  const legacyDrone = asCfgObject(root.drone);
  const base = DEFAULT_DRONE_MAP_RENDERING;

  const maxFov = num(dm?.maxFovRange ?? legacyDrone?.maxFovRange, base.maxFovRange);
  const hFov = num(dm?.horizontalFov ?? legacyDrone?.horizontalFov, base.horizontalFov);

  const lbl = dBundle?.label !== undefined && dBundle.label !== null && typeof dBundle.label === "object"
    ? (dBundle.label as AppConfigLabelBlock)
    : undefined;
  const mapFriendlyColor =
    typeof lbl?.fontColor === "string" && lbl.fontColor.trim() ? lbl.fontColor.trim() : undefined;

  if (!dBundle && !asCfgObject(root.droneMapRendering) && !legacyDrone) {
    return { ...base, ...(mapFriendlyColor ? { mapFriendlyColor } : {}) };
  }

  return {
    maxFovRange: maxFov,
    horizontalFov: hFov,
    showFovSector: bool(dm?.showFovSector, base.showFovSector),
    maxHistoryPoints: num(dm?.maxHistoryPoints, base.maxHistoryPoints),
    timeoutSeconds: num(dm?.timeoutSeconds, base.timeoutSeconds),
    timeoutCheckIntervalMs: num(dm?.timeoutCheckIntervalMs, base.timeoutCheckIntervalMs),
    highFreqPositionMaxAgeMs: num(dm?.highFreqPositionMaxAgeMs, base.highFreqPositionMaxAgeMs),
    showHistoryTrail: bool(dm?.showHistoryTrail, base.showHistoryTrail),
    showPlannedRoute: bool(dm?.showPlannedRoute, base.showPlannedRoute),
    showSnLabel: bool(dm?.showSnLabel, base.showSnLabel),
    routeLineColor: str(dm?.routeLineColor, base.routeLineColor),
    routeLineWidth: num(dm?.routeLineWidth, base.routeLineWidth),
    routeLineOpacity: num(dm?.routeLineOpacity, base.routeLineOpacity),
    fovFillColor: str(dm?.fovFillColor, base.fovFillColor),
    fovFillOpacity: num(dm?.fovFillOpacity, base.fovFillOpacity),
    fovLineColor: str(dm?.fovLineColor, base.fovLineColor),
    ...(mapFriendlyColor ? { mapFriendlyColor } : {}),
  };
}

/** `loadResolvedAppConfig` 写入的 `trackRendering` / `drones` 内嵌渲染块解析结果（静态配置，非航迹 store） */
let resolvedTrackRenderingConfig: AppConfigTrackRendering = { ...DEFAULT_TRACK_RENDERING };
let resolvedDroneMapRenderingConfig: AppConfigDroneMapRendering = { ...DEFAULT_DRONE_MAP_RENDERING };

function applyResolvedRenderingConfigs(track: AppConfigTrackRendering, drone: AppConfigDroneMapRendering) {
  resolvedTrackRenderingConfig = track;
  resolvedDroneMapRenderingConfig = drone;
}

export function getTrackRenderingConfig(): AppConfigTrackRendering {
  return resolvedTrackRenderingConfig;
}

export function getDroneMapRenderingConfig(): AppConfigDroneMapRendering {
  return resolvedDroneMapRenderingConfig;
}

/**
 * 仅用于 **`useUnifiedWsFeed` 定时剔除**：按 `Track.lastUpdate`（ISO）与当前时间比较；
 * `isUav===true` 用 `trackTimeout.uavSeconds`，否则 `seconds`。**勿在 WS 入站写 store 时调用**。
 */
export function filterTracksByTimeout(tracks: Track[]): Track[] {
  const cfg = getTrackRenderingConfig();
  if (!cfg.trackTimeout.enabled) return tracks;
  const now = Date.now();
  return tracks.filter((t) => {
    const lu = Date.parse(t.lastUpdate);
    if (!Number.isFinite(lu)) return true;
    const sec = t.isUav === true ? cfg.trackTimeout.uavSeconds : cfg.trackTimeout.seconds;
    const ms = Math.max(1, sec) * 1000;
    return now - lu <= ms;
  });
}

export type ResolvedAppConfig = {
  /** 与 WS 合并前的配置静态实体：见 `mergeConfigAssetBase`（含 `airports` / `drones`） */
  configAssetBase: AssetData[];
  /** 根键 `cameras`：扇区边线、填充/边线显隐等（与 `configAssetBase` 里光电行配套） */
  cameras: AppConfigSectorBundle | null;
  /** 根键 `airports`：与 cameras 同形子集 + Dock 默认显隐；静态 `devices` 并入 `configAssetBase` */
  airports: AppConfigSectorBundle | null;
  laserWeapons: AppConfigSectorBundle | null;
  tdoa: AppConfigSectorBundle | null;
  /** 根键 `drones`：与 cameras 同形的 `label` / `visibility` / `devices` 等；**静态站名/字号**等见 `DronesMaplibre.applyDronesSectorLabelStyle` */
  drones: AppConfigSectorBundle | null;
  /** 根键 `factory.assetIcons`：仅 **敌方 / 中立** 覆盖默认 force 色 */
  assetDispositionIconAccent: AssetDispositionIconAccent;
  /** 根键 `trackRendering`（或 V2 根级 `trackTypeStyles` / `trackDisplay` / `trackTimeout`）：见文件头表格 */
  trackRendering: AppConfigTrackRendering;
};

function mergeProperties(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const out = { ...(a ?? {}), ...(b ?? {}) };
  return Object.keys(out).length ? out : null;
}

function parseAssetDispositionIconAccent(root: Record<string, unknown>): AssetDispositionIconAccent {
  const factory = asRecord(root.factory);
  const ai = factory ? asRecord(factory.assetIcons) : null;
  return {
    hostileIcon: typeof ai?.hostile === "string" ? ai.hostile : undefined,
    neutralIcon: typeof ai?.neutral === "string" ? ai.neutral : undefined,
  };
}

/**
 * 合并静态与 WS 时：`heading` / `fov_angle` / `range_km` 若动态侧为 `null`（载荷缺字段），保留静态值，避免光电扇区朝向被覆盖丢失。
 */
function mergeNullableNumericPreferLive(
  live: number | null | undefined,
  prev: number | null,
): number | null {
  if (live != null && Number.isFinite(Number(live))) return Number(live);
  return prev;
}

/** 先铺 `configAssetBase`（静态配置解析结果），再按 id 合并动态侧列表（如 `useAssetStore.assets`，来源可为 WS 等）；同 id 以动态侧字段覆盖；`heading`/`fov_angle`/`range_km` 仅在有有限数值时覆盖静态 */
export function mergeDynamicAndStaticAssets(configAssetBase: AssetData[], fromWs: AssetData[]): AssetData[] {
  const byId = new Map<string, AssetData>();
  for (const s of configAssetBase) {
    if (!s.id) continue;
    byId.set(s.id, {
      ...s,
      properties: mergeProperties(s.properties, { data_source: "static" as const }),
    });
  }
  for (const w of fromWs) {
    if (!w.id) continue;
    const prev = byId.get(w.id);
    if (prev) {
      byId.set(w.id, {
        ...prev,
        ...w,
        heading: mergeNullableNumericPreferLive(w.heading, prev.heading),
        fov_angle: mergeNullableNumericPreferLive(w.fov_angle, prev.fov_angle),
        range_km: mergeNullableNumericPreferLive(w.range_km, prev.range_km),
        properties: mergeProperties(prev.properties, mergeProperties(w.properties, { data_source: "live" as const })),
        disposition:
          w.disposition !== undefined && w.disposition !== null
            ? parseForceDisposition(w.disposition, prev.disposition ?? "friendly")
            : prev.disposition ?? "friendly",
        updated_at: w.updated_at,
      });
    } else {
      byId.set(w.id, {
        ...w,
        properties: mergeProperties(w.properties, { data_source: "live" as const }),
        disposition:
          w.disposition !== undefined && w.disposition !== null
            ? parseForceDisposition(w.disposition, "friendly")
            : parseForceDisposition(
                w.properties && typeof w.properties === "object"
                  ? (w.properties as Record<string, unknown>).disposition
                  : undefined,
                "friendly",
              ),
      });
    }
  }
  return [...byId.values()];
}

/** `radar.visibility` 或与 cameras 同形的 visibility 对象 → 全局默认 */
function visibilityRecordToRadarGlobals(vis: Record<string, unknown> | null | undefined): RadarVisibilityGlobal | undefined {
  if (!vis) return undefined;
  const o: RadarVisibilityGlobal = {};
  if ("centerNameVisible" in vis) o.centerNameVisible = vis.centerNameVisible !== false;
  if ("centerIconVisible" in vis) o.centerIconVisible = vis.centerIconVisible !== false;
  return Object.keys(o).length ? o : undefined;
}

/** 优先读 `radar.visibility`（与 cameras 阵型一致）；否则兼容旧版根级 `radarVisibility` */
function parseRadarVisibilityGlobal(root: Record<string, unknown>): RadarVisibilityGlobal | undefined {
  const radar = root.radar;
  const bundle = asRecord(radar);
  if (bundle && bundle.visibility != null && typeof bundle.visibility === "object") {
    return visibilityRecordToRadarGlobals(asRecord(bundle.visibility));
  }
  const rv = asRecord(root.radarVisibility);
  return visibilityRecordToRadarGlobals(rv);
}

function parseSectorBundle(raw: unknown): AppConfigSectorBundle | null {
  const o = asRecord(raw);
  if (!o) return null;
  const dr =
    o.defaultRange != null
      ? Number(o.defaultRange)
      : o.defaultSectorRange != null
        ? Number(o.defaultSectorRange)
        : undefined;
  return {
    defaultRange: dr,
    scan:
      o.scan !== undefined && o.scan !== null && typeof o.scan === "object"
        ? (o.scan as AppConfigSectorScan)
        : undefined,
    sectorBorder: asRecord(o.sectorBorder) as AppConfigSectorBundle["sectorBorder"],
    label:
      o.label !== undefined && o.label !== null && typeof o.label === "object"
        ? (o.label as AppConfigLabelBlock)
        : undefined,
    visibility: asRecord(o.visibility) as AppConfigSectorBundle["visibility"],
    devices: Array.isArray(o.devices) ? (o.devices as AppConfigSectorDevice[]) : undefined,
    laserPulseOnMs: Number.isFinite(Number(o.laserPulseOnMs)) ? Number(o.laserPulseOnMs) : undefined,
    laserPulseOffMs: Number.isFinite(Number(o.laserPulseOffMs)) ? Number(o.laserPulseOffMs) : undefined,
  };
}

function parseFullAppConfig(json: unknown): ResolvedAppConfig {
  const root = asRecord(json) ?? {};
  const camerasBundle = parseSectorBundle(root.cameras);
  const airportsBundle = parseSectorBundle(root.airports);
  const laserWeapons = parseSectorBundle(root.laserWeapons);
  const tdoaBundle = parseSectorBundle(root.tdoa);
  const dronesBundle = parseSectorBundle(root.drones);
  const fromCameras = mapCamerasDevicesPayload(root.cameras);
  const fromRadar = mapRadarPayload(root.radar, parseRadarVisibilityGlobal(root));
  const fromAirports = mapAirportsDevicesPayload(root.airports);
  const fromDrones = mapDronesDevicesPayload(root.drones);
  const configAssetBase = mergeConfigAssetBase(
    fromCameras,
    fromRadar,
    laserBundleToStaticAssets(laserWeapons),
    tdoaBundleToStaticAssets(tdoaBundle),
    fromAirports,
    fromDrones,
  );

  const airportMap = parseAirportMapConfig(root);
  applyResolvedAirportConfig(airportMap);
  const trackRendering = parseTrackRenderingConfig(root);
  const droneMapRendering = parseDroneMapRenderingConfig(root);
  applyResolvedRenderingConfigs(trackRendering, droneMapRendering);

  return {
    configAssetBase,
    cameras: camerasBundle,
    airports: airportsBundle,
    laserWeapons,
    tdoa: tdoaBundle,
    drones: dronesBundle,
    assetDispositionIconAccent: parseAssetDispositionIconAccent(root),
    trackRendering,
  };
}

/** 扇区描边：`lineWidth` 经 `Number` 后 ≤0 或 NaN 视为关闭（兼容 JSON 里字符串 `"0"`） */
export function resolveSectorBorderEmit(b: AppConfigSectorBundle | null): boolean {
  const w = Number(b?.sectorBorder?.lineWidth);
  return Number.isFinite(w) && w > 0;
}

/** 供 `LaserMaplibre.setSectorBorder`：与 V2 `sectorBorder` 一致；`lineColorFixed == null` 时与扇区设备色一致 */
export function laserSectorBorderFromBundle(b: AppConfigSectorBundle | null): {
  emit: boolean;
  lineWidth: number;
  lineColorFixed: string | null;
  lineDash: number[];
} {
  const emit = resolveSectorBorderEmit(b);
  const sb = b?.sectorBorder;
  const rawColor = sb?.lineColor;
  const lineColorFixed =
    rawColor === undefined || rawColor === null
      ? null
      : typeof rawColor === "string"
        ? rawColor
        : null;
  const lineDash = Array.isArray(sb?.lineDash)
    ? (sb!.lineDash as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n))
    : [];
  const lw = emit ? Math.max(0.25, Number(sb?.lineWidth) || 1) : 0;
  return { emit, lineWidth: lw, lineColorFixed, lineDash };
}

/** 供 `LaserMaplibre.setLabelStyle`：与 V2 `label` 块一致 */
export function laserLabelStyleFromBundle(b: AppConfigSectorBundle | null): {
  textColor: string;
  haloColor: string;
  haloWidth: number;
  fontSize: number;
  textOffset: [number, number];
  textFont: string[];
} {
  const lbl = b?.label ?? {};
  const off = lbl.textOffset;
  return {
    textColor: typeof lbl.fontColor === "string" ? lbl.fontColor : "#FFFFFF",
    haloColor: typeof lbl.haloColor === "string" ? lbl.haloColor : "#000000",
    haloWidth: Number(lbl.haloWidth) >= 0 ? Number(lbl.haloWidth) : 2,
    fontSize: Number(lbl.fontSize) > 0 ? Number(lbl.fontSize) : 13,
    textOffset:
      Array.isArray(off) && off.length >= 2 && Number.isFinite(Number(off[0])) && Number.isFinite(Number(off[1]))
        ? [Number(off[0]), Number(off[1])]
        : [0, 1.25],
    textFont: Array.isArray(lbl.textFont) && lbl.textFont.length ? lbl.textFont.map(String) : ["Open Sans Semibold", "Arial Unicode MS Bold"],
  };
}

/** TDOA 扇区边线与激光相同规则 */
export function tdoaSectorBorderFromBundle(b: AppConfigSectorBundle | null) {
  return laserSectorBorderFromBundle(b);
}

export function tdoaLabelStyleFromBundle(b: AppConfigSectorBundle | null) {
  return laserLabelStyleFromBundle(b);
}

/**
 * 是否存在任一设备在合并后仍为 true（用于图层总开关；`b == null` 视为不限制，默认 true）。
 */
export function sectorBundleAnyMergedVisible(
  b: AppConfigSectorBundle | null,
  key: "centerNameVisible" | "centerIconVisible",
): boolean {
  if (!b) return true;
  const root = b.visibility?.[key];
  const devs = b.devices ?? [];
  if (!devs.length) return root !== false;
  return devs.some((d) => mergeRootAndDeviceVisible(root, d[key]));
}

export function sectorBundleToLaserLayerVis(b: AppConfigSectorBundle | null): Partial<LaserMaplibreLayerVisibility> {
  if (!b) return {};
  const v = b.visibility ?? {};
  const borderEmit = resolveSectorBorderEmit(b);
  return {
    fillVisible: v.sectorFillVisible !== false,
    scanFillVisible: v.sectorScanVisible !== false,
    lineVisible: borderEmit && v.sectorFillVisible !== false,
    centerVisible: sectorBundleAnyMergedVisible(b, "centerIconVisible"),
    labelVisible: sectorBundleAnyMergedVisible(b, "centerNameVisible"),
  };
}

export function sectorBundleToTdoaLayerVis(b: AppConfigSectorBundle | null): Partial<TdoaMaplibreLayerVisibility> {
  if (!b) return {};
  const v = b.visibility ?? {};
  const borderEmit = resolveSectorBorderEmit(b);
  return {
    fillVisible: v.sectorFillVisible !== false,
    scanFillVisible: v.sectorScanVisible !== false,
    lineVisible: borderEmit && v.sectorFillVisible !== false,
    centerVisible: sectorBundleAnyMergedVisible(b, "centerIconVisible"),
    labelVisible: sectorBundleAnyMergedVisible(b, "centerNameVisible"),
  };
}

function sectorDeviceToSectorGeometry(
  d: AppConfigSectorDevice,
  defaultRangeM: number,
  bundle: AppConfigSectorBundle | null,
): Omit<LaserDevice, "scan"> | null {
  const id = String(d.deviceId ?? d.id ?? "");
  const c = d.center;
  if (!id || !Array.isArray(c) || c.length < 2) return null;
  const lng = Number(c[0]);
  const lat = Number(c[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const laserPulse = d.laserPulseActive === true;
  if (d.showSector === false && !laserPulse) return null;
  const rangeM = Number.isFinite(Number(d.range)) ? Number(d.range) : defaultRangeM;
  const bearing = Number.isFinite(Number(d.bearing)) ? Number(d.bearing) : 0;
  const angle = Number.isFinite(Number(d.angle)) ? Number(d.angle) : 60;
  return {
    id,
    name: d.name ? String(d.name) : id,
    lng,
    lat,
    rangeKm: rangeM / 1000,
    headingDeg: bearing,
    openingDeg: angle,
    color: typeof d.color === "string" ? d.color : undefined,
    fillOpacity: typeof d.opacity === "number" ? d.opacity : undefined,
    virtual: !!d.virtualTroop,
    disposition: parseForceDisposition(d.disposition, "friendly"),
    centerNameVisible: mergeRootAndDeviceVisible(bundle?.visibility?.centerNameVisible, d.centerNameVisible),
    centerIconVisible: mergeRootAndDeviceVisible(bundle?.visibility?.centerIconVisible, d.centerIconVisible),
  };
}

function resolveCycleMs(bs: AppConfigSectorScan | undefined, ds: Record<string, unknown>): number {
  const v =
    ds.cycleMs ??
    ds.periodMs ??
    bs?.cycleMs ??
    bs?.periodMs ??
    (bs?.periodSec != null ? Number(bs.periodSec) * 1000 : undefined) ??
    (ds.periodSec != null ? Number(ds.periodSec) * 1000 : undefined);
  const n = Number(v);
  return Math.max(400, Number.isFinite(n) ? n : 2000);
}

function buildLaserScanParams(
  bundle: AppConfigSectorBundle | null,
  row: AppConfigSectorDevice,
  sectorScanVisible: boolean,
  defaults: { tickMs: number; bandCount: number; bandWidthMeters: number },
): LaserScanParams {
  const bs = bundle?.scan;
  const ds = asRecord(row.scan as unknown) ?? {};
  if (!sectorScanVisible) {
    return {
      enabled: false,
      cycleMs: 2000,
      tickMs: defaults.tickMs,
      bandCount: defaults.bandCount,
      bandWidthMeters: defaults.bandWidthMeters,
    };
  }
  if (bs?.enabled === false) {
    return {
      enabled: false,
      cycleMs: 2000,
      tickMs: defaults.tickMs,
      bandCount: defaults.bandCount,
      bandWidthMeters: defaults.bandWidthMeters,
    };
  }
  if (ds.enabled === false) {
    return {
      enabled: false,
      cycleMs: 2000,
      tickMs: defaults.tickMs,
      bandCount: defaults.bandCount,
      bandWidthMeters: defaults.bandWidthMeters,
    };
  }

  const cycleMs = resolveCycleMs(bs, ds);
  const tickMs = Math.max(
    16,
    Number(ds.tickMs ?? bs?.tickMs ?? defaults.tickMs) || defaults.tickMs,
  );
  const bandCount = Math.max(
    1,
    Math.min(24, Math.floor(Number(ds.bandCount ?? bs?.bandCount ?? defaults.bandCount) || defaults.bandCount)),
  );
  const bandWidthMeters = Math.max(
    0.2,
    Number(ds.bandWidthMeters ?? bs?.bandWidthMeters ?? defaults.bandWidthMeters) || defaults.bandWidthMeters,
  );

  return { enabled: true, cycleMs, tickMs, bandCount, bandWidthMeters };
}

export function laserDevicesFromSectorBundle(bundle: AppConfigSectorBundle | null): LaserDevice[] {
  if (!bundle?.devices?.length) return [];
  const defM = Number.isFinite(Number(bundle.defaultRange)) ? Number(bundle.defaultRange) : 12_000;
  const sectorScanVisible = bundle.visibility?.sectorScanVisible !== false;
  const out: LaserDevice[] = [];
  for (const raw of bundle.devices) {
    const sid = String(raw.deviceId ?? raw.id ?? "");
    if (!sid) continue;
    const laserAt = parseMapAssetTypeStrict(raw.assetType, `laserWeapons.devices[${sid}].assetType`);
    if (laserAt !== "laser") {
      throw new Error(`laserWeapons.devices[${sid}].assetType 必须为 laser`);
    }
    const base = sectorDeviceToSectorGeometry(raw, defM, bundle);
    if (!base) continue;
    const scan = buildLaserScanParams(bundle, raw, sectorScanVisible, {
      tickMs: 90,
      bandCount: 9,
      bandWidthMeters: 1,
    });
    const rootOn = bundle?.laserPulseOnMs;
    const rootOff = bundle?.laserPulseOffMs;
    const pulseOnMs = Number.isFinite(Number(raw.pulseOnMs))
      ? Number(raw.pulseOnMs)
      : Number.isFinite(Number(rootOn))
        ? Number(rootOn)
        : undefined;
    const pulseOffMs = Number.isFinite(Number(raw.pulseOffMs))
      ? Number(raw.pulseOffMs)
      : Number.isFinite(Number(rootOff))
        ? Number(rootOff)
        : undefined;
    out.push({
      ...base,
      scan,
      laserPulseActive: raw.laserPulseActive === true,
      ...(pulseOnMs !== undefined ? { pulseOnMs } : {}),
      ...(pulseOffMs !== undefined ? { pulseOffMs } : {}),
    });
  }
  return out;
}

function buildTdoaScanParams(
  bundle: AppConfigSectorBundle | null,
  row: AppConfigSectorDevice,
  sectorScanVisible: boolean,
): TdoaScanParams {
  return buildLaserScanParams(bundle, row, sectorScanVisible, {
    tickMs: 100,
    bandCount: 9,
    bandWidthMeters: 2,
  }) as TdoaScanParams;
}

export function tdoaDevicesFromSectorBundle(bundle: AppConfigSectorBundle | null): TdoaDevice[] {
  if (!bundle?.devices?.length) return [];
  const defM = Number.isFinite(Number(bundle.defaultRange))
    ? Number(bundle.defaultRange)
    : Number.isFinite(Number(bundle.defaultSectorRange))
      ? Number(bundle.defaultSectorRange)
      : 12_000;
  const sectorScanVisible = bundle.visibility?.sectorScanVisible !== false;
  const out: TdoaDevice[] = [];
  for (const raw of bundle.devices) {
    const sid = String(raw.deviceId ?? raw.id ?? "");
    if (!sid) continue;
    const tat = parseMapAssetTypeStrict(raw.assetType, `tdoa.devices[${sid}].assetType`);
    if (tat !== "tdoa") {
      throw new Error(`tdoa.devices[${sid}].assetType 必须为 tdoa`);
    }
    const base = sectorDeviceToSectorGeometry(raw, defM, bundle);
    if (!base) continue;
    const scan = buildTdoaScanParams(bundle, raw, sectorScanVisible);
    out.push({ ...base, scan });
  }
  return out;
}

/** `laserWeapons` → `asset-store` 静态行；中心点仅专题层绘制，仅用于列表/统一实体模型 */
function sectorBundleFriendlyTint(bundle: AppConfigSectorBundle | null | undefined): string | undefined {
  const c = bundle?.label?.fontColor;
  return typeof c === "string" && c.trim() ? c.trim() : undefined;
}

function laserBundleToStaticAssets(bundle: AppConfigSectorBundle | null): AssetData[] {
  const devices = laserDevicesFromSectorBundle(bundle);
  const now = isoNow();
  const mfc = sectorBundleFriendlyTint(bundle);
  return devices.map((d) => ({
    id: d.id,
    name: d.name ?? d.id,
    asset_type: "laser",
    status: "online",
    disposition: d.disposition ?? "friendly",
    lat: d.lat,
    lng: d.lng,
    range_km: d.rangeKm,
    heading: d.headingDeg,
    fov_angle: d.openingDeg,
    properties: {
      config_kind: "laser",
      center_icon_visible: false,
      center_name_visible: d.centerNameVisible !== false,
      virtual_troop: d.virtual === true,
      ...(mfc ? { [MAP_FRIENDLY_COLOR_PROP]: mfc } : {}),
    },
    mission_status: "monitoring",
    assigned_target_id: null,
    target_lat: null,
    target_lng: null,
    created_at: now,
    updated_at: now,
  }));
}

function tdoaBundleToStaticAssets(bundle: AppConfigSectorBundle | null): AssetData[] {
  const devices = tdoaDevicesFromSectorBundle(bundle);
  const now = isoNow();
  const mfc = sectorBundleFriendlyTint(bundle);
  return devices.map((d) => ({
    id: d.id,
    name: d.name ?? d.id,
    asset_type: "tdoa",
    status: "online",
    disposition: d.disposition ?? "friendly",
    lat: d.lat,
    lng: d.lng,
    range_km: d.rangeKm,
    heading: d.headingDeg,
    fov_angle: d.openingDeg,
    properties: {
      config_kind: "tdoa",
      center_icon_visible: false,
      center_name_visible: d.centerNameVisible !== false,
      virtual_troop: d.virtual === true,
      ...(mfc ? { [MAP_FRIENDLY_COLOR_PROP]: mfc } : {}),
    },
    mission_status: "monitoring",
    assigned_target_id: null,
    target_lat: null,
    target_lng: null,
    created_at: now,
    updated_at: now,
  }));
}

const DEFAULT_RELATIVE_URL = "/app-config.json";

let resolvedConfigPromise: Promise<ResolvedAppConfig> | null = null;

function configUrl(customUrl?: string): string {
  return (
    customUrl ||
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_APP_CONFIG_URL) ||
    DEFAULT_RELATIVE_URL
  );
}

/** Fetch + 解析 `app-config.json`（模块内单例 Promise）；返回 `configAssetBase` / `cameras` / `laserWeapons` / `tdoa` 等，不与 `useAssetStore` 合并 */
export async function loadResolvedAppConfig(customUrl?: string): Promise<ResolvedAppConfig> {
  const empty: ResolvedAppConfig = {
    configAssetBase: [],
    cameras: null,
    airports: null,
    laserWeapons: null,
    tdoa: null,
    drones: null,
    assetDispositionIconAccent: {},
    trackRendering: { ...DEFAULT_TRACK_RENDERING },
  };
  if (typeof window === "undefined") return empty;
  const url = configUrl(customUrl);
  if (!resolvedConfigPromise) {
    resolvedConfigPromise = (async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return empty;
        const json: unknown = await res.json();
        return parseFullAppConfig(json);
      } catch (e) {
        console.error("loadResolvedAppConfig:", e);
        return empty;
      }
    })();
  }
  return resolvedConfigPromise;
}

/** 仅静态配置解析出的实体底数（`radar` + `cameras` / `laserWeapons` / `tdoa` 等转成的 `AssetData[]`）；与动态侧合并需另调 `mergeDynamicAndStaticAssets` */
export async function fetchConfigAssetBase(customUrl?: string): Promise<AssetData[]> {
  const r = await loadResolvedAppConfig(customUrl);
  return r.configAssetBase;
}
