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
 *   根键 **`trackRendering`**、**`drones`**、**`airports`** 解析后的对象，在 **`loadResolvedAppConfig()`** 写入本模块内存。
 *   **不是** WebSocket 航迹数据、**不是**磁盘缓存；`getTrackRenderingConfig()` 等读的是「当前已加载的 **`app-config.json` 配置**」。
 *   **动态航迹列表**在 **`useTrackStore`**。
 * - **机场 Dock 默认**：**`airports.centerIconVisible` / `airports.centerNameVisible`** → `getAirportMapDefaults()`；**虚兵/实兵**仍只认 WS 报文。
 */

import type { AssetData } from "@/stores/asset-store";
 import {
   normalizeAssetType,
   parseMapAssetTypeStrict,
   PUBLIC_MAP_ASSET_TYPES,
   type PublicMapAssetType,
   type Track,
} from "@/lib/map-entity-model";
 import { parseForceDisposition, type ForceDisposition } from "@/lib/theme-colors";
 import { mergeRootAndDeviceVisible } from "@/lib/utils";
 import type { AssetDispositionIconAccent } from "@/lib/map-icons";
 import { MAP_FRIENDLY_COLOR_PROP, MAP_LABEL_FONT_COLOR_PROP } from "@/lib/map-icons";
 import {
   mapRadarPayload,
   type RadarMapGlobals,
   type RadarVisibilityGlobal,
 } from "@/components/map/modules/radar-range-rings-maplibre";
 import { mapAirportsDevicesPayload } from "@/components/map/modules/airport-maplibre";
 import { mapCamerasDevicesPayload } from "@/components/map/modules/optoelectronic-fov-maplibre";
 import { mapDronesDevicesPayload } from "@/components/map/modules/drones-maplibre";
 import { mapUsvsDevicesPayload } from "@/components/map/modules/usv-maplibre";
 import { mapMissilesDevicesPayload } from "@/components/map/modules/missile-maplibre";
 import type { LaserMaplibreLayerVisibility } from "@/components/map/modules/laser-maplibre";
 import type { LaserDevice, LaserScanParams } from "@/components/map/modules/laser-maplibre";
 import type { TdoaMaplibreLayerVisibility } from "@/components/map/modules/tdoa-maplibre";
 import type { TdoaDevice, TdoaScanParams } from "@/components/map/modules/tdoa-maplibre";
 function isoNow() {
   return new Date().toISOString();
 }
 
 /** IDL DeviceState：0待机 1上电 2执行 3未知 */
 const DEVICE_STATE_CN: Record<number, string> = {
   0: "待机",
   1: "上电",
   2: "执行",
   3: "未知",
 };
 
 export function deviceStateLabel(deviceState: unknown): string | undefined {
   if (deviceState === null || deviceState === undefined) return undefined;
   const n = Number(deviceState);
   if (Number.isNaN(n)) return undefined;
   return DEVICE_STATE_CN[n];
 }
 
 /** 巡飞弹 munitionState：0良好 1未准备好/繁忙 2故障 3损毁（不使用 BaseDeviceStatus.deviceState） */
 export const MUNITION_STATE_CN: Record<number, string> = {
   0: "良好",
   1: "未准备好",
   2: "故障",
   3: "损毁",
 };
 
 export function assetStatusFromMunitionState(munitionState: unknown): string {
   const n = Number(munitionState);
   if (Number.isNaN(n)) return "offline";
   if (n === 0) return "online";
   if (n === 1 || n === 2) return "degraded";
   if (n === 3) return "offline";
   return "degraded";
 }
 
export function resolveMunitionStateValue(props: Record<string, unknown> | null | undefined): number {
  const ms = props?.munitionState ?? props?.munition_state;
  const n = Number(ms);
  return Number.isFinite(n) ? n : 0;
}

export function formatMunitionStateDisplay(asset?: AssetData | null): string {
  const props = asset?.properties as Record<string, unknown> | null;
  const n = resolveMunitionStateValue(props);
  if (MUNITION_STATE_CN[n]) return MUNITION_STATE_CN[n];
  return "未知";
}

function munitionStateTagColor(munitionState: number): string {
  if (munitionState === 0) return "bg-emerald-500/20 text-emerald-400";
  if (munitionState === 3 || munitionState === 2) return "bg-red-500/20 text-red-400";
  return "bg-amber-500/20 text-amber-400";
}
 
 /** DDS 巡飞弹（即飞弹）：用 properties.ws_munition / munitionState 识别，asset_type 仍为 missile */
 export function isMunitionAsset(asset?: AssetData | null): boolean {
   if (!asset) return false;
   const p = asset.properties as Record<string, unknown> | null;
   if (p?.ws_munition === true) return true;
   const ms = p?.munitionState ?? p?.munition_state;
   return ms != null && Number.isFinite(Number(ms));
 }
 
 /** 资产 status 只认 deviceState（0待机 1上电 2执行 3未知）；无字段视为待机 */
 export function assetStatusFromDeviceState(deviceState: unknown): string {
   if (deviceState === null || deviceState === undefined) return "offline";
   const ds = Number(deviceState);
   if (Number.isNaN(ds)) return "offline";
   if (ds === 0) return "offline";
   if (ds === 1) return "online";
   if (ds === 2) return "online";
   if (ds === 3) return "degraded";
   return "offline";
 }
 
 export function resolveDeviceStateValue(...sources: unknown[]): number {
   for (const s of sources) {
     if (s !== undefined && s !== null && !Number.isNaN(Number(s))) {
       return Number(s);
     }
   }
   return 0;
 }
 
 export function deviceStatePropsFromPayload(d: Record<string, unknown>): Record<string, unknown> {
   const ds = resolveDeviceStateValue(d.deviceState);
   const label = deviceStateLabel(ds) ?? "待机";
   return { deviceState: ds, deviceStateLabel: label };
 }
 
 const DEVICE_STATE_CN_VALUES = new Set(Object.values(DEVICE_STATE_CN));
 
/** 标牌/列表用：只显示设备状态中文；无有效字段时默认「待机」，不显示「-」 */
export function formatAssetDeviceStateDisplay(asset?: AssetData | null): string {
  if (isMunitionAsset(asset)) return formatMunitionStateDisplay(asset);
  const props = asset?.properties as Record<string, unknown> | null;
  if (props?.ws_usv === true) {
    const lbl = props?.strikeStateLabel;
    if (typeof lbl === "string" && lbl.trim()) return lbl.trim();
    const strike = Number(props?.strikeState ?? props?.strike_state);
    if (strike === 0) return "空闲";
    if (strike === 1) return "初始化中";
    if (strike === 2) return "运行中";
    if (strike === 3) return "已暂停";
    if (strike === 4) return "错误";
  }
  const ds = resolveDeviceStateValue(props?.deviceState);
   const cached = props?.deviceStateLabel;
   if (typeof cached === "string" && DEVICE_STATE_CN_VALUES.has(cached)) {
     return cached;
   }
   return deviceStateLabel(ds) ?? "待机";
 }
 
 /** 与资产列表同源：按 store 主键查找，兼容 entityId → deviceSn */
export function findAssetInStore(
  assets: AssetData[],
  id: string,
  entityIdToDeviceSn?: Record<string, string>,
): AssetData | undefined {
   const key = String(id ?? "").trim();
   if (!key) return undefined;
   const direct = assets.find((a) => a.id === key);
   if (direct) return direct;
   const sn = entityIdToDeviceSn?.[key];
   if (sn) return assets.find((a) => a.id === sn || String((a.properties as Record<string, unknown> | null)?.device_sn ?? (a.properties as Record<string, unknown> | null)?.deviceSn ?? "") === sn);
  return assets.find((a) => {
    const p = a.properties as Record<string, unknown> | null;
    const eid = p?.entity_id ?? p?.entityId;
    const deviceSn = p?.device_sn ?? p?.deviceSn;
    const dockSn = p?.dock_sn ?? p?.dockSn;
    return (
      (eid != null && String(eid) === key) ||
      (deviceSn != null && String(deviceSn) === key) ||
      (dockSn != null && String(dockSn) === key)
    );
  });
}
 
 export type AssetDeviceStateTag = { label: string; color: string };
 
/** 资产面板标签与属性标牌「状态」共用 */
export function getAssetDeviceStateTags(asset: AssetData | null | undefined): AssetDeviceStateTag[] {
  if (isMunitionAsset(asset)) {
    const props = asset?.properties as Record<string, unknown> | null;
    const n = resolveMunitionStateValue(props);
    return [{ label: formatMunitionStateDisplay(asset), color: munitionStateTagColor(n) }];
  }
  const propsUsv = asset?.properties as Record<string, unknown> | null;
  if (propsUsv?.ws_usv === true) {
    const strike = Number(propsUsv?.strikeState ?? propsUsv?.strike_state ?? 2);
    const label = formatAssetDeviceStateDisplay(asset);
    const color =
      strike === 4
        ? "bg-red-500/20 text-red-400"
        : strike === 0 || strike === 3
          ? "bg-amber-500/20 text-amber-400"
          : "bg-emerald-500/20 text-emerald-400";
    return [{ label, color }];
  }
  const label = formatAssetDeviceStateDisplay(asset);
  const props = asset?.properties as Record<string, unknown> | null;
  const n = Number(props?.deviceState ?? 0);
  const color =
    n === 0
      ? "bg-red-500/20 text-red-400"
      : n === 3
        ? "bg-amber-500/20 text-amber-400"
        : "bg-emerald-500/20 text-emerald-400";
  return [{ label, color }];
}
 
 /**
  * entity_status / relationships 合并时保留已有设备状态（camera/dock_status/drone_status 写入）。
  * 若 `row` 已带 `properties.deviceState`（实时消息），以 `row` 为准，不拿 `prev` 覆盖。
  */
export function preserveDeviceStateFromPrev(prev: AssetData, row: AssetData): AssetData {
  const rowProps =
    row.properties && typeof row.properties === "object"
      ? (row.properties as Record<string, unknown>)
       : null;
  const rowName = String(row.name ?? "").trim();
  const keepPrevName = (!rowName || rowName === row.id) && !!prev.name && prev.name !== prev.id;
   if (rowProps?.deviceState !== undefined && rowProps?.deviceState !== null) {
     return keepPrevName ? { ...row, name: prev.name } : row;
   }
  const prevProps =
    prev.properties && typeof prev.properties === "object"
      ? (prev.properties as Record<string, unknown>)
      : null;
  const hasDeviceState = prevProps?.deviceState !== undefined && prevProps?.deviceState !== null;
  const hasDroneRuntime =
    prevProps?.drone_status != null ||
    prevProps?.high_freq != null ||
    prevProps?.drone_flight_path != null ||
    prevProps?.last_packet_at_ms != null ||
    prevProps?.status_received_at_ms != null ||
    prevProps?.high_freq_received_at_ms != null;
  const hasDockRuntime =
    prevProps?.dock != null ||
    prevProps?.dock_battery_percent != null ||
    prevProps?.dock_mode_code != null;
  if (!hasDeviceState && !hasDroneRuntime && !hasDockRuntime) {
    return keepPrevName ? { ...row, name: prev.name } : row;
  }
  const mergedProps: Record<string, unknown> = { ...(rowProps ?? {}) };
  if (hasDeviceState) {
    mergedProps.deviceState = prevProps?.deviceState;
    if (prevProps?.deviceStateLabel != null) mergedProps.deviceStateLabel = prevProps.deviceStateLabel;
  }
  if (hasDroneRuntime) {
    for (const key of [
      "drone_status",
      "high_freq",
      "drone_flight_path",
      "last_packet_at_ms",
      "status_received_at_ms",
      "high_freq_received_at_ms",
      "history_trail",
      "munition_quantity",
    ] as const) {
      if (prevProps?.[key] != null) mergedProps[key] = prevProps[key];
    }
  }
  if (hasDockRuntime) {
    for (const key of ["dock", "dock_battery_percent", "dock_mode_code", "map_label"] as const) {
      if (prevProps?.[key] != null) mergedProps[key] = prevProps[key];
    }
  }
  for (const key of [
    "sensor_video_url",
    "sensor_video_source_path",
    "videoAddress",
    "entity_media",
    "detection_camera_id",
    "cameraId",
    "camera_id",
    "deviceSn",
    "device_sn",
    "entityId",
    "entity_id",
  ] as const) {
    if (mergedProps[key] == null && prevProps?.[key] != null) mergedProps[key] = prevProps[key];
  }
  if (hasDroneRuntime && typeof window !== "undefined") {
    console.log("[drone-debug]", {
      phase: "entity_status_rebuild_preserve",
      entityId: row.id,
      rowLat: row.lat,
      rowLng: row.lng,
      rowHeading: row.heading,
      prevLat: prev.lat,
      prevLng: prev.lng,
      prevHeading: prev.heading,
      historyTrailLength: Array.isArray(prevProps?.history_trail) ? prevProps.history_trail.length : 0,
    });
  }
  return {
    ...row,
    ...(keepPrevName ? { name: prev.name } : {}),
    ...(hasDroneRuntime ? {
      lat: Number.isFinite(prev.lat) ? prev.lat : row.lat,
      lng: Number.isFinite(prev.lng) ? prev.lng : row.lng,
      heading:
        prev.heading != null && Number.isFinite(Number(prev.heading))
          ? Number(prev.heading)
          : row.heading,
    } : {}),
    ...(hasDockRuntime ? { lat: prev.lat, lng: prev.lng } : {}),
    ...(hasDeviceState ? { status: prev.status } : {}),
    properties: mergedProps,
  };
}

function assetPropertiesRecord(asset: AssetData): Record<string, unknown> {
  return asset.properties && typeof asset.properties === "object"
    ? (asset.properties as Record<string, unknown>)
    : {};
}

/**
 * entity_status 全量重建时，保留已由独立 DDS topic 写入 asset-store 的实时字段。
 *
 * - 激光/TDOA：`properties.ws_weapon_device`（laser_status / tdoa_status）
 * - 巡飞弹：`properties.ws_munition`（munition_status）；显示名以 entity_status 的 `row.name` 为准，
 *   DDS 不写 name（勿用 targetName）；静态 app-config 仅提供初始名称。
 * - 无人船：`properties.ws_usv`（usv_status）；显示名以 entity_status / 静态配置为准。
 *
 * 无人机地图位置走 drone-store，此处不处理；机场/无人机 deviceState 见 `preserveDeviceStateFromPrev`。
 */
export function preserveDdsDynamicFieldsOnRebuild(
  live: AssetData,
  row: AssetData,
): AssetData | null {
  /**
   * Rebuild policy note:
   * - `entity_status` may replace the normalized base asset row
   * - some runtime-only DDS fields are written by other topics between rebuilds
   * - this helper preserves those runtime fields so a full snapshot rebuild does not
   *   accidentally erase live overlays already merged into `asset-store`
   */
  const at = normalizeAssetType(row.asset_type);
  const lp = assetPropertiesRecord(live);

  if ((at === "laser" || at === "tdoa") && lp.ws_weapon_device === true) {
    return mergeDdsOverlayOntoEntityRow(live, row, {
      includeHeading: false,
      displayName: row.name,
    });
  }

  if (at === "missile" && lp.ws_munition === true) {
    return mergeDdsOverlayOntoEntityRow(live, row, {
      includeHeading: true,
      displayName: row.name || live.name,
    });
  }

  if (at === "usv" && lp.ws_usv === true) {
    return mergeDdsOverlayOntoEntityRow(live, row, {
      includeHeading: true,
      displayName: row.name || live.name,
    });
  }

  if (at === "camera") {
    const hasLiveDeviceState = lp.deviceState !== undefined && lp.deviceState !== null;
    const hasLivePose =
      live.heading != null && Number.isFinite(Number(live.heading));
    const hasLiveFov =
      live.fov_angle != null && Number.isFinite(Number(live.fov_angle));
    const hasLiveRange =
      live.range_km != null && Number.isFinite(Number(live.range_km));
    const hasLiveMedia =
      lp.sensor_video_url != null ||
      lp.sensor_video_source_path != null ||
      lp.videoAddress != null ||
      lp.entity_media != null;

    if (!hasLiveDeviceState && !hasLivePose && !hasLiveFov && !hasLiveRange && !hasLiveMedia) {
      return null;
    }

    const rp = assetPropertiesRecord(row);
    return {
      ...row,
      name: row.name || live.name,
      status: hasLiveDeviceState ? live.status : row.status,
      heading: hasLivePose ? live.heading : row.heading,
      fov_angle: hasLiveFov ? live.fov_angle : row.fov_angle,
      range_km: hasLiveRange ? live.range_km : row.range_km,
      properties: {
        ...rp,
        ...lp,
      },
    };
  }

  return null;
}

function mergeDdsOverlayOntoEntityRow(
  live: AssetData,
  row: AssetData,
  opts: { includeHeading: boolean; displayName: string },
): AssetData {
  const rp = assetPropertiesRecord(row);
  const lp = assetPropertiesRecord(live);
  return {
    ...row,
    lat: live.lat,
    lng: live.lng,
    status: live.status,
    name: opts.displayName,
    ...(opts.includeHeading ? { heading: live.heading ?? row.heading } : {}),
    assigned_target_id: live.assigned_target_id ?? row.assigned_target_id,
    properties: { ...rp, ...lp },
  };
}

/** 合并进 asset-store 前补齐状态标签；巡飞弹用 munitionState，其它资产用 deviceState */
export function stampDeviceStateOnAsset(a: AssetData): AssetData {
  const props = (a.properties ?? {}) as Record<string, unknown>;
  if (isMunitionAsset(a)) {
    const ms = resolveMunitionStateValue(props);
    return {
      ...a,
      status: assetStatusFromMunitionState(ms),
      properties: { ...props, munitionStateLabel: formatMunitionStateDisplay(a) },
    };
  }
  const ds = resolveDeviceStateValue(props.deviceState);
  const dsProps = deviceStatePropsFromPayload({ deviceState: ds });
  return {
    ...a,
    status: assetStatusFromDeviceState(ds),
    properties: { ...props, ...dsProps },
  };
}
 
 export function formatIsoToSecond(iso: string | null | undefined): string {
   if (!iso) return "-";
   const d = new Date(iso);
   if (Number.isNaN(d.getTime())) {
     const s = String(iso).replace("T", " ").replace(/Z$/i, "");
     return s.length >= 19 ? s.slice(0, 19) : s;
   }
   const p = (n: number) => String(n).padStart(2, "0");
   return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
 }
 
 function asRecord(v: unknown): Record<string, unknown> | null {
   return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
 }
 
function finiteNumberOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function readVirtualTroopLikeRow(row: Record<string, unknown>): boolean {
  const raw =
    row.virtualTroop ??
    row.virtual_troop ??
    row.is_virtual ??
    row.isVirtual ??
    row.virtual;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "virtual" || s === "虚兵";
  }
  const indicators = asRecord(row.indicators);
  if (typeof indicators?.simulated === "boolean") return indicators.simulated;
  return false;
}

function readMediaVideoUrlFromMediaObject(mediaObj: Record<string, unknown> | null): string {
  if (!mediaObj) return "";
  const directAddress = mediaObj.address;
  if (typeof directAddress === "string" && directAddress.trim()) {
    return directAddress.trim();
  }
  const mediaList = Array.isArray(mediaObj.media) ? mediaObj.media : [];
  for (const item of mediaList) {
    const row = asRecord(item);
    if (!row) continue;
    const type = String(row.type ?? "").trim().toUpperCase();
    if (type !== "MEDIA_TYPE_VIDEO") continue;
    const address = row.address;
    if (typeof address === "string" && address.trim()) {
      return address.trim();
    }
    const relativePath = row.relativePath;
    if (typeof relativePath === "string" && relativePath.trim()) {
      return relativePath.trim();
    }
  }
  return "";
}

function resolveEntityVideoUrl(
  assetType: string,
  row: Record<string, unknown>,
): { videoUrl: string; sourcePath: string; mediaObject: Record<string, unknown> | null } {
  const topLevelMedia = asRecord(row.media);
  const relationship = asRecord(row.relationship);
  const relationshipMedia = asRecord(relationship?.media);

  if (assetType === "camera") {
    const videoUrl = readMediaVideoUrlFromMediaObject(topLevelMedia);
    return {
      videoUrl,
      sourcePath: videoUrl ? "media.address|media.media[]" : "",
      mediaObject: topLevelMedia,
    };
  }

  if (assetType === "drone") {
    const relationshipVideoUrl = readMediaVideoUrlFromMediaObject(relationshipMedia);
    if (relationshipVideoUrl) {
      return {
        videoUrl: relationshipVideoUrl,
        sourcePath: "relationship.media.address|relationship.media.media[]",
        mediaObject: relationshipMedia,
      };
    }
    const topLevelVideoUrl = readMediaVideoUrlFromMediaObject(topLevelMedia);
    return {
      videoUrl: topLevelVideoUrl,
      sourcePath: topLevelVideoUrl ? "media.address|media.media[]" : "",
      mediaObject: relationshipMedia ?? topLevelMedia,
    };
  }

  const fallbackVideoUrl = readMediaVideoUrlFromMediaObject(topLevelMedia);
  return {
    videoUrl: fallbackVideoUrl,
    sourcePath: fallbackVideoUrl ? "media.address|media.media[]" : "",
    mediaObject: topLevelMedia,
  };
}

/**
  * 【核心：实体类型识别】从 WS 实体行中提取 `specificType`，映射为前端资产类型字符串。
  *
  * ── 字段提取优先级 ──
  * 后端 entity_status 推来的每条实体行 `r` 中，类型标识字段有以下几种可能：
  *   1. r.specificType           —— 顶层字段（最常见，如 "Radar-Surveillance"、"CAMERA"）
  *   2. r.ontology.specificType  —— 嵌套在 ontology 对象内
  *   3. r.ontologySpecificType   —— 扁平化的本体类型字段
  *   4. r.specific_type          —— 下划线风格（部分后端版本）
  *
  * 本函数按以上优先级提取 `specificType`，转大写后匹配已知类型前缀/值。
  *
  * ── 类型映射规则（与后端 ontology 对齐）──
  *   - "Radar-*"    （前缀匹配，如 "Radar-Surveillance"、"Radar-Tracking"）→ "radar"
  *   - "RADAR" / "雷达" / 含 "RADAR" / 含 "雷达"              → "radar"
  *   - navigationParameters.with_radar=1 / radarParameters 存在 → "radar"（隐式雷达，如无人船）
  *   - "CAMERA" / "OPTOELECTRONIC" / "OPTICAL" / "光电"       → "camera"
  *   - "TOWER" / "ESM" / "电侦" / "电子侦察" / "RECON" / "EW" → "tower"
  *   - "DOCK" / "AIRPORT" / "GATEWAY"                         → "airport"
  *   - "DRONE" / "UAV"                                         → "drone"
  *   - "USV" / "无人船" / "UNMANNED_SHIP"                       → "usv"
  *   - "MISSILE" / "飞弹" / "导弹"                               → "missile"
 *   - "LASER" / "激光" / "激光武器"                           → "laser"
 *   - "TDOA"                                                   → "tdoa"
 *   - entityId 含 TDOA / LASER（如 system-TDOA-001）           → 仅 laser、tdoa 补判
 *   - "SURVEILLANCE_AREA" / "RESTRICTED_AREA" / "AREA" / "AREA_TYPE_*" / "SURVEILLANCE" / "FIXED_WING" / "FRAME"
  *     → "unknown"（非地图资产类型，跳过不入库，不报错）
  *   - 其余回退：尝试 r.asset_type / r.type，仍无法识别 → "unknown"
  */
 function wsEntityTypeRaw(r: Record<string, unknown>): string {
   /* ── 第1步：提取 specificType（按优先级尝试多个可能的字段位置）── */
   const ontology = asRecord(r.ontology);
   const rawSpecificType =
     r.specificType ??                          // 顶层 camelCase
     r.specific_type ??                         // 顶层 snake_case
     ontology?.specificType ??                   // 嵌套 ontology.specificType
     ontology?.specific_type ??                  // 嵌套 ontology.specific_type
     r.ontologySpecificType ??                   // 扁平化本体类型
     "";                                         // 兜底空串
   const st = String(rawSpecificType).trim();
   const stu = st.toUpperCase();
 
   const eid = String(r.entityId ?? r.entity_id ?? "?");
   const hasRadarParams = r.radarParameters != null || r.max_range_m != null || r.range_km != null;
 
   /* ── 第2步：根据 specificType 大写值匹配前端资产类型 ── */
 
   // 机场 / 网关
   if (stu === "DOCK" || stu === "AIRPORT" || stu === "GATEWAY") return "airport";
   // 无人机
   if (stu === "DRONE" || stu === "UAV") return "drone";
   // 无人船
   if (stu === "USV" || stu === "无人船" || stu === "UNMANNED_SHIP" || stu === "UNMANNED-SHIP") return "usv";
   // 飞弹
   if (stu === "MISSILE" || stu === "飞弹" || stu === "导弹") return "missile";
   // 雷达：specificType 以 "Radar-" 开头（如 "Radar-Surveillance"、"Radar-Tracking"）或精确等于 "RADAR"
   if (stu === "RADAR" || stu === "雷达" || stu.startsWith("RADAR-") || stu.includes("RADAR") || stu.includes("雷达")) return "radar";
   // 相机（光电）：specificType 精确等于 "CAMERA"（注意：不含 TOWER，电侦是独立类型）
   if (
     stu === "CAMERA" || stu === "OPTOELECTRONIC" || stu === "OPTICAL" || stu === "THIRDPARTYCAMERA" || stu === "THIRDPARTYUDPCAMERAIMAGE" ||stu === "THIRDPARTYUDPCAMERAVIDEO" ||
     stu === "光电" || stu === "摄像头"
   ) return "camera";
   // 电侦（电子侦察）：与光电（camera）为不同类型，图标使用 电侦.svg
   if (
     stu === "TOWER" || stu === "电侦" || stu === "电子侦察" || stu === "ESM" ||
     stu === "RECON" || stu === "EW"
   ) return "tower";
   // 激光武器
   if (stu === "LASER" || stu === "激光" || stu === "激光武器") return "laser";
   // TDOA
   if (stu === "TDOA") return "tdoa";
   // 无人船/平台携带雷达：navigationParameters.with_radar=1 或 radarParameters 存在
   const navParams = asRecord(r.navigationParameters);
   if (navParams?.with_radar === 1 || navParams?.with_radar === true || hasRadarParams) {
     return "radar";
   }
   // 区域/监视区等非地图资产类型，直接跳过不报错
   if (
     stu === "SURVEILLANCE_AREA" || stu === "RESTRICTED_AREA" || stu === "AREA" ||
     stu.startsWith("AREA_TYPE_") || stu.startsWith("SURVEILLANCE") || stu === "FIXED_WING" ||
     stu === "FRAME"
   ) {
     return "unknown";
   }
 
  /* ── 第3步：specificType 无法识别 —— 激光/TDOA 从 entityId 补判，再试 asset_type / type ── */
  const eidUpper = eid.toUpperCase();
  if (eidUpper.includes("TDOA")) return "tdoa";
  if (eidUpper.includes("LASER") || eid.includes("激光")) return "laser";
  if (eidUpper.includes("MUNITION") ) return "missile";

  const fallbackType = String(r.asset_type ?? r.type ?? "").toLowerCase().trim();
   if (fallbackType && (PUBLIC_MAP_ASSET_TYPES as readonly string[]).includes(fallbackType)) {
     return fallbackType;
   }
   console.error(
     `[wsEntityTypeRaw] ✘ 无法识别实体类型: specificType="${st}", asset_type="${r.asset_type ?? ""}", type="${r.type ?? ""}", entityId=${eid}`
   );
   return "unknown";
 }
 
 /**
  * 【WS 实体 → AssetData 转换】
  *
  * 将 WebSocket 推来的单条实体行（来自 entity_status 消息的 data 数组）解析为前端 AssetData。
  *
  * ── 解析流程 ──
  * 1. 提取实体 ID（r.id / r.entityId / r.drone_sn / r.asset_id / r.dock_sn）
  * 2. 提取坐标（顶层 lat/lng → 嵌套 location.position → 无坐标则丢弃）
  * 3. 提取名称（r.name / r.entityName / aliases.name）
  * 4. 提取朝向与视场角（heading / bearing / fov_angle）
  * 5. 雷达专用参数（radarParameters.range：海里→公里转换，写入 properties.max_range_m）
  * 6. 提取敌我属性（disposition / milView.disposition）
  * 7. 提取健康状态（health.healthStatus → online/offline/degraded）
  * 8. 【关键】通过 `wsEntityTypeRaw(r)` 识别资产类型（基于 specificType 字段）
  * 9. 组装 AssetData 写入 asset-store
  *
  * @param r - WebSocket 实体行原始对象（已 JSON.parse）
  * @returns AssetData 或 null（无 ID 或无坐标时返回 null）
  */
export function mapOneEntityRow(r: Record<string, unknown>): AssetData | null {
   /* ── 1. 提取实体 ID ── */
   /* 【重要】所有资产统一使用 entityId 字段作为唯一 key；
    * entityId 是后端为每个实体分配的唯一标识符，贯穿 WS 消息、航迹关联、资产渲染全流程。
    * 如果 WS 实体行没有 entityId，这条数据无法入库，直接报错丢弃。 */
   const id = String(r.entityId ?? r.entity_id ?? "").trim();
   if (!id) {
     console.error("[mapOneEntityRow] ✘ 实体缺少 entityId，丢弃:", JSON.stringify(r).slice(0, 300));
     return null;
   }
 
   /* ── 2. 提取 WGS84 坐标 ── */
   /* 优先级：顶层 r.lat/r.latitude → 嵌套 r.location.position.latitudeDegrees */
   let lat = Number(r.lat ?? r.latitude);
   let lng = Number(r.lng ?? r.longitude);
   if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
     const location = asRecord(r.location);
     const position = asRecord(location?.position);
     if (position) {
       const plat = Number(position.latitudeDegrees ?? position.latitude ?? position.lat);
       const plng = Number(position.longitudeDegrees ?? position.longitude ?? position.lng ?? position.lon);
       if (Number.isFinite(plat)) lat = plat;
       if (Number.isFinite(plng)) lng = plng;
     }
   }
   /* 无坐标的实体无法在地图上渲染，直接丢弃 */
   if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
 
   const now = isoNow();
 
   /* ── 3. 提取名称 ── */
   /* 优先级：r.name → r.entityName → aliases.name → 回退为 ID */
   const aliases = asRecord(r.aliases);
   const name = String(
     r.name ??
     r.entityName ??
     r.entity_name ??
     r.displayName ??
     r.display_name ??
     r.deviceName ??
     r.device_name ??
     r.assetName ??
     r.asset_name ??
     aliases?.name ??
     id,
   );
 
   /* ── 4. 提取朝向（度）与视场角（度）── */
   /* entity_status 仅做通用实体字段解析；相机 PTZ 专用解析在 useUnifiedWsFeed 的 camera/optoelectronic 分支 */
   const headingDeg = finiteNumberOrNull(r.headingDeg ?? r.heading ?? r.bearing ?? r.azimuth);
   const fovDeg = finiteNumberOrNull(r.fov_angle ?? r.fovAngle ?? r.openingDeg ?? r.angle);
 
   /* ── 5. 雷达专用参数提取 ── */
   /* 后端 radarParameters.range 单位为海里，需转换为公里写入 range_km；
    * 同时将 max_range_m（米）、ring_interval_m、ring_count 写入 properties，
    * 供 radar-range-rings-maplibre.ts 渲染雷达距离环使用 */
   const radarParams = asRecord(r.radarParameters);
   let rangeKm = r.range_km != null ? Number(r.range_km) : r.range != null ? Number(r.range) : null;
   const radarExtraProps: Record<string, unknown> = {};
   if (radarParams && rangeKm == null) {
     const radarRange = Number(radarParams.range);
     if (Number.isFinite(radarRange) && radarRange > 0) {
       const rangeMeters = radarRange * 1852;                    // 海里 → 米
       radarExtraProps.max_range_m = rangeMeters;
       /* ring_interval_m / ring_count 不在此设置，由 app-config.json radar.defaultInterval / defaultMaxRange 控制 */
       radarExtraProps.showRings = true;
       radarExtraProps.radar_model = radarParams.radar_model;
       radarExtraProps.radar_type = radarParams.radar_type;
       radarExtraProps.radar_transmit = radarParams.transmit;
       rangeKm = rangeMeters / 1000;                             // 米 → 公里
     }
   }
   /* navigationParameters.maxRangeNm（无人船等携带雷达的平台） */
   if (rangeKm == null) {
     const navP = asRecord(r.navigationParameters);
     if (navP) {
       const maxRangeNm = Number(navP.maxRangeNm);
       if (Number.isFinite(maxRangeNm) && maxRangeNm > 0) {
         const rangeMeters = maxRangeNm * 1852;                  // 海里 → 米
         radarExtraProps.max_range_m = rangeMeters;
         /* ring_interval_m / ring_count 不在此设置，由 app-config.json radar.defaultInterval / defaultMaxRange 控制 */
         radarExtraProps.showRings = true;
         rangeKm = rangeMeters / 1000;
       }
     }
   }
 
   /* ── 6. 提取敌我属性（disposition）── */
   /* 优先级：顶层 r.disposition → milView.disposition → forceDisposition → properties.disposition */
   const milView = asRecord(r.milView);
   const disposition = parseForceDisposition(
     r.disposition ??
       milView?.disposition ??
       (r as Record<string, unknown>).forceDisposition ??
       (r.properties && typeof r.properties === "object"
         ? (r.properties as Record<string, unknown>).disposition
         : undefined),
     "friendly",
   );
 
   /* 设备状态不由 entity_status 写入，由 camera / dock_status / drone_status 等实时消息维护 */
 
   /* ── 8. 【关键】识别资产类型 ── */
   /* 调用 wsEntityTypeRaw()，基于 specificType 字段识别：
    *   - specificType 以 "Radar-" 开头 → "radar"（如 "Radar-Surveillance"）
    *   - specificType == "CAMERA"      → "camera"
    *   - 其他类型见 wsEntityTypeRaw 注释
    * 再经 normalizeAssetType() 确保落入 PUBLIC_MAP_ASSET_TYPES 集合 */
  const rawType = String(r.assetType ?? "").trim() || wsEntityTypeRaw(r);
  if (rawType === "unknown") {
    return null;
  }
  const assetType = normalizeAssetType(rawType);
  const detectionCameraId = String(
    r.cameraId ??
      r.camera_id ??
      r.deviceSn ??
      r.device_sn ??
      id,
  ).trim();
  const directVideoUrl = typeof r.videoAddress === "string" ? r.videoAddress.trim() : "";
  /**
   * EO 视频地址来源说明：
   * - 优先取实体顶层 `videoAddress`
   * - 否则从 `media.address` / `media.media[]` 里找视频地址
   * - 归一化后统一写进 `properties.sensor_video_url`
   *
   * 后续 EO 视频弹窗只认 `sensor_video_url`，不再重复解析实体结构。
   */
  const { videoUrl, sourcePath: videoSourcePath, mediaObject } = directVideoUrl
    ? { videoUrl: directVideoUrl, sourcePath: "videoAddress", mediaObject: null }
    : resolveEntityVideoUrl(assetType, r);
  /* 雷达为全向扫描，fov_angle 强制 360° */
  const effectiveFovDeg = assetType === "radar" ? 360 : fovDeg;
 
   /* ── 9. 组装 AssetData ── */
   const virtualTroop = readVirtualTroopLikeRow(r);

   const result: AssetData = {
     id,
     name,
     asset_type: assetType,
     status: "offline",
     disposition,
     lat,
     lng,
     range_km: rangeKm,
     heading: headingDeg,
     fov_angle: effectiveFovDeg,
    properties: {
      ...((r.properties as Record<string, unknown> | null) ?? {}),
      ...r,
      ...radarParams,
      ...radarExtraProps,
      ...(mediaObject ? { entity_media: mediaObject } : {}),
      ...(videoSourcePath ? { sensor_video_source_path: videoSourcePath } : {}),
      ...(videoUrl ? { sensor_video_url: videoUrl } : {}),
      ...(detectionCameraId ? { detection_camera_id: detectionCameraId } : {}),
      entityId: id,
      entity_id: id,
      deviceSn: r.deviceSn,
      device_sn: r.deviceSn,
      gatewaySn: r.gatewaySn,
      gateway_sn: r.gatewaySn,
      videoAddress: directVideoUrl || videoUrl,
      disposition: r.disposition ?? milView?.disposition,
      virtualTroop,
      virtual_troop: virtualTroop,
      is_virtual: virtualTroop,
    },
     mission_status: String(r.mission_status ?? "monitoring"),
     assigned_target_id: r.assigned_target_id != null ? String(r.assigned_target_id) : null,
     target_lat: r.target_lat != null ? Number(r.target_lat) : null,
     target_lng: r.target_lng != null ? Number(r.target_lng) : null,
     created_at: String(r.created_at ?? now),
     updated_at: now,
   };
 
   return result;
 }
 
 /**
  * 【批量解析】将 WS 推来的实体数组统一转换为 AssetData[]。
  *
  * 遍历 payload 数组中的每条实体，调用 mapOneEntityRow 逐一解析：
  *   - 根据 specificType 识别类型（"Radar-XXX" → 雷达，"CAMERA" → 相机，...）
  *   - 提取坐标、名称、朝向、敌我属性等
  *   - 无 ID 或无坐标的行被丢弃
  *
  * 调用链：entity_status → mapEntitiesPayload → mapOneEntityRow → wsEntityTypeRaw
  *
  * @param payload - WS 消息中的 data 数组（entity_status 的 msg.data）
  * @returns 有效实体的 AssetData 数组
  */
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
   usvAssets: AssetData[],
   missileAssets: AssetData[],
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
   for (const u of usvAssets) {
     if (u.id) byId.set(u.id, u);
   }
   for (const m of missileAssets) {
     if (m.id) byId.set(m.id, m);
   }
   return [...byId.values()];
 }
 
 /** 与 V2 `LaserManager`/`TdoaManager` 扫描参数对齐（径向亮带） */
 export type AppConfigSectorScan = {
   /** 扫描开关（光电/机场/无人机用）；激光/TDOA 由 activationEnabled 控制 */
   enabled?: boolean;
   /** 亮带沿半径走一圈的周期 ms（V2 默认 2000） */
   cycleMs?: number;
   /** 刷新间隔 ms（激光 V2=90，TDOA V2=100） */
   tickMs?: number;
   /** 同心亮带条数（V2=9） */
   bandCount?: number;
   /** 每条亮带径向厚度（米；激光 V2=1，TDOA V2=2） */
   bandWidthMeters?: number;
 };
 
 export type AppConfigSectorDevice = {
   deviceId?: string;
   name?: string;
   center?: [number, number];
   bearing?: number;
   angle?: number;
   range?: number;
   color?: string;
   opacity?: number;
   /** 为 false 时不绘制扇区（光电/机场/无人机用）；激光/TDOA 由 activationEnabled 控制 */
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
   /** 设备级激活开关，覆盖根级 activationEnabled；不写则继承根级 */
   activationEnabled?: boolean;
   scan?: AppConfigSectorScan;
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
   /** 我方资产中心图标主色（所有资产图标统一读取此字段） */
   assetFriendlyColor?: string;
   defaultAngle?: number;
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
     /** 扇区填充可见（光电/机场/无人机用）；激光/TDOA 由 activationEnabled 控制 */
     sectorFillVisible?: boolean;
     /** 扫描亮带可见（光电/机场/无人机用）；激光/TDOA 由 activationEnabled 控制 */
     sectorScanVisible?: boolean;
     centerIconVisible?: boolean;
     centerNameVisible?: boolean;
   };
   /** 激光脉冲：激活阶段默认 ms（V2 = 10000） */
   laserPulseOnMs?: number;
   /** 激光脉冲：间歇阶段默认 ms（V2 = 3000） */
   laserPulseOffMs?: number;
   devices?: AppConfigSectorDevice[];
 
   /* ── FOV 扇区颜色（光电/电侦/机场/无人机/激光/TDOA 通用） ── */
   /** 扇区填充色（如 "rgba(147,51,234,0.10)" 或 "#9333ea"） */
   sectorFill?: string;
   /** 扇区填充透明度（如 0.10）；与 sectorFill 配合，当 sectorFill 为 hex 色时必须单独设此值 */
   sectorFillOpacity?: number;
   /** 扇区线色（如 "#9333ea"） */
   sectorLine?: string;
   /** 扇区线宽 */
   sectorLineWidth?: number;
   /** 扇区线透明度 */
   sectorLineOpacity?: number;
   /** 扇区虚兵虚线样式 */
   sectorLineDashVirtual?: number[];
   /** 扇区实兵虚线样式 */
   sectorLineDashReal?: number[];
 
   /* ── 激光 / TDOA：专题层扇区填充默认值（设备未写 color/opacity 时使用） ── */
   sectorFillDefaultColor?: string;
   sectorFillDefaultOpacity?: number;
 
   /** 激活开关：false 时扇区/扫描/脉冲均不显示，true 时按各子配置渲染 */
   activationEnabled?: boolean;
 };
 
 /* =============================================================================
  * 航迹 / 无人机 / 机场 —— 与 `public/app-config.json` 对应（仅保留**代码里真会读**的字段）
  *
  * | 配置键 | 读取方 |
  * |--------|--------|
  * | `trackRendering` | `track-ws-normalize`（空中航向角）；`useUnifiedWsFeed`（超时轮询）；`track-store.setTracks`（按 `maxHistoryPointsPerTrack` 裁剪 `historyTrail`）；`tracks-maplibre`（超 `maxViewportPoints` 则整批不画历史折线，仅画当前点符号） |
  * | `drones`（内嵌渲染键） | `parseDroneMapRenderingConfig` → `drone-store`、`drones-maplibre` |
  * | `airports`（根级 Dock 显隐） | `useUnifiedWsFeed` Dock 分支 → `getAirportMapDefaults()` |
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
 
 function parseStringUrlArray(raw: unknown, fallback: string[]): string[] {
   if (!Array.isArray(raw)) return [...fallback];
   const out = raw.map((x) => String(x ?? "").trim()).filter(Boolean);
   return out.length ? out : [...fallback];
 }
 
 function str(v: unknown, d: string): string {
   return typeof v === "string" && v.trim() ? v : d;
 }
 
 /** Dock / 机场：仅**中心图标 / 名称**两类默认显隐（根键 `airports`）；虚兵由报文决定 */
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
   const o = asCfgObject(root.airports);
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
   /**
    * `showTrackId`、`maxViewportPoints`、`maxHistoryPointsPerTrack` 被读取；
    * `maxViewportPoints`：全图航迹折线顶点总预算；`maxHistoryPointsPerTrack`：单条航迹在 store 内保留的历史点数上限（与总预算独立）。
    */
   trackDisplay: {
     showTrackId: boolean;
     /** 当前帧所有航迹折线顶点估算之和的上限（仅影响是否绘制折线，不裁剪 store） */
     maxViewportPoints: number;
     /** 每条航迹 `historyTrail` 在 track-store 内最多保留的点数（与 `maxViewportPoints` 无关） */
     maxHistoryPointsPerTrack: number;
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
 
 /** `drones-maplibre` + `drone-store` 实际读取的子集（根键 **`drones`**） */
/** `drones-maplibre` + `asset-store` 实际读取的配置子集（根键 **`drones`**）。 */
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
   /** 任务航线（航路点连线，`kind: route`） */
   plannedRouteLineColor: string;
   plannedRouteLineWidth: number;
   plannedRouteLineOpacity: number;
   /** 历史飞迹（`kind: trail`）；与任务航线独立配置 */
   historyTrailLineColor: string;
   historyTrailLineWidth: number;
   historyTrailLineOpacity: number;
   fovFillColor: string;
   fovFillOpacity: number;
   fovLineColor: string;
   /** 仅来自根键 `drones.assetFriendlyColor`：与 `getAssetFriendlyColorForAssetType("drone")` 一致，供少数仍读该字段的路径；**三角/装图请用根键色而非本字段与 label 的合成** */
   mapFriendlyColor?: string;
   /** 来自 `drones.label.fontColor`：仅用于无人机**名称**标签字色，不参与符号/三角填色 */
   labelFontColor?: string;
 };
 
 const DEFAULT_TYPE_STYLE: AppConfigTrackTypeStyle = {
   idColor: "#FFFFFF",
   pointSize: 5,
   idSize: 11,
 };
 
 export const DEFAULT_TRACK_RENDERING: AppConfigTrackRendering = {
   trackTypeStyles: {
     sea: { ...DEFAULT_TYPE_STYLE },
     air: {
       idColor: "#FFFF00",
       pointSize: 5,
       idSize: 11,
     },
     underwater: { ...DEFAULT_TYPE_STYLE },
   },
   trackDisplay: {
     showTrackId: true,
     maxViewportPoints: 2000,
     maxHistoryPointsPerTrack: 400,
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
   plannedRouteLineColor: "#38bdf8",
   plannedRouteLineWidth: 2,
   plannedRouteLineOpacity: 0.75,
   historyTrailLineColor: "#94a3b8",
   historyTrailLineWidth: 1.5,
   historyTrailLineOpacity: 0.64,
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
       maxHistoryPointsPerTrack: num(td?.maxHistoryPointsPerTrack, base.trackDisplay.maxHistoryPointsPerTrack),
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
 
 /** 解析 `drones` 内嵌渲染块 */
 export function parseDroneMapRenderingConfig(root: Record<string, unknown>): AppConfigDroneMapRendering {
   const dBundle = asCfgObject(root.drones);
   const dm = dBundle ? droneRenderingPickFromDronesRoot(dBundle) : null;
   const base = DEFAULT_DRONE_MAP_RENDERING;
 
   const maxFov = num(dm?.maxFovRange, base.maxFovRange);
   const hFov = num(dm?.horizontalFov, base.horizontalFov);
 
   const lbl = dBundle?.label !== undefined && dBundle.label !== null && typeof dBundle.label === "object"
     ? (dBundle.label as AppConfigLabelBlock)
     : undefined;
   const labelFc = typeof lbl?.fontColor === "string" && lbl.fontColor.trim() ? lbl.fontColor.trim() : undefined;
   const assetFc = typeof dBundle?.assetFriendlyColor === "string" && (dBundle?.assetFriendlyColor as string).trim() ? (dBundle?.assetFriendlyColor as string).trim() : undefined;
 
   if (!dBundle) {
     return {
       ...base,
       ...(assetFc ? { mapFriendlyColor: assetFc } : {}),
       ...(labelFc ? { labelFontColor: labelFc } : {}),
     };
   }
 
   const plannedRouteLineColor = str(dm?.plannedRouteLineColor, base.plannedRouteLineColor);
   const plannedRouteLineWidth = num(dm?.plannedRouteLineWidth, base.plannedRouteLineWidth);
   const plannedRouteLineOpacity = num(dm?.plannedRouteLineOpacity, base.plannedRouteLineOpacity);
 
   const historyTrailLineColor = str(dm?.historyTrailLineColor, base.historyTrailLineColor);
   const historyTrailLineWidth = num(dm?.historyTrailLineWidth, base.historyTrailLineWidth);
   const historyTrailLineOpacity = num(dm?.historyTrailLineOpacity, base.historyTrailLineOpacity);
 
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
     plannedRouteLineColor,
     plannedRouteLineWidth,
     plannedRouteLineOpacity,
     historyTrailLineColor,
     historyTrailLineWidth,
     historyTrailLineOpacity,
     fovFillColor: str(dm?.fovFillColor, base.fovFillColor),
     fovFillOpacity: num(dm?.fovFillOpacity, base.fovFillOpacity),
     fovLineColor: str(dm?.fovLineColor, base.fovLineColor),
     ...(assetFc ? { mapFriendlyColor: assetFc } : {}),
     ...(labelFc ? { labelFontColor: labelFc } : {}),
   };
 }
 
 /** `loadResolvedAppConfig` 写入的 `trackRendering` / `drones` 内嵌渲染块解析结果（静态配置，非航迹 store） */
 let resolvedTrackRenderingConfig: AppConfigTrackRendering = { ...DEFAULT_TRACK_RENDERING };
 let resolvedDroneMapRenderingConfig: AppConfigDroneMapRendering = { ...DEFAULT_DRONE_MAP_RENDERING };
 /** radar 根级默认配置（WS 实体兜底用） */
 let resolvedRadarDefaults: Record<string, unknown> = {};
 
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
  * 从 JSON 根提取 radar 默认配置，存入模块级变量。
  *
  * 作用：WS 推来的雷达实体（不在 config devices 中）进入 asset-store 后，
  * `buildRadarCoverageGeoJSON` 在渲染距离环时从 properties 取不到 max_range_m 等字段，
  * 此时调用 `getRadarConfigDefaults()` 获取根级默认值作为兜底。
  *
  * 默认配置字段均以 `default` 前缀命名（如 defaultMaxRange、defaultInterval），
  * 在 app-config.json 的 `radar` 根级定义。
  */
 function applyRadarDefaults(root: Record<string, unknown>) {
   const radar = asRecord(root.radar);
   if (!radar) return;
   const out: Record<string, unknown> = {};
   for (const key of Object.keys(radar)) {
     if (key === "devices" || key === "visibility") continue;
     out[key] = radar[key];
   }
   resolvedRadarDefaults = out;
 }
 
 /** 返回 radar 根级默认配置（供 WS 雷达实体兜底用） */
 export function getRadarConfigDefaults(): Record<string, unknown> {
   return resolvedRadarDefaults;
 }
 
 /** 瓦片图层配置（app-config.json → `tileLayers[]`） */
 export interface TileLayerConfig {
   id: string;
   name: string;
   url: string;
   enabled: boolean;
   minZoom: number;
   maxZoom: number;
   tileSize: number;
   /** 瓦片类型，默认 xyz */
   type: "xyz";
 }
 
 let resolvedTileLayers: TileLayerConfig[] = [];
 
 function parseTileLayers(root: Record<string, unknown>): TileLayerConfig[] {
   const raw = root.tileLayers;
   if (!Array.isArray(raw)) return [];
   const out: TileLayerConfig[] = [];
   for (const item of raw) {
     if (!item || typeof item !== "object") continue;
     const o = item as Record<string, unknown>;
     const id = String(o.id ?? "").trim();
     const url = String(o.url ?? "").trim();
     if (!id) continue;
     out.push({
       id,
       name: String(o.name ?? id),
       url,
       enabled: o.enabled === true && url.length > 0,
       minZoom: Number(o.minZoom ?? 0),
       maxZoom: Number(o.maxZoom ?? 18),
       tileSize: Number(o.tileSize ?? 256),
       type: "xyz",
     });
   }
   return out;
 }
 
 export function getTileLayerConfigs(): TileLayerConfig[] {
   return resolvedTileLayers;
 }
 
 // ── 新增配置类型与 getter ──
 
 export interface AppConfigWebSocket {
   url: string;
   reconnectInterval: number;
   heartbeatInterval: number;
   maxReconnectAttempts: number;
   initialReconnectMs: number;
   maxReconnectMs: number;
 }
 
 export interface AppConfigCoordinateTransform {
   enabled: boolean;
 }
 
 export interface AppConfigHttp {
   backendUrl: string;
   imagePollIntervalMs: number;
   imageFetchTimeoutMs: number;
 }
 
 /** 指挥处置：`http.chat` 子块（V2 对齐），由 `getHttpChatConfig()` 读取 */
 export interface AppConfigHttpChat {
   /** 自动推送处置方案 WebSocket */
   disposalPlanWsUrl: string;
   /** 手动产生处置方案完整 URL */
   disposalManualGeneratePlanUrl: string;
   /** grpc 执行唯一接口完整 URL */
   disposalExecuteUrl: string;
   disposalHttpTimeoutMs: number;
   disposalExecuteTimeoutMs: number;
   autoDisposalWsConnectTimeoutMs: number;
   /** 快捷工作流 POST 完整 URL */
   quickWorkflowUrl: string;
   /** 快捷工作流 POST 超时（毫秒），默认 5000 */
   quickWorkflowTimeoutMs: number;
   /** 快捷工作流状态 WebSocket URL（执行时连接，独立 WS） */
   quickWorkflowStatusWsUrl: string;
  /** 告警“消灭”唯一 HTTP 发布地址；前端只打这一次，后续由 Custombackend 转 gRPC 广播 */
  destroyPublishUrl: string;
  /** 告警“消灭”唯一 HTTP 发布超时 */
  destroyPublishTimeoutMs: number;
 }
 
 export interface AppConfigTrackIdMode {
   distinguishSeaAir: boolean;
 }
 
 /** 根键 `assetTargetLine`：处置方案资产→目标连接线在地图上的样式与流动速度 */
 export type AppConfigAssetTargetLine = {
   color: string;
   lineWidth: number;
   /** 虚线流动一整周的大致毫秒数（越大越慢） */
   flowCycleMs: number;
   /** 流动点半径（像素） */
   flowPointRadius: number;
 };
 
 const DEFAULT_ASSET_TARGET_LINE: AppConfigAssetTargetLine = {
   color: "#22d3ee",
   lineWidth: 2.5,
   flowCycleMs: 1200,
   flowPointRadius: 3.6,
 };
 
 let resolvedAssetTargetLineConfig: AppConfigAssetTargetLine = { ...DEFAULT_ASSET_TARGET_LINE };
 
 function parseAssetTargetLineConfig(root: Record<string, unknown>): void {
   const o = asRecord(root.assetTargetLine);
   if (!o) {
     resolvedAssetTargetLineConfig = { ...DEFAULT_ASSET_TARGET_LINE };
     return;
   }
   resolvedAssetTargetLineConfig = {
     color: str(o.color, DEFAULT_ASSET_TARGET_LINE.color),
     lineWidth: num(o.lineWidth, DEFAULT_ASSET_TARGET_LINE.lineWidth),
     flowCycleMs: Math.max(200, num(o.flowCycleMs, DEFAULT_ASSET_TARGET_LINE.flowCycleMs)),
     flowPointRadius: Math.max(1, num(o.flowPointRadius, DEFAULT_ASSET_TARGET_LINE.flowPointRadius)),
   };
 }
 
 const DEFAULT_WS: AppConfigWebSocket = {
   url: "ws://localhost:8001/ws",
   reconnectInterval: 3000,
   heartbeatInterval: 25000,
   maxReconnectAttempts: 12,
   initialReconnectMs: 2000,
   maxReconnectMs: 30000,
 };
 
 const DEFAULT_COORD_TRANSFORM: AppConfigCoordinateTransform = { enabled: true };
 
 const DEFAULT_HTTP: AppConfigHttp = {
   backendUrl: "http://localhost:8001",
   imagePollIntervalMs: 3000,
   imageFetchTimeoutMs: 1000,
 };
 
 const DEFAULT_HTTP_CHAT: AppConfigHttpChat = {
   disposalPlanWsUrl: "ws://192.168.18.103:9000/api/v1/ws/workflow-stream",
   disposalManualGeneratePlanUrl: "http://192.168.18.103:9000/api/v1/tasks/target-engagement/manual-generate-plan",
   disposalExecuteUrl: "http://192.168.18.103:9000/api/v1/tasks/grpc-disposal/execute",
   disposalHttpTimeoutMs: 5000,
   disposalExecuteTimeoutMs: 5000,
   autoDisposalWsConnectTimeoutMs: 5000,
   quickWorkflowUrl: "http://192.168.18.103:8000/api/v1/chat/quick-workflow",
   quickWorkflowTimeoutMs: 5000,
   quickWorkflowStatusWsUrl: "ws://192.168.18.103:8000/api/v1/ws/workflow-status",
  destroyPublishUrl: "http://192.168.18.141:26003/api/destroy/publish",
  destroyPublishTimeoutMs: 8000,
 };
 
 const DEFAULT_TRACK_ID_MODE: AppConfigTrackIdMode = { distinguishSeaAir: false };
 
 let resolvedWebSocketConfig: AppConfigWebSocket = { ...DEFAULT_WS };
 let resolvedCoordinateTransformConfig: AppConfigCoordinateTransform = { ...DEFAULT_COORD_TRANSFORM };
 let resolvedHttpConfig: AppConfigHttp = { ...DEFAULT_HTTP };
 let resolvedHttpChatConfig: AppConfigHttpChat = { ...DEFAULT_HTTP_CHAT };
 let resolvedTrackIdModeConfig: AppConfigTrackIdMode = { ...DEFAULT_TRACK_ID_MODE };
 
 function applyResolvedNewConfigs(root: Record<string, unknown>) {
   const ws = asRecord(root.websocket);
   if (ws) {
     resolvedWebSocketConfig = {
       url: str(ws.url, DEFAULT_WS.url),
       reconnectInterval: num(ws.reconnectInterval, DEFAULT_WS.reconnectInterval),
       heartbeatInterval: num(ws.heartbeatInterval, DEFAULT_WS.heartbeatInterval),
       maxReconnectAttempts: num(ws.maxReconnectAttempts, DEFAULT_WS.maxReconnectAttempts),
       initialReconnectMs: num(ws.initialReconnectMs, DEFAULT_WS.initialReconnectMs),
       maxReconnectMs: num(ws.maxReconnectMs, DEFAULT_WS.maxReconnectMs),
     };
   }
 
   const ct = asRecord(root.coordinateTransform);
   if (ct) {
     resolvedCoordinateTransformConfig = { enabled: bool(ct.enabled, DEFAULT_COORD_TRANSFORM.enabled) };
   }
 
   const http = asRecord(root.http);
   if (http) {
     resolvedHttpConfig = {
       backendUrl: str(http.backendUrl, DEFAULT_HTTP.backendUrl),
       imagePollIntervalMs: num(http.imagePollIntervalMs, DEFAULT_HTTP.imagePollIntervalMs),
       imageFetchTimeoutMs: num(http.imageFetchTimeoutMs, DEFAULT_HTTP.imageFetchTimeoutMs),
     };
     const ch = asRecord(http.chat);
     if (ch) {
       resolvedHttpChatConfig = {
         disposalPlanWsUrl: str(ch.disposalPlanWsUrl, DEFAULT_HTTP_CHAT.disposalPlanWsUrl),
         disposalManualGeneratePlanUrl: str(ch.disposalManualGeneratePlanUrl, DEFAULT_HTTP_CHAT.disposalManualGeneratePlanUrl),
         disposalExecuteUrl: str(ch.disposalExecuteUrl, DEFAULT_HTTP_CHAT.disposalExecuteUrl),
         disposalHttpTimeoutMs: num(ch.disposalHttpTimeoutMs, DEFAULT_HTTP_CHAT.disposalHttpTimeoutMs),
         disposalExecuteTimeoutMs: num(ch.disposalExecuteTimeoutMs, DEFAULT_HTTP_CHAT.disposalExecuteTimeoutMs),
         autoDisposalWsConnectTimeoutMs: num(
           ch.autoDisposalWsConnectTimeoutMs,
           DEFAULT_HTTP_CHAT.autoDisposalWsConnectTimeoutMs,
         ),
         quickWorkflowUrl: str(ch.quickWorkflowUrl, DEFAULT_HTTP_CHAT.quickWorkflowUrl),
         quickWorkflowTimeoutMs: num(ch.quickWorkflowTimeoutMs, DEFAULT_HTTP_CHAT.quickWorkflowTimeoutMs),
         quickWorkflowStatusWsUrl: str(ch.quickWorkflowStatusWsUrl, DEFAULT_HTTP_CHAT.quickWorkflowStatusWsUrl),
        destroyPublishUrl: str(ch.destroyPublishUrl, DEFAULT_HTTP_CHAT.destroyPublishUrl),
        destroyPublishTimeoutMs: num(ch.destroyPublishTimeoutMs, DEFAULT_HTTP_CHAT.destroyPublishTimeoutMs),
      };
     }
   }
 
   const tm = asRecord(root.trackIdMode);
   if (tm) {
     resolvedTrackIdModeConfig = { distinguishSeaAir: bool(tm.distinguishSeaAir, DEFAULT_TRACK_ID_MODE.distinguishSeaAir) };
   }
 
   parseAssetTargetLineConfig(root);
 }
 
 export function getWebSocketConfig(): AppConfigWebSocket {
   return resolvedWebSocketConfig;
 }
 
 export function getCoordinateTransformConfig(): AppConfigCoordinateTransform {
   return resolvedCoordinateTransformConfig;
 }
 
 export function getHttpConfig(): AppConfigHttp {
   return resolvedHttpConfig;
 }
 
 export function getHttpChatConfig(): AppConfigHttpChat {
   return resolvedHttpChatConfig;
 }
 
 export function getTrackIdModeConfig(): AppConfigTrackIdMode {
   return resolvedTrackIdModeConfig;
 }
 
 export function getAssetTargetLineConfig(): AppConfigAssetTargetLine {
   return resolvedAssetTargetLineConfig;
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
   /** 根键 `tower`：电侦独立配置，扇区颜色/显隐/标签等与光电完全分离 */
   tower: AppConfigSectorBundle | null;
   /** 根键 `airports`：与 cameras 同形子集 + Dock 默认显隐；静态 `devices` 并入 `configAssetBase` */
   airports: AppConfigSectorBundle | null;
   laserWeapons: AppConfigSectorBundle | null;
   tdoa: AppConfigSectorBundle | null;
   /** 根键 `drones`：与 cameras 同形的 `label` / `visibility` / `devices` 等；**静态站名/字号**等见 `DronesMaplibre.applyDronesSectorLabelStyle` */
   drones: AppConfigSectorBundle | null;
   /** 根键 `unmannedShips`：与 `airports` 同形；静态 `devices` 并入 `configAssetBase` */
   unmannedShips: AppConfigSectorBundle | null;
   /** 根键 `missiles`：与 `airports` 同形；静态 `devices` 并入 `configAssetBase` */
   missiles: AppConfigSectorBundle | null;
   /** 根键 `factory.assetIcons`：仅 **敌方 / 中立** 覆盖默认 force 色 */
   assetDispositionIconAccent: AssetDispositionIconAccent;
   /** 根键 `trackRendering`（或 V2 根级 `trackTypeStyles` / `trackDisplay` / `trackTimeout`）：见文件头表格 */
   trackRendering: AppConfigTrackRendering;
   /** 根键 `factory.iconSize`：zoom→size 的 [[zoom, size], ...] 数组，用于资产中心图标 */
   iconSizeStops: [number, number][] | null;
   /** 激光 bundle `activationEnabled`：false 时扇区/扫描/脉冲均不显示 */
   laserActivationEnabled: boolean;
   /** TDOA bundle `activationEnabled`：false 时扇区/扫描均不显示 */
   tdoaActivationEnabled: boolean;
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
 
 /** 我方各资产类型默认着色（非敌/中时优先于主题默认红）；来自各根键 `assetFriendlyColor`，见 `applyFriendlyColorsFromAssetSections` */
 let resolvedAssetFriendlyColorsByAssetType: Partial<Record<PublicMapAssetType, string>> = {};
 /** 各资产名称默认字色：来自根键 `*.label.fontColor` */
 let resolvedAssetLabelColorsByAssetType: Partial<Record<PublicMapAssetType, string>> = {};
 
 function applyFriendlyColorsFromAssetSections(root: Record<string, unknown>) {
   resolvedAssetFriendlyColorsByAssetType = {};
   const setColor = (k: PublicMapAssetType, v: unknown) => {
     if (typeof v === "string" && v.trim()) resolvedAssetFriendlyColorsByAssetType[k] = v.trim();
   };
 
   const radar = asRecord(root.radar);
   if (radar) setColor("radar", radar.assetFriendlyColor);
 
   const cameras = asRecord(root.cameras);
   if (cameras) {
     setColor("camera", cameras.assetFriendlyColor);
   }
 
   const tower = asRecord(root.tower);
   if (tower) {
     setColor("tower", tower.assetFriendlyColor);
   }
 
   const laserWeapons = asRecord(root.laserWeapons);
   if (laserWeapons) setColor("laser", laserWeapons.assetFriendlyColor);
 
   const tdoa = asRecord(root.tdoa);
   if (tdoa) setColor("tdoa", tdoa.assetFriendlyColor);
 
   const airports = asRecord(root.airports);
   if (airports) setColor("airport", airports.assetFriendlyColor);
 
   const drones = asRecord(root.drones);
   if (drones) setColor("drone", drones.assetFriendlyColor);
   const unmannedShips = asRecord(root.unmannedShips);
   if (unmannedShips) setColor("usv", unmannedShips.assetFriendlyColor);
   const missiles = asRecord(root.missiles);
   if (missiles) setColor("missile", missiles.assetFriendlyColor);
 }
 
 function applyLabelColorsFromAssetSections(root: Record<string, unknown>) {
   resolvedAssetLabelColorsByAssetType = {};
   const setColor = (k: PublicMapAssetType, v: unknown) => {
     if (typeof v === "string" && v.trim()) resolvedAssetLabelColorsByAssetType[k] = v.trim();
   };
   const pickLabelColor = (section: Record<string, unknown> | null) => {
     const lbl = asRecord(section?.label);
     return lbl?.fontColor;
   };
 
   const radar = asRecord(root.radar);
   if (radar) setColor("radar", pickLabelColor(radar));
   const cameras = asRecord(root.cameras);
   if (cameras) setColor("camera", pickLabelColor(cameras));
   const tower = asRecord(root.tower);
   if (tower) setColor("tower", pickLabelColor(tower));
   const laserWeapons = asRecord(root.laserWeapons);
   if (laserWeapons) setColor("laser", pickLabelColor(laserWeapons));
   const tdoa = asRecord(root.tdoa);
   if (tdoa) setColor("tdoa", pickLabelColor(tdoa));
   const airports = asRecord(root.airports);
   if (airports) setColor("airport", pickLabelColor(airports));
   const drones = asRecord(root.drones);
   if (drones) setColor("drone", pickLabelColor(drones));
   const unmannedShips = asRecord(root.unmannedShips);
   if (unmannedShips) setColor("usv", pickLabelColor(unmannedShips));
   const missiles = asRecord(root.missiles);
   if (missiles) setColor("missile", pickLabelColor(missiles));
 }
 
 /** 我方资产图标/标注：读各根键根级 `assetFriendlyColor`；未配置则 undefined（由上层回退到主题 `FORCE_COLORS.friendly`） */
 export function getAssetFriendlyColorForAssetType(t: PublicMapAssetType): string | undefined {
   const c = resolvedAssetFriendlyColorsByAssetType[t];
   return typeof c === "string" && c.trim() ? c.trim() : undefined;
 }
 
 /** 我方资产名称字色：读各根键 `label.fontColor`；未配置则 undefined（上层回退） */
export function getAssetLabelFontColorForAssetType(t: PublicMapAssetType): string | undefined {
  const c = resolvedAssetLabelColorsByAssetType[t];
  return typeof c === "string" && c.trim() ? c.trim() : undefined;
}

export { shouldDisplayAssetId, shouldDisplayDbArea } from "./map-display-filters";

/** 资产列表 / 地图标签 / 属性框：统一显示 `name`（entity_status 或静态配置），无 name 时用 id */
export function assetUiDisplayName(a: Pick<AssetData, "id" | "name">): string {
   const n = String(a.name ?? "").trim();
   return n || a.id;
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

function shouldPreservePrevCoords(
  prev: Pick<AssetData, "lat" | "lng">,
  next: Pick<AssetData, "lat" | "lng">,
): boolean {
  const prevLat = Number(prev.lat);
  const prevLng = Number(prev.lng);
  const nextLat = Number(next.lat);
  const nextLng = Number(next.lng);
  return (
    Number.isFinite(prevLat) &&
    Number.isFinite(prevLng) &&
    !(prevLat === 0 && prevLng === 0) &&
    Number.isFinite(nextLat) &&
    Number.isFinite(nextLng) &&
    nextLat === 0 &&
    nextLng === 0
  );
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
      const keepPrevCoords = shouldPreservePrevCoords(prev, w);
        byId.set(w.id, {
          ...prev,
          ...w,
          ...(keepPrevCoords ? { lat: prev.lat, lng: prev.lng } : {}),
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
   return [...byId.values()].map(stampDeviceStateOnAsset);
 }
 
 /** `radar.visibility` 或与 cameras 同形的 visibility 对象 → 全局默认 */
 function visibilityRecordToRadarGlobals(vis: Record<string, unknown> | null | undefined): RadarVisibilityGlobal | undefined {
   if (!vis) return undefined;
   const o: RadarVisibilityGlobal = {};
   if ("centerNameVisible" in vis) o.centerNameVisible = vis.centerNameVisible !== false;
   if ("centerIconVisible" in vis) o.centerIconVisible = vis.centerIconVisible !== false;
   return Object.keys(o).length ? o : undefined;
 }
 
 /** 读取 `radar.visibility`（与 cameras 阵型一致） */
 function parseRadarVisibilityGlobal(root: Record<string, unknown>): RadarVisibilityGlobal | undefined {
   const radar = root.radar;
   const bundle = asRecord(radar);
   if (bundle && bundle.visibility != null && typeof bundle.visibility === "object") {
     return visibilityRecordToRadarGlobals(asRecord(bundle.visibility));
   }
   return undefined;
 }
 
 /**
  * 静态 `radar.devices` 解析时合并用：与 `getRadarConfigDefaults()` 中根级
  * `defaultDistanceLabelsVisible` / `defaultAngleLabelsVisible` / `defaultCrosshairVisible` 语义一致。
  */
 function buildRadarMapGlobalsFromRoot(root: Record<string, unknown>): RadarMapGlobals {
   const vis = parseRadarVisibilityGlobal(root) ?? {};
   const radar = asRecord(root.radar) ?? {};
   return {
     ...vis,
     defaultDistanceLabelsVisible:
       "defaultDistanceLabelsVisible" in radar ? (radar.defaultDistanceLabelsVisible as boolean) !== false : false,
     defaultAngleLabelsVisible:
       "defaultAngleLabelsVisible" in radar ? (radar.defaultAngleLabelsVisible as boolean) !== false : false,
     defaultCrosshairVisible:
       "defaultCrosshairVisible" in radar ? (radar.defaultCrosshairVisible as boolean) !== false : true,
   };
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
  const da =
    o.defaultAngle != null
      ? Number(o.defaultAngle)
      : o.defaultOpeningDeg != null
        ? Number(o.defaultOpeningDeg)
        : undefined;
  return {
    assetFriendlyColor: typeof o.assetFriendlyColor === "string" ? o.assetFriendlyColor : undefined,
    defaultAngle: typeof da === "number" && Number.isFinite(da) && da > 0 ? da : undefined,
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
     /* 光电 FOV 扇区颜色 */
     sectorFill: typeof o.sectorFill === "string" ? o.sectorFill : undefined,
     sectorFillOpacity: Number.isFinite(Number(o.sectorFillOpacity)) ? Number(o.sectorFillOpacity) : undefined,
     sectorLine: typeof o.sectorLine === "string" ? o.sectorLine : undefined,
     sectorLineWidth: Number.isFinite(Number(o.sectorLineWidth)) ? Number(o.sectorLineWidth) : undefined,
     sectorLineOpacity: Number.isFinite(Number(o.sectorLineOpacity)) ? Number(o.sectorLineOpacity) : undefined,
     sectorLineDashVirtual: Array.isArray(o.sectorLineDashVirtual) ? (o.sectorLineDashVirtual as number[]) : undefined,
     sectorLineDashReal: Array.isArray(o.sectorLineDashReal) ? (o.sectorLineDashReal as number[]) : undefined,
     /* 电侦 FOV 扇区颜色 */
     sectorFillDefaultColor: typeof o.sectorFillDefaultColor === "string" ? o.sectorFillDefaultColor : undefined,
     sectorFillDefaultOpacity: Number.isFinite(Number(o.sectorFillDefaultOpacity))
       ? Number(o.sectorFillDefaultOpacity)
       : undefined,
   };
 }
 
 /** 解析 `factory.iconSize`：[[zoom, size], ...] 数组 → `[number, number][] | null` */
 function parseIconSizeStops(root: Record<string, unknown>): [number, number][] | null {
   const factory = asRecord(root.factory);
   if (!factory) return null;
   const raw = factory.iconSize;
   if (!Array.isArray(raw) || raw.length < 2) return null;
   const stops: [number, number][] = [];
   for (const item of raw) {
     if (!Array.isArray(item) || item.length < 2) continue;
     const z = Number(item[0]);
     const s = Number(item[1]);
     if (Number.isFinite(z) && Number.isFinite(s) && s > 0) {
       stops.push([z, s]);
     }
   }
   return stops.length >= 2 ? stops : null;
 }
 
 function parseFullAppConfig(json: unknown): ResolvedAppConfig {
   const root = asRecord(json) ?? {};
   const camerasBundle = parseSectorBundle(root.cameras);
   const towerBundle = parseSectorBundle(root.tower);
   const airportsBundle = parseSectorBundle(root.airports);
   const laserWeapons = parseSectorBundle(root.laserWeapons);
   const tdoaBundle = parseSectorBundle(root.tdoa);
   const dronesBundle = parseSectorBundle(root.drones);
   const unmannedShipsBundle = parseSectorBundle(root.unmannedShips);
   const missilesBundle = parseSectorBundle(root.missiles);
   const fromCameras = mapCamerasDevicesPayload(root.cameras);
   const fromRadar = mapRadarPayload(root.radar, buildRadarMapGlobalsFromRoot(root));
   const fromAirports = mapAirportsDevicesPayload(root.airports);
   const fromDrones = mapDronesDevicesPayload(root.drones);
   const fromUsvs = mapUsvsDevicesPayload(root.unmannedShips);
   const fromMissiles = mapMissilesDevicesPayload(root.missiles);
   const configAssetBase = mergeConfigAssetBase(
     fromCameras,
     fromRadar,
     laserBundleToStaticAssets(laserWeapons),
     tdoaBundleToStaticAssets(tdoaBundle),
     fromAirports,
     fromDrones,
     fromUsvs,
     fromMissiles,
   );
 
   const airportMap = parseAirportMapConfig(root);
   applyResolvedAirportConfig(airportMap);
   const trackRendering = parseTrackRenderingConfig(root);
   const droneMapRendering = parseDroneMapRenderingConfig(root);
   applyResolvedRenderingConfigs(trackRendering, droneMapRendering);
   applyResolvedNewConfigs(root);
   applyFriendlyColorsFromAssetSections(root);
   applyLabelColorsFromAssetSections(root);
   // 提取 radar 根级默认配置（WS 雷达实体兜底用）
   applyRadarDefaults(root);
   resolvedTileLayers = parseTileLayers(root);
 
   const laserActivationEnabled = laserWeapons?.activationEnabled === true;
   const tdoaActivationEnabled = tdoaBundle?.activationEnabled === true;
   applyLaserActivation(laserActivationEnabled);
   applyTdoaActivation(tdoaActivationEnabled);
   resolvedCamerasSectorBundle = camerasBundle;
   resolvedLaserSectorBundle = laserWeapons;
   resolvedTdoaSectorBundle = tdoaBundle;
   return {
     configAssetBase,
     cameras: camerasBundle,
     tower: towerBundle,
     airports: airportsBundle,
     laserWeapons,
     tdoa: tdoaBundle,
     drones: dronesBundle,
     unmannedShips: unmannedShipsBundle,
     missiles: missilesBundle,
     assetDispositionIconAccent: parseAssetDispositionIconAccent(root),
     trackRendering,
     iconSizeStops: parseIconSizeStops(root),
     laserActivationEnabled,
     tdoaActivationEnabled,
   };
 }
 
 /** 扇区描边：`lineWidth` 经 `Number` 后 ≤0 或 NaN 视为关闭 */
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
   const active = resolvedLaserActivation;
   const borderEmit = resolveSectorBorderEmit(b);
   return {
     fillVisible: active,
     scanFillVisible: active,
     lineVisible: active && borderEmit,
     centerVisible: sectorBundleAnyMergedVisible(b, "centerIconVisible"),
     labelVisible: sectorBundleAnyMergedVisible(b, "centerNameVisible"),
   };
 }
 
 export function sectorBundleToTdoaLayerVis(b: AppConfigSectorBundle | null): Partial<TdoaMaplibreLayerVisibility> {
   if (!b) return {};
   const active = resolvedTdoaActivation;
   const borderEmit = resolveSectorBorderEmit(b);
   return {
     fillVisible: active,
     scanFillVisible: active,
     lineVisible: active && borderEmit,
     centerVisible: sectorBundleAnyMergedVisible(b, "centerIconVisible"),
     labelVisible: sectorBundleAnyMergedVisible(b, "centerNameVisible"),
   };
 }
 
 /* ── FOV 扇区样式解析（光电 / 电侦 / 激光 / TDOA）── */
 
 /** 光电 FOV 扇区样式：从 cameras bundle 读取填充色/线色/线宽/透明度 */
 export function resolveOptoFovStyle(b: AppConfigSectorBundle | null) {
   return {
     fillColor: b?.sectorFill ?? "rgba(147,51,234,0.10)",
     fillOpacity: b?.sectorFillOpacity ?? 0.10,
     lineColor: b?.sectorLine ?? "#9333ea",
     lineWidth: b?.sectorLineWidth ?? 1.2,
     lineOpacity: b?.sectorLineOpacity ?? 0.4,
     lineDashVirtual: b?.sectorLineDashVirtual ?? [6, 4],
     lineDashReal: b?.sectorLineDashReal ?? [3, 3],
   };
 }
 
 /** 电侦 FOV 扇区样式：从独立的 tower bundle 读取 */
 export function resolveTowerFovStyle(b: AppConfigSectorBundle | null) {
   return {
     fillColor: b?.sectorFill ?? "rgba(52,211,153,0.10)",
     fillOpacity: b?.sectorFillOpacity ?? 0.10,
     lineColor: b?.sectorLine ?? "#34d399",
     lineWidth: b?.sectorLineWidth ?? 1.2,
     lineOpacity: b?.sectorLineOpacity ?? 0.4,
     lineDashVirtual: b?.sectorLineDashVirtual ?? [6, 4],
     lineDashReal: b?.sectorLineDashReal ?? [3, 3],
   };
 }
 
 /** 激光专题层：扇区填充默认色与透明度（设备未指定 color/opacity 时） */
 export function resolveLaserDefaults(b: AppConfigSectorBundle | null) {
   return {
     sectorFillDefaultColor: b?.sectorFillDefaultColor ?? "#fb7185",
     sectorFillDefaultOpacity: b?.sectorFillDefaultOpacity ?? 0.35,
   };
 }
 
 /** TDOA 专题层：扇区填充默认色与透明度 */
 export function resolveTdoaDefaults(b: AppConfigSectorBundle | null) {
   return {
     sectorFillDefaultColor: b?.sectorFillDefaultColor ?? "#fb923c",
     sectorFillDefaultOpacity: b?.sectorFillDefaultOpacity ?? 0.30,
   };
 }
 
 function sectorDeviceToSectorGeometry(
   d: AppConfigSectorDevice,
   defaultRangeM: number,
   bundle: AppConfigSectorBundle | null,
 ): Omit<LaserDevice, "scan" | "activationEnabled"> | null {
   const id = String(d.deviceId ?? "");
   const c = d.center;
   if (!id || !Array.isArray(c) || c.length < 2) return null;
   const lng = Number(c[0]);
   const lat = Number(c[1]);
   if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
   const rangeM = Number.isFinite(Number(d.range)) ? Number(d.range) : defaultRangeM;
   const bearing = Number.isFinite(Number(d.bearing)) ? Number(d.bearing) : 0;
   const defaultAngle = Number(bundle?.defaultAngle);
   const angle = Number.isFinite(Number(d.angle))
     ? Number(d.angle)
     : Number.isFinite(defaultAngle) && defaultAngle > 0
       ? defaultAngle
       : 0;
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
     friendlyMapColor: sectorBundleFriendlyTint(bundle),
     centerNameVisible: mergeRootAndDeviceVisible(bundle?.visibility?.centerNameVisible, d.centerNameVisible),
     centerIconVisible: mergeRootAndDeviceVisible(bundle?.visibility?.centerIconVisible, d.centerIconVisible),
   };
 }
 
 function resolveCycleMs(bs: AppConfigSectorScan | undefined, ds: Record<string, unknown>): number {
   const v = ds.cycleMs ?? bs?.cycleMs;
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
 
   return { cycleMs, tickMs, bandCount, bandWidthMeters };
 }
 
 let resolvedLaserActivation = false;
 let resolvedTdoaActivation = false;
 /** 供三维渲染器同步读取扇区颜色配置 */
 let resolvedCamerasSectorBundle: AppConfigSectorBundle | null = null;
 let resolvedLaserSectorBundle: AppConfigSectorBundle | null = null;
 let resolvedTdoaSectorBundle: AppConfigSectorBundle | null = null;
 function applyLaserActivation(v: boolean) {
   resolvedLaserActivation = v;
 }
 function applyTdoaActivation(v: boolean) {
   resolvedTdoaActivation = v;
 }
 /**
  * 三维 FOV 填充色（直接复用二维同名解析函数，与二维色调完全一致）。
  * 返回 { color: CSS 色值, opacity: 不透明度 }
  */
export function getAssetFovFillStyle(type: "camera" | "laser" | "tdoa"): { color: string; opacity: number } {
   switch (type) {
     case "camera": {
       const s = resolveOptoFovStyle(resolvedCamerasSectorBundle);
       return { color: s.fillColor, opacity: s.fillOpacity };
     }
     case "laser": {
       const d = resolveLaserDefaults(resolvedLaserSectorBundle);
       return { color: d.sectorFillDefaultColor, opacity: d.sectorFillDefaultOpacity };
     }
     case "tdoa": {
       const d = resolveTdoaDefaults(resolvedTdoaSectorBundle);
       return { color: d.sectorFillDefaultColor, opacity: d.sectorFillDefaultOpacity };
     }
  }
}

export function getDirectedWeaponGeometryDefaults(type: "laser" | "tdoa"): { openingDeg?: number; rangeKm?: number } {
  const bundle = type === "laser" ? resolvedLaserSectorBundle : resolvedTdoaSectorBundle;
  const first = bundle?.devices?.[0];
  const angle = Number(first?.angle);
  const defaultAngle = Number(bundle?.defaultAngle);
  const rangeM = Number(first?.range);
  const defaultRangeM =
    Number.isFinite(Number(bundle?.defaultRange))
      ? Number(bundle?.defaultRange)
      : Number.isFinite(Number(bundle?.defaultSectorRange))
        ? Number(bundle?.defaultSectorRange)
        : NaN;
  return {
    ...(
      Number.isFinite(angle) && angle > 0
        ? { openingDeg: angle }
        : Number.isFinite(defaultAngle) && defaultAngle > 0
          ? { openingDeg: defaultAngle }
          : {}
    ),
    ...(
      Number.isFinite(rangeM) && rangeM > 0
        ? { rangeKm: rangeM / 1000 }
        : Number.isFinite(defaultRangeM) && defaultRangeM > 0
          ? { rangeKm: defaultRangeM / 1000 }
          : {}
    ),
  };
}

export function getDirectedWeaponScanDefaults(type: "laser" | "tdoa"): LaserScanParams {
  const bundle = type === "laser" ? resolvedLaserSectorBundle : resolvedTdoaSectorBundle;
  const scan = bundle?.scan;
  const fallback = type === "laser"
    ? { cycleMs: 4000, tickMs: 90, bandCount: 9, bandWidthMeters: 1 }
    : { cycleMs: 2000, tickMs: 100, bandCount: 9, bandWidthMeters: 2 };
  return {
    cycleMs: Math.max(400, Number(scan?.cycleMs) || fallback.cycleMs),
    tickMs: Math.max(16, Number(scan?.tickMs) || fallback.tickMs),
    bandCount: Math.max(1, Math.min(24, Math.floor(Number(scan?.bandCount) || fallback.bandCount))),
    bandWidthMeters: Math.max(0.2, Number(scan?.bandWidthMeters) || fallback.bandWidthMeters),
  };
}

/** 激光激活开关：`activationEnabled` 为 true 时才显示扇区+扫描+脉冲 */
export function getLaserActivationEnabled(): boolean {
   return resolvedLaserActivation;
 }
 /** 运行时设置激光激活开关（供 chat 方案激活调用） */
 export function setLaserActivationEnabled(v: boolean): void {
   resolvedLaserActivation = v;
 }
 /** TDOA 激活开关：`activationEnabled` 为 true 时才显示扇区+扫描 */
 export function getTdoaActivationEnabled(): boolean {
   return resolvedTdoaActivation;
 }
 /** 运行时设置 TDOA 激活开关（供 chat 方案激活调用） */
 export function setTdoaActivationEnabled(v: boolean): void {
   resolvedTdoaActivation = v;
 }
 
 export function laserDevicesFromSectorBundle(bundle: AppConfigSectorBundle | null): LaserDevice[] {
   if (!bundle?.devices?.length) return [];
   const defM = Number.isFinite(Number(bundle.defaultRange)) ? Number(bundle.defaultRange) : 0;
   const rootActive = resolvedLaserActivation;
   const out: LaserDevice[] = [];
   for (const raw of bundle.devices) {
     const sid = String(raw.deviceId ?? "");
     if (!sid) continue;
     const laserAt = parseMapAssetTypeStrict(raw.assetType, `laserWeapons.devices[${sid}].assetType`);
     if (laserAt !== "laser") {
       throw new Error(`laserWeapons.devices[${sid}].assetType 必须为 laser`);
     }
     /* 设备级 activationEnabled 覆盖根级；不写则继承根级 */
     const devActive = raw.activationEnabled !== undefined ? raw.activationEnabled === true : rootActive;
     const base = sectorDeviceToSectorGeometry(raw, defM, bundle);
     if (!base) continue;
     const scan = buildLaserScanParams(bundle, raw, devActive, {
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
       activationEnabled: devActive,
       scan,
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
       : 0;
   const rootActive = resolvedTdoaActivation;
   const out: TdoaDevice[] = [];
   for (const raw of bundle.devices) {
     const sid = String(raw.deviceId ?? "");
     if (!sid) continue;
     const tat = parseMapAssetTypeStrict(raw.assetType, `tdoa.devices[${sid}].assetType`);
     if (tat !== "tdoa") {
       throw new Error(`tdoa.devices[${sid}].assetType 必须为 tdoa`);
     }
     /* 设备级 activationEnabled 覆盖根级；不写则继承根级 */
     const devActive = raw.activationEnabled !== undefined ? raw.activationEnabled === true : rootActive;
     const base = sectorDeviceToSectorGeometry(raw, defM, bundle);
     if (!base) continue;
     const scan = buildTdoaScanParams(bundle, raw, devActive);
     out.push({ ...base, activationEnabled: devActive, scan });
   }
   return out;
 }
 
 /** `laserWeapons` → `asset-store` 静态行；中心点仅专题层绘制，仅用于列表/统一实体模型 */
 function sectorBundleFriendlyTint(bundle: AppConfigSectorBundle | null | undefined): string | undefined {
   const c = bundle?.assetFriendlyColor;
   return typeof c === "string" && c.trim() ? c.trim() : undefined;
 }
 
 function sectorBundleLabelFontColor(bundle: AppConfigSectorBundle | null | undefined): string | undefined {
   const c = bundle?.label?.fontColor;
   return typeof c === "string" && c.trim() ? c.trim() : undefined;
 }
 
 function laserBundleToStaticAssets(bundle: AppConfigSectorBundle | null): AssetData[] {
   const devices = laserDevicesFromSectorBundle(bundle);
   const now = isoNow();
   const mfc = sectorBundleFriendlyTint(bundle);
   const lfc = sectorBundleLabelFontColor(bundle);
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
       ...(lfc ? { [MAP_LABEL_FONT_COLOR_PROP]: lfc } : {}),
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
   const lfc = sectorBundleLabelFontColor(bundle);
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
       ...(lfc ? { [MAP_LABEL_FONT_COLOR_PROP]: lfc } : {}),
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
     tower: null,
     airports: null,
     laserWeapons: null,
     tdoa: null,
     drones: null,
     unmannedShips: null,
     missiles: null,
     assetDispositionIconAccent: {},
     trackRendering: { ...DEFAULT_TRACK_RENDERING },
     iconSizeStops: null,
     laserActivationEnabled: false,
     tdoaActivationEnabled: false,
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
 
