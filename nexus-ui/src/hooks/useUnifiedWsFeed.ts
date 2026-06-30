"use client";

/**
 * ══════════════════════════════════════════════════════════════════════
 *  WebSocket 统一接入 —— 建连、解析、按 type 写入各 store
 * ══════════════════════════════════════════════════════════════════════
 *
 * 本模块是前端所有实时数据的唯一入口，负责：
 *   1. 建立 WebSocket 连接（地址、心跳间隔等从 app-config.json 的 websocket 节读取）
 *   2. 接收消息 → JSON.parse → 按 msg.type 分发
 *   3. 解析后的数据写入对应的 Zustand store（track-store / asset-store / db-area-store）
 *
 * ── 各资产类型全链路数据流 ──
 *
 * 【雷达 radar】
 *   接收: entity_status → msg.entities[]（优先）或 msg.data[]
 *   解析: mapEntitiesPayload() → mapOneEntityRow() → wsEntityTypeRaw()
 *         specificType 以 "Radar-" 开头 / 包含 "RADAR" / "雷达" → asset_type="radar"
 *         或 navigationParameters.with_radar=1 / radarParameters 存在 → asset_type="radar"
 *         radarParameters.range（海里）→ properties.max_range_m（米）、range_km（公里）
 *         navigationParameters.maxRangeNm（海里）→ 同上（无人船携带雷达时）
 *   入资产: applyAssetListFromWs() → mergeDynamicAndStaticAssets() → asset-store.setAssets()
 *   更新: entity_status 周期推送，整体替换 asset-store（同 id 后写覆盖）
 *   渲染: asset-store 变化 → Map2D useEffect → RadarCoverageModule.setFromAssets()
 *         → buildRadarCoverageGeoJSON() 生成距离环/填充/十字线/名称 GeoJSON
 *         → 颜色: friendly 用 defaults.assetFriendlyColor（app-config.json radar.assetFriendlyColor）
 *         → 范围: properties.max_range_m → defaults.defaultMaxRange（12000m）
 *         → 间隔: properties.ring_interval_m → defaults.defaultInterval（3000m）
 *   超时: 无独立超时机制，依赖 WS 周期推送；若 WS 断连则资产保持最后状态
 *
 * 【光电 camera】
 *   接收: entity_status → 同上路径解析 → asset_type="camera"
 *         或 camera/optoelectronic 独立消息 → 仅更新朝向/视场角/坐标
 *   解析: specificType="CAMERA"/"OPTOELECTRONIC"/"OPTICAL"/"光电" → asset_type="camera"
 *   入资产: 同雷达路径（entity_status）或 camera 消息直接 patch asset-store
 *   更新: camera 消息 → parseCameraBearingDeg/parseCameraHorizontalFovDeg/parseCameraRangeKm
 *         与静态 cameras.devices 同 id 合并默认 bearing/angle/range
 *   渲染: asset-store → OptoelectronicFovModule.setFromAssets()
 *         → buildFovGeoJSON() 生成 FOV 扇区多边形 + 名称标签 + 中心图标
 *         → tower 类型由 tower-maplibre.ts 独立渲染
 *   超时: 无独立超时机制
 *
 * 【电侦 tower】
 *   接收: entity_status → 同上路径 → specificType="TOWER"/"ESM"/"电侦" → asset_type="tower"
 *   解析: 同 mapOneEntityRow 通用流程
 *   入资产: 同雷达路径
 *   渲染: asset-store → TowerMaplibre（独立模块，不归入光电 FOV）
 *         → 绘制电侦图标 + 名称标签
 *   超时: 无独立超时机制
 *
 * 【无人机 drone】
 *   接收: entity_status → msg.relationships.airports[].drones[] → drone-store
 *         drone_status → 更新 drone-store.drones（遥测坐标/航向）
 *         high_freq → 更新 drone-store.drones（高频坐标，100ms 级）
 *   解析: applyEntityStatusMessage() 解析 relationships → entityIdToDeviceSn 映射
 *         setDroneStatus() → resolveDroneSn() 将 entityId 映射到 deviceSn
 *   入资产: syncDroneAndAirportAssetsFromRelationships() → asset-store upsert
 *   更新: drone_status / high_freq 消息 → mergeCoords() 合并坐标 → asset-store 更新
 *   渲染: asset-store → DronesMaplibre.setFromAssets()
 *         → buildDroneGeoJSON() 绘制无人机图标 + 名称 + 航线
 *         → extractWaypoints() 从 drone_flight_path 提取航路点
 *   超时: 无独立超时机制，依赖 drone-store 的 entityReady 状态
 *
 * 【机场 airport】
 *   接收: entity_status → msg.relationships.airports[] → drone-store.docks
 *         dock_status → 更新 drone-store.docks（机场遥测）
 *   解析: applyEntityStatusMessage() 解析 relationships
 *         dock.displayName 从下属无人机名称提取编号
 *   入资产: syncDroneAndAirportAssetsFromRelationships() → asset-store upsert
 *   更新: dock_status 消息 → 更新 docks 遥测 → asset-store 更新
 *   渲染: asset-store → AirportMaplibre.setFromAssets()
 *         → 绘制机场图标 + 名称标签
 *   超时: 无独立超时机制
 *
 * 【激光 laser】
 *   接收: entity_status → 同上路径 → specificType="LASER"/"激光" → asset_type="laser"
 *   解析: mapOneEntityRow() 通用流程；静态配置由 laserWeapons bundle 提供
 *         bundle 包含 scan 参数（tickMs/bandCount/bandWidthMeters）和脉冲参数
 *   入资产: 静态 → laserBundleToStaticAssets() → configAssetBase
 *         动态 → 同雷达路径 → asset-store
 *         专题层 → adaptAssetToLaserDevice() → LaserMaplibre.upsert()
 *   更新: entity_status 周期推送 → adaptAssetToLaserDevice() 转换 → LaserMaplibre.upsert()
 *         WS 实体不含 scan/pulse 参数，upsert 时保留静态 bundle 的参数
 *   渲染: LaserMaplibre.flush() → 绘制扇区填充 + 扫描亮带 + 边线 + 中心图标 + 名称
 *         脉冲: activationEnabled=true 时，ensureLaserPulse() 用 setTimeout 循环
 *               亮相（pulseOnMs，默认10s）→ 暗相（pulseOffMs，默认3s）→ 重复
 *               暗相期扇区填充不画，扫描亮带不画
 *         扫描: activationEnabled=true 时，syncScanTimer() 用 setInterval 按 tickMs 刷新
 *   超时: 无独立超时机制
 *
 * 【TDOA】
 *   接收: entity_status → 同上路径 → specificType="TDOA" → asset_type="tdoa"
 *   解析: 同激光；静态配置由 tdoa bundle 提供
 *   入资产: 静态 → tdoaBundleToStaticAssets() → configAssetBase
 *         动态 → 同雷达路径 → asset-store
 *         专题层 → adaptAssetToTdoaDevice() → TdoaMaplibre.upsert()
 *   更新: 同激光，WS 实体不含 scan 参数，upsert 时保留静态 bundle 的参数
 *   渲染: TdoaMaplibre.flush() → 绘制扇区 + 扫描亮带 + 中心图标 + 名称
 *         扫描: 同激光，activationEnabled 时 setInterval 刷新
 *   超时: 无独立超时机制
 *
 * 【巡飞弹 missile】
 *   接收: entity_status → specificType="MISSILE"/"飞弹"（名称、初始坐标；将来实体齐全后为主）
 *         munition_status → applyMunitionWsPayload()（lat/lng/munitionState；不写 name）
 *   入资产: 静态 missiles.devices → configAssetBase；DDS 标 properties.ws_munition
 *   重建: preserveDdsDynamicFieldsOnRebuild() 保留 DDS 几何/状态，名称 row.name || live.name
 *   摧毁: munitionState=3 → 剔除 asset-store + destroyedMunitionIds 防静态复活
 *   渲染: asset-store → MissileStaticMaplibre.setFromAssets()（无独立 munition-store）
 *
 * 【无人船 usv】
 *   接收: usv_status → applyUsvWsPayload()（lat/lng/HDG/strikeState/isVirtualWeapon）
 *   入资产: 静态 unmannedShips.devices → configAssetBase；DDS 标 properties.ws_usv
 *   重建: preserveDdsDynamicFieldsOnRebuild() 保留 DDS 几何/航向/虚兵
 *   渲染: asset-store → UsvStaticMaplibre.setFromAssets()
 *
 * ── entity_status 消息处理流程（共3步）──
 *
 *   后端 WS 推送 type="entity_status" 消息
 *     │
 *     ├─ msg.relationships.airports[] ─→ 第1步: applyEntityStatusMessage()
 *     │   解析机场-无人机归属关系 → drone-store
 *     │   (dock.displayName / drone.displayName / entityIdToDeviceSn 映射)
 *     │
 *     ├─ msg.entities[]（优先）或 msg.data[] ─→ 第2步: mapEntitiesPayload() → mapOneEntityRow() → wsEntityTypeRaw()
 *     │   │
 *     │   │  每条实体通过 specificType 字段识别资产类型：
 *     │   │    ● "Radar-XXX" / "RADAR" / "雷达"  → asset_type = "radar"
 *     │   │    ● navigationParameters.with_radar=1          → asset_type = "radar"（隐式雷达）
 *     │   │    ● "CAMERA" / "OPTOELECTRONIC"      → asset_type = "camera"
 *     │   │    ● "TOWER" / "ESM"                  → asset_type = "tower"
 *     │   │    ● "LASER" / "TDOA" / "DOCK" / "DRONE" → 对应类型
 *     │   │    ● "SURVEILLANCE_AREA" / "FRAME" 等 → "unknown"，跳过不入库
 *     │   │
 *     │   ├─ 提取坐标: 顶层 lat/lng → location.position → 无坐标则丢弃
 *     │   ├─ 提取名称: name / entityName / aliases.name
 *     │   ├─ 雷达参数: radarParameters.range (海里→公里) → properties.max_range_m
 *     │   ├─ 无人船雷达: navigationParameters.maxRangeNm (海里→公里) → properties.max_range_m
 *     │   ├─ 敌我属性: disposition / milView.disposition
 *     │   └─ 健康状态: health.healthStatus → online/offline/degraded
 *     │
 *     │   → applyAssetListFromWs(): 与 app-config.json 静态配置合并
 *     │   → asset-store.setAssets(): 写入 asset-store
 *     │
 *     └─ 第3步: syncDroneAndAirportAssetsFromRelationships()
 *         从 drone-store.relationships 把机场/无人机 upsert 进 asset-store
 *         (名称从第1步解析的 displayName 取，坐标从 relationships 取)
 */

import { useEffect } from "react";
import { toast } from "sonner";
import { getRenderCache, useTrackStore } from "@/stores/track-store";
import type {
  AssetData,
  AssetRelationshipEdge,
  AssetRelationshipGraph,
  AssetRelationshipNode,
} from "@/stores/asset-store";
import { useAssetStore } from "@/stores/asset-store";
import { readMunitionQuantityFromPayload, readVirtualTroop } from "@/lib/drone-runtime-utils";
import { useAppConfigStore } from "@/stores/app-config-store";
import {
  mapEntitiesPayload,
  mergeDynamicAndStaticAssets,
  getDroneMapRenderingConfig,
  getTrackRenderingConfig,
  getWebSocketConfig,
  getHttpConfig,
  shouldDisplayAssetId,
  shouldDisplayDbArea,
  assetStatusFromDeviceState,
  deviceStatePropsFromPayload,
  readBatteryPercentFromPayload,
  readRuntimeTimestampMs,
  preserveDeviceStateFromPrev,
  preserveDdsDynamicFieldsOnRebuild,
  stampDeviceStateOnAsset,
} from "@/lib/map-app-config";
import { normalizeIncomingTrack, normalizeIncomingTrackList } from "@/lib/ws-track-normalize";
import { normalizeAssetType, type Track } from "@/lib/map-entity-model";
import { recordTrackReceived, recordAlertReceived, recordEntityReceived, recordDockReceived, recordDroneReceived, recordDroneFlightPathReceived, recordDbAreasReceived, recordEoDetectionReceived } from "@/stores/network-stats-store";
import { parseForceDisposition } from "@/lib/theme-colors";
import {
  applyMunitionWsPayload,
  filterOutDestroyedMunitions,
  isMunitionDestroyed,
} from "@/lib/munition/munition-runtime";
import { applyUsvWsPayload } from "@/lib/usv/usv-runtime";
import { applyLaserWsPayload, applyTdoaWsPayload } from "@/lib/weapon/weapon-device-runtime";
import { applyHsCameraFovProps, onHsCameraDetection, tickHsCameraDetection } from "@/lib/speed-camera/hs-camera";
import type { AreaTableRow } from "@/lib/area-table-geometry";
import { useDbAreaStore } from "@/stores/db-area-store";
import { useEoDetectionStore } from "@/stores/eo-detection-store";
import { useDzwlAlarmStore } from "@/stores/dzwl-alarm-store";

/** 与 WS 全量资产列表合并：先静态后动态，同 id 以 WS 为准 */
let configAssetBaseCache: AssetData[] = [];
let lastWsAssetList: AssetData[] = [];
let cameraDefaultRangeKmCache: number | undefined;
const droneHistoryTrailCache = new Map<string, Array<[number, number]>>();

type DroneRuntimeOverlay = {
  lat?: number;
  lng?: number;
  heading?: number | null;
  status?: string;
  properties: Record<string, unknown>;
};

const droneRuntimeOverlayById = new Map<string, DroneRuntimeOverlay>();
const pendingDroneAssetPatches = new Map<string, Partial<AssetData>>();
let pendingDronePatchFrame: number | null = null;
const TAKEOFF_DISTANCE_M = 50;
const BOTH_DATA_RECENT_MS = 3000;
const TAKEOFF_RELEASE_DISTANCE_M = 50;
const TAKEOFF_FAR_CONFIRM_COUNT = 3;

function sameRuntimeValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left == null || right == null) return left === right;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => sameRuntimeValue(item, right[index]));
  }
  if (typeof left === "object" || typeof right === "object") {
    if (typeof left !== "object" || typeof right !== "object") return false;
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => sameRuntimeValue(leftRecord[key], rightRecord[key]));
  }
  return false;
}

function patchExistingCameraAsset(
  entityId: string,
  patch: Partial<AssetData>,
): boolean {
  const existing =
    lastWsAssetList.find((item) => item.id === entityId) ??
    useAssetStore.getState().assets.find((item) => item.id === entityId);
  if (!existing) return false;
  const existingProps =
    existing.properties && typeof existing.properties === "object"
      ? (existing.properties as Record<string, unknown>)
      : {};
  const patchProps =
    patch.properties && typeof patch.properties === "object"
      ? (patch.properties as Record<string, unknown>)
      : {};
  const nextRow: AssetData = {
    ...existing,
    ...patch,
    properties: {
      ...existingProps,
      ...patchProps,
    },
    updated_at: existing.updated_at,
  };
  if (
    existing.status === nextRow.status &&
    existing.mission_status === nextRow.mission_status &&
    existing.lat === nextRow.lat &&
    existing.lng === nextRow.lng &&
    existing.heading === nextRow.heading &&
    existing.fov_angle === nextRow.fov_angle &&
    existing.range_km === nextRow.range_km &&
    sameRuntimeValue(existing.properties, nextRow.properties)
  ) {
    return true;
  }
  nextRow.updated_at = new Date().toISOString();
  let replaced = false;
  lastWsAssetList = lastWsAssetList.map((row) => {
    if (row.id !== entityId) return row;
    replaced = true;
    return nextRow;
  });
  if (!replaced) {
    lastWsAssetList = [...lastWsAssetList, nextRow];
  }
  rebuildAndCommitAssetSnapshot();
  return true;
}

function scheduleDroneAssetPatch(entityId: string, patch: Partial<AssetData>): void {
  const prev = pendingDroneAssetPatches.get(entityId) ?? {};
  pendingDroneAssetPatches.set(entityId, {
    ...prev,
    ...patch,
    properties: {
      ...((prev.properties as Record<string, unknown> | undefined) ?? {}),
      ...((patch.properties as Record<string, unknown> | undefined) ?? {}),
    },
  });

  if (pendingDronePatchFrame != null) return;
  const schedule =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16);
  pendingDronePatchFrame = schedule(() => {
    pendingDronePatchFrame = null;
    const entries = [...pendingDroneAssetPatches.entries()];
    pendingDroneAssetPatches.clear();
    const store = useAssetStore.getState();
    for (const [id, itemPatch] of entries) {
      store.mergeAssetFields(id, itemPatch);
    }
  });
}

/**
 * Keep only assets that should be visible under the current app-config rules.
 * This runs after normalization so hidden items do not leak into map rendering,
 * while upstream merge logic can still work on a consistent asset shape.
 */
function filterAssetsForDisplay(assets: AssetData[]): AssetData[] {
  return assets.filter((a) => shouldDisplayAssetId(a.asset_type, a.id, a.name));
}

/**
 * Rebuild the WS relationship graph into the normalized structure stored in `asset-store`.
 * Later consumers use it for airport/drone hierarchy, asset trees, and drone ownership lookups.
 */
function buildRelationshipGraphFromWs(msg: Record<string, unknown>): AssetRelationshipGraph | null {
  const entities = Array.isArray(msg.entities) ? (msg.entities as Record<string, unknown>[]) : [];
  const rel =
    msg.relationships && typeof msg.relationships === "object"
      ? (msg.relationships as Record<string, unknown>)
      : null;
  const rawNodes = Array.isArray(rel?.nodes) ? (rel.nodes as Record<string, unknown>[]) : [];
  const rawEdges = Array.isArray(rel?.edges) ? (rel.edges as Record<string, unknown>[]) : [];

  if (entities.length === 0 && rawNodes.length === 0 && rawEdges.length === 0) return null;

  const nodeMap = new Map<string, AssetRelationshipNode>();
  const upsertNode = (partial: Partial<AssetRelationshipNode> & { id: string }) => {
    const prev = nodeMap.get(partial.id);
    nodeMap.set(partial.id, {
      id: partial.id,
      name: partial.name ?? prev?.name,
      assetType: partial.assetType ?? prev?.assetType,
      latitude: partial.latitude ?? prev?.latitude,
      longitude: partial.longitude ?? prev?.longitude,
      deviceSn: partial.deviceSn ?? prev?.deviceSn,
      gatewaySn: partial.gatewaySn ?? prev?.gatewaySn,
      virtualTroop: partial.virtualTroop ?? prev?.virtualTroop ?? false,
      disposition: partial.disposition ?? prev?.disposition,
    });
  };

  for (const row of entities) {
    const id = String(row.entityId ?? row.id ?? "").trim();
    if (!id) continue;
    const lat = Number(row.lat ?? row.latitude);
    const lng = Number(row.lng ?? row.longitude ?? row.lon);
    upsertNode({
      id,
      name: String(row.name ?? row.entityName ?? row.entityId ?? "").trim() || undefined,
      assetType: String(row.assetType ?? row.asset_type ?? "").trim() || undefined,
      latitude: Number.isFinite(lat) ? lat : undefined,
      longitude: Number.isFinite(lng) ? lng : undefined,
      deviceSn: String(row.deviceSn ?? row.device_sn ?? "").trim() || undefined,
      gatewaySn: String(row.gatewaySn ?? row.gateway_sn ?? "").trim() || undefined,
      virtualTroop: readVirtualTroop(row),
      disposition: parseForceDisposition(row.disposition, undefined),
    });
  }

  for (const row of rawNodes) {
    const id = String(row.id ?? row.entityId ?? "").trim();
    if (!id) continue;
    const lat = Number(row.lat ?? row.latitude);
    const lng = Number(row.lng ?? row.longitude ?? row.lon);
    upsertNode({
      id,
      name: String(row.name ?? row.entityName ?? "").trim() || undefined,
      assetType: String(row.assetType ?? row.asset_type ?? "").trim() || undefined,
      latitude: Number.isFinite(lat) ? lat : undefined,
      longitude: Number.isFinite(lng) ? lng : undefined,
      deviceSn: String(row.deviceSn ?? row.device_sn ?? "").trim() || undefined,
      gatewaySn: String(row.gatewaySn ?? row.gateway_sn ?? "").trim() || undefined,
      virtualTroop: readVirtualTroop(row),
      disposition: parseForceDisposition(row.disposition, undefined),
    });
  }

  const seenEdges = new Set<string>();
  const edges: AssetRelationshipEdge[] = [];
  for (const row of rawEdges) {
    const parent = String(row.parent ?? row.parentId ?? "").trim();
    const child = String(row.child ?? row.childId ?? "").trim();
    if (!parent || !child) continue;
    const key = `${parent}=>${child}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    if (!nodeMap.has(parent)) upsertNode({ id: parent, virtualTroop: false });
    if (!nodeMap.has(child)) upsertNode({ id: child, virtualTroop: false });
    edges.push({
      parent,
      child,
      relationshipId: String(row.relationshipId ?? row.id ?? "").trim() || undefined,
    });
  }

  return { nodes: [...nodeMap.values()], edges };
}

function buildEntityMappingsFromRelationships(relationships: AssetRelationshipGraph | null): {
  entityIdToDeviceSn: Record<string, string>;
  deviceSnToEntityId: Record<string, string>;
  dockSnToEntityId: Record<string, string>;
} {
  /**
   * The relationship graph keeps ids and serial numbers side by side.
   * We precompute both directions here because downstream WS payloads are inconsistent:
   * some packets identify drones by entity id, others by device serial number.
   *
   * These maps let later handlers patch the correct asset row without duplicating
   * lookup logic in every message type branch.
   */
  const entityIdToDeviceSn: Record<string, string> = {};
  const deviceSnToEntityId: Record<string, string> = {};
  const dockSnToEntityId: Record<string, string> = {};

  for (const node of relationships?.nodes ?? []) {
    const type = String(node.assetType ?? "").trim().toLowerCase();
    const deviceSn = String(node.deviceSn ?? "").trim();
    if (type === "drone" && deviceSn) {
      entityIdToDeviceSn[node.id] = deviceSn;
      deviceSnToEntityId[deviceSn] = node.id;
    }
    if (type === "airport" && deviceSn) {
      dockSnToEntityId[deviceSn] = node.id;
    }
  }

  for (const asset of useAssetStore.getState().assets) {
    if (normalizeAssetType(asset.asset_type) !== "drone") continue;
    const props =
      asset.properties && typeof asset.properties === "object"
        ? (asset.properties as Record<string, unknown>)
        : null;
    const deviceSn = String(props?.deviceSn ?? props?.device_sn ?? "").trim();
    if (!deviceSn) continue;
    if (!entityIdToDeviceSn[asset.id]) entityIdToDeviceSn[asset.id] = deviceSn;
    if (!deviceSnToEntityId[deviceSn]) deviceSnToEntityId[deviceSn] = asset.id;
  }

  return { entityIdToDeviceSn, deviceSnToEntityId, dockSnToEntityId };
}

function resolveDroneEntityIdFromAssets(data: Record<string, unknown>): string | null {
  /**
   * Resolve the canonical drone asset id used in `asset-store`.
   *
   * Resolution order:
   * 1. explicit entity id in the payload
   * 2. serial number -> entity id mapping
   * 3. nested drone/uav payloads reused by some message types
   *
   * Returning `null` is intentional: callers should skip patching instead of
   * creating a speculative drone asset from partial runtime data.
   */
  const state = useAssetStore.getState();
  const eid = String(data.entityId ?? data.entity_id ?? "").trim();
  if (eid) {
    const asset = state.assets.find((item) => item.id === eid);
    if (asset) return eid;
    const mapped = state.deviceSnToEntityId[eid];
    if (mapped) return mapped;
    const byDeviceSn = state.assets.find((item) => {
      if (item.asset_type !== "drone") return false;
      const props =
        item.properties && typeof item.properties === "object"
          ? (item.properties as Record<string, unknown>)
          : null;
      return String(props?.deviceSn ?? props?.device_sn ?? "").trim() === eid;
    });
    if (byDeviceSn) return byDeviceSn.id;
  }
  const directSn = String(data.deviceSn ?? data.drone_sn ?? data.sn ?? data.device_sn ?? data.droneSn ?? "").trim();
  if (directSn) {
    const mapped = state.deviceSnToEntityId[directSn];
    if (mapped) return mapped;
    const byDeviceSn = state.assets.find((item) => {
      if (item.asset_type !== "drone") return false;
      const props =
        item.properties && typeof item.properties === "object"
          ? (item.properties as Record<string, unknown>)
          : null;
      return String(props?.deviceSn ?? props?.device_sn ?? "").trim() === directSn;
    });
    if (byDeviceSn) return byDeviceSn.id;
  }
  const drone = data.drone ?? data.uav;
  if (drone && typeof drone === "object") {
    return resolveDroneEntityIdFromAssets(drone as Record<string, unknown>);
  }
  return null;
}

function resolveDockEntityIdFromPayload(data: Record<string, unknown>): string | null {
  /**
   * Dock runtime status must update by entity id. The SN mapping below is only
   * a temporary test bridge until DDS starts sending entityId for this dock.
   */
  const eid = String(data.entityId ?? data.entity_id ?? "").trim();
  if (eid) return eid;
  return null;
}

function relationshipNodeById(
  relationships: AssetRelationshipGraph | null,
  id: string,
): AssetRelationshipNode | null {
  return relationships?.nodes.find((node) => node.id === id) ?? null;
}

function readLatLngFromRuntimePayload(data: Record<string, unknown>): { lat: number; lng: number } | null {
  /**
   * Live payloads are not fully consistent on field naming.
   * This helper centralizes the accepted aliases and returns `null` instead of
   * fabricating coordinates when the packet is incomplete.
   */
  const lat = Number(data.latitude ?? data.lat);
  const lng = Number(data.longitude ?? data.lng ?? data.lon);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return null;
}

function omitRuntimePositionFields(data: Record<string, unknown>): Record<string, unknown> {
  const {
    lat,
    lng,
    lon,
    latitude,
    longitude,
    elevation,
    height,
    altitude,
    heading,
    headingDeg,
    attitude_head,
    course,
    yaw,
    gimbal_yaw,
    ...rest
  } = data;
  void lat;
  void lng;
  void lon;
  void latitude;
  void longitude;
  void elevation;
  void height;
  void altitude;
  void heading;
  void headingDeg;
  void attitude_head;
  void course;
  void yaw;
  void gimbal_yaw;
  return rest;
}

function readSpeedMpsFromRuntimePayload(data: Record<string, unknown>): number | null {
  const velocity = data.velocity && typeof data.velocity === "object"
    ? (data.velocity as Record<string, unknown>)
    : null;
  const speed = Number(
    data.speed_mps ??
      data.speedMps ??
      data.speed_ms ??
      data.speed ??
      data.groundSpeed ??
      data.ground_speed ??
      data.horizontalSpeed ??
      data.horizontal_speed ??
      velocity?.speed_mps ??
      velocity?.speedMps ??
      velocity?.speed_ms ??
      velocity?.speed,
  );
  if (Number.isFinite(speed)) return speed;

  const northRaw = data.speed_N ?? data.speedN ?? data.north_mps ?? velocity?.north_mps ?? velocity?.n;
  const eastRaw = data.speed__E ?? data.speed_E ?? data.speedE ?? data.east_mps ?? velocity?.east_mps ?? velocity?.e;
  const upRaw = data.speed_V ?? data.speedV ?? data.up_mps ?? velocity?.up_mps ?? velocity?.u;
  if (northRaw != null || eastRaw != null || upRaw != null) {
    const north = Number(northRaw);
    const east = Number(eastRaw);
    const up = Number(upRaw);
    const n = Number.isFinite(north) ? north : 0;
    const e = Number.isFinite(east) ? east : 0;
    const u = Number.isFinite(up) ? up : 0;
    return Math.sqrt(n * n + e * e + u * u);
  }
  return null;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function appendDroneHistoryTrail(
  entityId: string,
  prevProps: Record<string, unknown>,
  lat: number,
  lng: number,
): Array<[number, number]> {
  /**
   * History trail is stored directly on the asset's runtime properties so:
   * - 2D and 3D renderers can share it
   * - trail rendering survives snapshot rebuilds
   * - we do not need a second in-memory drone-specific runtime store
   *
   * The 1-meter dedupe threshold prevents very noisy high-frequency packets from
   * exploding the trail length without adding visible value.
  */
  const cfg = getDroneMapRenderingConfig();
  if (!cfg.showHistoryTrail) return [];
  const rawTrail = droneHistoryTrailCache.get(entityId) ?? (Array.isArray(prevProps.history_trail) ? prevProps.history_trail : []);
  const trail: Array<[number, number]> = rawTrail
    .map((item) =>
      Array.isArray(item) && item.length >= 2 && Number.isFinite(Number(item[0])) && Number.isFinite(Number(item[1]))
        ? [Number(item[0]), Number(item[1])] as [number, number]
        : null,
    )
    .filter((item): item is [number, number] => item != null);
  const last = trail[trail.length - 1];
  if (last) {
    const [prevLng, prevLat] = last;
    const distanceM = haversineMeters(prevLat, prevLng, lat, lng);
    if (distanceM < 1) {
      return trail;
    }
  }
  trail.push([lng, lat]);
  const max = Math.max(2, Math.floor(cfg.maxHistoryPoints));
  while (trail.length > max) trail.shift();
  return trail;
}

function readDroneRuntimeOverlayProps(entityId: string): Record<string, unknown> {
  const asset = useAssetStore.getState().assets.find((item) => item.id === entityId);
  const assetProps =
    asset?.properties && typeof asset.properties === "object"
      ? (asset.properties as Record<string, unknown>)
      : {};
  const overlayProps = droneRuntimeOverlayById.get(entityId)?.properties ?? {};
  return {
    ...assetProps,
    ...overlayProps,
  };
}

function patchDroneRuntimeOverlay(
  entityId: string,
  patch: {
    lat?: number;
    lng?: number;
    heading?: number | null;
    status?: string;
    properties?: Record<string, unknown>;
  },
) {
  const prev = droneRuntimeOverlayById.get(entityId);
  const next: DroneRuntimeOverlay = {
    lat: patch.lat ?? prev?.lat,
    lng: patch.lng ?? prev?.lng,
    heading: patch.heading !== undefined ? patch.heading : prev?.heading,
    status: patch.status ?? prev?.status,
    properties: {
      ...(prev?.properties ?? {}),
      ...(patch.properties ?? {}),
    },
  };
  if (prev && sameRuntimeValue(prev, next)) return;
  droneRuntimeOverlayById.set(entityId, next);

  const existing = useAssetStore.getState().assets.find((item) => item.id === entityId);
  if (!existing) return;
  const existingProps =
    existing.properties && typeof existing.properties === "object"
      ? (existing.properties as Record<string, unknown>)
      : {};
  const assetPatch: Partial<AssetData> = {
    properties: {
      ...existingProps,
      ...next.properties,
    },
  };
  if (Number.isFinite(next.lat)) assetPatch.lat = next.lat;
  if (Number.isFinite(next.lng)) assetPatch.lng = next.lng;
  if (next.heading !== undefined) assetPatch.heading = next.heading;
  if (next.status) assetPatch.status = next.status;
  scheduleDroneAssetPatch(entityId, assetPatch);
}

function baseDronePositionFromAsset(entityId: string): { lat: number; lng: number } | null {
  const row = [...lastWsAssetList, ...configAssetBaseCache].find((item) => item.id === entityId);
  if (row && Number.isFinite(row.lat) && Number.isFinite(row.lng)) {
    return { lat: row.lat, lng: row.lng };
  }
  return null;
}

function baseDronePositionFromDock(entityId: string): { lat: number; lng: number } | null {
  const state = useAssetStore.getState();
  const relationships = state.relationships;
  if (!relationships) return null;
  const edge = relationships.edges.find((item) => item.child === entityId);
  if (!edge) return null;
  const parentNode = relationships.nodes.find((node) => node.id === edge.parent);
  if (!parentNode) return null;
  if (!Number.isFinite(parentNode.latitude) || !Number.isFinite(parentNode.longitude)) return null;
  return {
    lat: Number(parentNode.latitude),
    lng: Number(parentNode.longitude),
  };
}

function baseDronePosition(entityId: string): { lat: number; lng: number } | null {
  return baseDronePositionFromAsset(entityId) ?? baseDronePositionFromDock(entityId);
}

function readDroneFlightStatusFromAsset(entityId: string): number | null {
  const asset = useAssetStore.getState().assets.find((item) => item.id === entityId);
  const props =
    asset?.properties && typeof asset.properties === "object"
      ? (asset.properties as Record<string, unknown>)
      : null;
  const flightParameters =
    props?.flightParameters && typeof props.flightParameters === "object"
      ? (props.flightParameters as Record<string, unknown>)
      : null;
  const n = Number(flightParameters?.flightStatus ?? props?.flightStatus ?? props?.flight_status);
  return Number.isFinite(n) ? n : null;
}

function readDroneRuntimeMeta(entityId: string): {
  isTakingOff: boolean;
  wasLanded: boolean;
  lastStatusAcceptedAt: number | null;
  lastHighFreqAcceptedAt: number | null;
} {
  const props = readDroneRuntimeOverlayProps(entityId);
  const isTakingOff = props.isTakingOff === true;
  const wasLanded = props.wasLanded === true;
  const lastStatusAcceptedAt = Number(props.lastStatusAcceptedAt);
  const lastHighFreqAcceptedAt = Number(props.lastHighFreqAcceptedAt);
  return {
    isTakingOff,
    wasLanded,
    lastStatusAcceptedAt: Number.isFinite(lastStatusAcceptedAt) ? lastStatusAcceptedAt : null,
    lastHighFreqAcceptedAt: Number.isFinite(lastHighFreqAcceptedAt) ? lastHighFreqAcceptedAt : null,
  };
}

function shouldStartTakeoff(entityId: string): boolean {
  const meta = readDroneRuntimeMeta(entityId);
  if (meta.isTakingOff) return true;
  if (meta.wasLanded) return true;
  if (meta.lastStatusAcceptedAt == null && meta.lastHighFreqAcceptedAt == null) return true;
  const flightStatus = readDroneFlightStatusFromAsset(entityId);
  return flightStatus === 14;
}

function shouldDiscardByTakeoff(
  entityId: string,
  lng: number,
  lat: number,
): { discard: boolean; farDistanceMeters: number | null } {
  const meta = readDroneRuntimeMeta(entityId);
  if (!meta.isTakingOff && !shouldStartTakeoff(entityId)) return { discard: false, farDistanceMeters: null };
  const base = baseDronePosition(entityId);
  if (!base) return { discard: true, farDistanceMeters: null };
  const dist = haversineMeters(base.lat, base.lng, lat, lng);
  if (dist <= TAKEOFF_DISTANCE_M) return { discard: false, farDistanceMeters: null };
  const props = readDroneRuntimeOverlayProps(entityId);
  const farCount = Number(props.takeoff_far_count);
  const nextFarCount = (Number.isFinite(farCount) ? farCount : 0) + 1;
  return {
    discard: nextFarCount < TAKEOFF_FAR_CONFIRM_COUNT,
    farDistanceMeters: dist,
  };
}

function updateTakeoffState(
  entityId: string,
  currentTime: number,
  acceptedPos?: { lat: number; lng: number } | null,
  farDistanceMeters?: number | null,
): Record<string, unknown> {
  const meta = readDroneRuntimeMeta(entityId);
  const isTakingOff = meta.isTakingOff || shouldStartTakeoff(entityId);
  if (!isTakingOff) return {};
  const base = baseDronePosition(entityId);
  if (base && acceptedPos) {
    const dist = haversineMeters(base.lat, base.lng, acceptedPos.lat, acceptedPos.lng);
    if (dist > TAKEOFF_RELEASE_DISTANCE_M) {
      return { isTakingOff: false, wasLanded: false, takeoff_far_count: null, takeoff_far_distance_m: dist };
    }
  }
  if (farDistanceMeters != null) {
    const props = readDroneRuntimeOverlayProps(entityId);
    const farCount = Number(props.takeoff_far_count);
    const nextFarCount = (Number.isFinite(farCount) ? farCount : 0) + 1;
    if (nextFarCount >= TAKEOFF_FAR_CONFIRM_COUNT) {
      return {
        isTakingOff: false,
        wasLanded: false,
        takeoff_far_count: null,
        takeoff_far_distance_m: farDistanceMeters,
      };
    }
    return {
      isTakingOff: true,
      wasLanded: false,
      takeoff_far_count: nextFarCount,
      takeoff_far_distance_m: farDistanceMeters,
    };
  }
  const statusOk = meta.lastStatusAcceptedAt != null && currentTime - meta.lastStatusAcceptedAt <= BOTH_DATA_RECENT_MS;
  const highFreqOk = meta.lastHighFreqAcceptedAt != null && currentTime - meta.lastHighFreqAcceptedAt <= BOTH_DATA_RECENT_MS;
  if (statusOk && highFreqOk) {
    return { isTakingOff: false, wasLanded: false, takeoff_far_count: null, takeoff_far_distance_m: null };
  }
  return { isTakingOff: true, wasLanded: false, takeoff_far_count: null, takeoff_far_distance_m: null };
}

function isHighFreqFresh(entityId: string, currentTime: number): boolean {
  const props = readDroneRuntimeOverlayProps(entityId);
  const receivedAt = Number(props.high_freq_received_at_ms);
  if (!Number.isFinite(receivedAt)) return false;
  return currentTime - receivedAt <= Math.max(0, getDroneMapRenderingConfig().highFreqPositionMaxAgeMs);
}

function applyDroneRuntimeOverlayToRow(row: AssetData): AssetData {
  if (normalizeAssetType(row.asset_type) !== "drone") return row;
  const overlay = droneRuntimeOverlayById.get(row.id);
  if (!overlay) return row;
  const rowProps =
    row.properties && typeof row.properties === "object"
      ? (row.properties as Record<string, unknown>)
      : {};
  return {
    ...row,
    ...(Number.isFinite(overlay.lat) ? { lat: overlay.lat } : {}),
    ...(Number.isFinite(overlay.lng) ? { lng: overlay.lng } : {}),
    ...(overlay.heading !== undefined ? { heading: overlay.heading } : {}),
    ...(overlay.status ? { status: overlay.status } : {}),
    properties: {
      ...rowProps,
      ...overlay.properties,
    },
  };
}

async function reloadAppConfigAssetBase() {
  const cfg = await useAppConfigStore.getState().ensureLoaded();
  configAssetBaseCache = cfg.configAssetBase;
  const rootDefaultRangeM = Number(cfg.cameras?.defaultRange);
  cameraDefaultRangeKmCache =
    Number.isFinite(rootDefaultRangeM) && rootDefaultRangeM > 0
      ? rootDefaultRangeM / 1000
      : undefined;
  rebuildAndCommitAssetSnapshot();
}

/** 资产总入口：静态配置 + WS 实体统一合并后一次性写入 */
function rebuildAndCommitAssetSnapshot() {
  const mergedStaticAndWs = mergeDynamicAndStaticAssets(
    filterOutDestroyedMunitions(configAssetBaseCache),
    filterOutDestroyedMunitions(lastWsAssetList),
  );
  const state = useAssetStore.getState();
  const aliasToCanonical = new Map<string, string>();
  for (const row of mergedStaticAndWs) {
    if (normalizeAssetType(row.asset_type) !== "drone") continue;
    const props =
      row.properties && typeof row.properties === "object"
        ? (row.properties as Record<string, unknown>)
        : null;
    const deviceSn = String(props?.deviceSn ?? props?.device_sn ?? "").trim();
    if (deviceSn && deviceSn !== row.id) aliasToCanonical.set(deviceSn, row.id);
  }
  for (const [entityId, deviceSn] of Object.entries(state.entityIdToDeviceSn)) {
    if (entityId && deviceSn) aliasToCanonical.set(deviceSn, entityId);
  }
  const dedupedRows = new Map<string, AssetData>();
  for (const row of mergedStaticAndWs) {
    if (normalizeAssetType(row.asset_type) !== "drone") {
      dedupedRows.set(row.id, row);
      continue;
    }
    const props =
      row.properties && typeof row.properties === "object"
        ? (row.properties as Record<string, unknown>)
        : null;
    const deviceSn = String(props?.deviceSn ?? props?.device_sn ?? "").trim();
    const canonicalId = aliasToCanonical.get(row.id) ?? (deviceSn ? aliasToCanonical.get(deviceSn) : undefined) ?? row.id;
    const normalizedRow =
      canonicalId === row.id
        ? row
        : {
            ...row,
            id: canonicalId,
            properties: {
              ...(props ?? {}),
              entityId: canonicalId,
              entity_id: canonicalId,
              ...(deviceSn ? { deviceSn, device_sn: deviceSn } : {}),
            },
          };
    const prev = dedupedRows.get(canonicalId);
    if (!prev) {
      dedupedRows.set(canonicalId, normalizedRow);
      continue;
    }
    const prevProps =
      prev.properties && typeof prev.properties === "object"
        ? (prev.properties as Record<string, unknown>)
        : null;
    const nextProps =
      normalizedRow.properties && typeof normalizedRow.properties === "object"
        ? (normalizedRow.properties as Record<string, unknown>)
        : null;
    dedupedRows.set(canonicalId, {
      ...prev,
      ...normalizedRow,
      name:
        String(normalizedRow.name ?? "").trim() && String(normalizedRow.name ?? "").trim() !== normalizedRow.id
          ? normalizedRow.name
          : prev.name,
      lat: Number.isFinite(normalizedRow.lat) ? normalizedRow.lat : prev.lat,
      lng: Number.isFinite(normalizedRow.lng) ? normalizedRow.lng : prev.lng,
      heading:
        normalizedRow.heading != null && Number.isFinite(Number(normalizedRow.heading))
          ? Number(normalizedRow.heading)
          : prev.heading,
      fov_angle:
        normalizedRow.fov_angle != null && Number.isFinite(Number(normalizedRow.fov_angle))
          ? Number(normalizedRow.fov_angle)
          : prev.fov_angle,
      range_km:
        normalizedRow.range_km != null && Number.isFinite(Number(normalizedRow.range_km))
          ? Number(normalizedRow.range_km)
          : prev.range_km,
      properties: {
        ...(prevProps ?? {}),
        ...(nextProps ?? {}),
      },
    });
  }
  const liveById = new Map(
    state.assets.filter((a) => !isMunitionDestroyed(a.id)).map((a) => [a.id, a]),
  );
  let mergedAll = [...dedupedRows.values()];
  mergedAll = mergedAll.filter(
    (row) => !(normalizeAssetType(row.asset_type) === "missile" && isMunitionDestroyed(row.id)),
  );
  /* entity_status 重建：机场/无人机保留 deviceState；激光/TDOA/巡飞弹保留 DDS 实时字段（见 map-app-config） */
  mergedAll = mergedAll.map((row) => {
    const live = liveById.get(row.id);
    if (!live) return row;
    const at = normalizeAssetType(row.asset_type);
    if (at === "airport") {
      return preserveDeviceStateFromPrev(live, row);
    }
    return preserveDdsDynamicFieldsOnRebuild(live, row) ?? row;
  });
  const stamped = mergedAll.map((row) => stampDeviceStateOnAsset(applyDroneRuntimeOverlayToRow(row)));
  useAssetStore.getState().setAssets(filterAssetsForDisplay(stamped));
}

/** Normalize `position.altitude` into properties.altitude for the 3D model base height. */
function withNormalizedAltitude(
  props: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!props || typeof props !== "object") return props;
  const next = { ...props } as Record<string, unknown>;
  const pos = next.position as Record<string, unknown> | undefined;
  if (next.altitude == null || !Number.isFinite(Number(next.altitude))) {
    const posAlt = Number(pos?.altitude ?? pos?.alt);
    if (Number.isFinite(posAlt)) next.altitude = posAlt;
  }
  return next;
}

/** WS 列表级合并：新帧字段缺失/无效时，保留上一帧同 id 的数值字段，避免被 null 覆盖 */
function mergeWsRowsPreserveNullableNumeric(prevRows: AssetData[], incomingRows: AssetData[]): AssetData[] {
  if (prevRows.length === 0) return incomingRows;
  const prevById = new Map(prevRows.map((r) => [r.id, r]));
  return incomingRows.map((row) => {
    const prev = prevById.get(row.id);
    if (!prev) return row;
    const prevProps =
      prev.properties && typeof prev.properties === "object"
        ? (prev.properties as Record<string, unknown>)
        : null;
    const rowProps =
      row.properties && typeof row.properties === "object"
        ? (row.properties as Record<string, unknown>)
        : null;
    const mergedProps = withNormalizedAltitude({
      ...(prevProps ?? {}),
      ...(rowProps ?? {}),
    });
    const preservePrevCoords =
      Number.isFinite(prev.lat) &&
      Number.isFinite(prev.lng) &&
      !(prev.lat === 0 && prev.lng === 0) &&
      Number.isFinite(row.lat) &&
      Number.isFinite(row.lng) &&
      row.lat === 0 &&
      row.lng === 0;
    const merged = {
      ...row,
      ...(preservePrevCoords ? { lat: prev.lat, lng: prev.lng } : {}),
      ...(mergedProps ? { properties: mergedProps } : {}),
      heading:
        row.heading != null && Number.isFinite(Number(row.heading))
          ? Number(row.heading)
          : prev.heading,
      fov_angle:
        row.fov_angle != null && Number.isFinite(Number(row.fov_angle))
          ? Number(row.fov_angle)
          : prev.fov_angle,
      range_km:
        row.range_km != null && Number.isFinite(Number(row.range_km))
          ? Number(row.range_km)
          : prev.range_km,
    };
    const preserved = preserveDeviceStateFromPrev(prev, merged);
    const nextName = String(preserved.name ?? "").trim();
    const prevName = String(prev.name ?? "").trim();
    if ((!nextName || nextName === preserved.id) && prevName && prevName !== prev.id) {
      return { ...preserved, name: prev.name };
    }
    return preserved;
  });
}

/**
 * 【第2步核心】把 WS 推来的资产列表（雷达、光电等）与本地静态配置合并，整体替换 asset-store。
 *
 * ── 合并策略 ──
 * 1. 以 configAssetBaseCache（app-config.json 静态解析结果）为底
 * 2. WS 列表按 id 覆盖/追加到静态底数（同 id 以 WS 动态值为准）
 * 3. heading / fov_angle / range_km：WS 值为 null 时保留静态值（避免覆盖丢失）
 * 4. 过滤掉显隐黑名单中的资产（shouldDisplayAssetId）
 *
 * @param list - mapEntitiesPayload 解析后的 AssetData 数组（已通过 specificType 识别类型）
 */
function applyAssetListFromWs(list: AssetData[], options?: { commit?: boolean }) {
  const normalizedIncoming = list.map((a) => {
    if (a.asset_type !== "camera") return a;
    // entity_status 里的 camera 行不含实时 PTZ，只更新属性；高速相机在此补 fov_sector_visible
    const props = { ...((a.properties as Record<string, unknown> | null) ?? {}) };
    applyHsCameraFovProps(a.id, props);
    return {
      ...a,
      heading: null,
      fov_angle: null,
      range_km: null,
      properties: props,
    };
  });
  const incomingIds = new Set(normalizedIncoming.map((item) => item.id));
  const preservedMissingRows = lastWsAssetList.filter((asset) => !incomingIds.has(asset.id));
  const nonDroneList = filterOutDestroyedMunitions([
    ...normalizedIncoming,
    ...preservedMissingRows,
  ]);
  lastWsAssetList = mergeWsRowsPreserveNullableNumeric(lastWsAssetList, nonDroneList);
  if (options?.commit !== false) rebuildAndCommitAssetSnapshot();
}

const ws = {
  running: false,
  socket: null as WebSocket | null,
  reconnectTimer: null as ReturnType<typeof setTimeout> | null,
  reconnectAttempt: 0,
  heartbeatTimer: null as ReturnType<typeof setInterval> | null,
  readyNotified: false,
  trackPruneTimer: null as ReturnType<typeof setInterval> | null,
  droneRuntimePruneTimer: null as ReturnType<typeof setInterval> | null,
  alarmCleanupTimer: null as ReturnType<typeof setInterval> | null,
  speedCameraPruneTimer: null as ReturnType<typeof setInterval> | null,
  alertRevisionUnsub: null as (() => void) | null,
  imagePollTimer: null as ReturnType<typeof setInterval> | null,
};

function notify(title: string, body: string | undefined, variant: "info" | "success" | "error") {
  if (variant === "error") toast.error(title, { description: body });
  else if (variant === "success") toast.success(title, { description: body });
  else toast.info(title, { description: body });
}

function clearReconnectTimer() {
  if (ws.reconnectTimer) clearTimeout(ws.reconnectTimer);
  ws.reconnectTimer = null;
}

function clearHeartbeat() {
  if (ws.heartbeatTimer) clearInterval(ws.heartbeatTimer);
  ws.heartbeatTimer = null;
}

function backoffMs(): number {
  const cfg = getWebSocketConfig();
  return Math.min(cfg.maxReconnectMs, cfg.initialReconnectMs * Math.pow(2, Math.min(ws.reconnectAttempt, 4)));
}

/** 光电 WS 载荷中解析 WGS84；支持 `position` 嵌套或顶层 lat/lng */
function extractCameraLatLng(d: Record<string, unknown>): { lat: number; lng: number } | null {
  const pos = d.position;
  if (pos && typeof pos === "object") {
    const p = pos as Record<string, unknown>;
    const lat = Number(p.latitude ?? p.lat);
    const lng = Number(p.longitude ?? p.lng ?? p.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  const lat = Number(d.latitude ?? d.lat);
  const lng = Number(d.longitude ?? d.lng ?? d.lon);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return null;
}

/** 相机实时朝向（度）：当前协议固定用 `originPtz.pan`（无则 `ptz.pan`），不做默认值兜底。 */
function parseCameraBearingDeg(d: Record<string, unknown>): number | undefined {
  const originPtz = d.originPtz as Record<string, unknown> | undefined;
  const ptz = d.ptz as Record<string, unknown> | undefined;
  const v = originPtz?.pan ?? ptz?.pan ?? d.pan ?? d.panVehicle;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 相机实时视场开角（度）：当前协议固定用 `fov.horizontal`，不做默认值兜底。 */
function parseCameraHorizontalFovDeg(d: Record<string, unknown>): number | undefined {
  const fov = d.fov as Record<string, unknown> | undefined;
  const v = fov?.horizontal;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** 相机实时射程（千米）：当前协议固定用 `range_km`，不做默认值兜底。 */
function parseCameraRangeKm(d: Record<string, unknown>): number | undefined {
  if (d.range_km != null) {
    const n = Number(d.range_km);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

/** 相机默认量程（千米）：仅在实时消息未提供 `range_km` 时使用。 */
function cameraDefaultRangeKm(entityId: string): number | undefined {
  const row = configAssetBaseCache.find((a) => a.id === entityId);
  const n = row?.range_km != null ? Number(row.range_km) : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  return cameraDefaultRangeKmCache;
}

// ── Zone 解析 ──

function applyAssetWsEvent(ev: Record<string, unknown>) {
  if (ev.type !== "asset_arrived") return;
  const id = String(ev.assetId ?? "");
  if (!id) return;
  const lat = Number(ev.lat);
  const lng = Number(ev.lng);
  const patch: Partial<AssetData> = { mission_status: "monitoring" };
  if (Number.isFinite(lat) && Number.isFinite(lng)) { patch.lat = lat; patch.lng = lng; }
  const hRaw = ev.heading ?? ev.bearing ?? ev.azimuth;
  if (hRaw != null && Number.isFinite(Number(hRaw))) patch.heading = Number(hRaw);
  const fovRaw = ev.fov_angle ?? ev.fovAngle ?? ev.openingDeg;
  if (fovRaw != null && Number.isFinite(Number(fovRaw))) patch.fov_angle = Number(fovRaw);
  useAssetStore.getState().mergeAssetFields(id, patch);
}

function resolveRadarAssetIdFromPayload(d: Record<string, unknown>): string {
  const ids = [
    d.entityId,
    d.entity_id,
    d.id,
    d.radarID,
    d.radar_id,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (ids.length === 0) return "";

  const assets = useAssetStore.getState().assets;
  for (const id of ids) {
    const direct = assets.find((a) => a.id === id && normalizeAssetType(a.asset_type) === "radar");
    if (direct) return direct.id;
  }

  const radarIdSet = new Set(ids);
  const byRadarId = assets.find((a) => {
    if (normalizeAssetType(a.asset_type) !== "radar") return false;
    const props = a.properties && typeof a.properties === "object" ? (a.properties as Record<string, unknown>) : {};
    return radarIdSet.has(String(props.radarID ?? props.radar_id ?? "").trim());
  });
  return byRadarId?.id ?? "";
}

function payloadArray(msg: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(msg.data)) return msg.data as unknown[];
  if (Array.isArray(msg.assets)) return msg.assets as unknown[];
  if (Array.isArray(msg.entities)) return msg.entities as unknown[];
  return null;
}

// ── 告警 taskStatus 判断 ──

/**
 * 【消息分发】WebSocket 收到消息后的统一入口。
 *
 * 解析 JSON 后按 msg.type 分发到对应处理逻辑：
 *
 * ┌─ type ─────────────┬─ 处理说明 ────────────────────────────────────────────────────────┐
 * │ trackbatch / track │ 航迹数据 → normalizeIncomingTrack → track-store.setTracks       │
 * │ DbAreas            │ 区域/航线数据 → shouldDisplayDbArea → db-area-store.setRows       │
 * │ entity_status      │ 【核心】实体状态（雷达/相机/无人机/机场），见下方详细流程           │
 * │ camera / optoelec  │ 光电实时数据（PTZ朝向/视场角/坐标）→ 更新 asset-store 已有光电    │
 * │ dock_status        │ 机场状态 → 更新 drone-store.docks + asset-store 已有机场         │
 * │ drone_status       │ 无人机遥测 → 更新 drone-store.drones（仅更新不新增）             │
 * │ high_freq          │ 无人机高频坐标 → 更新 drone-store.drones                         │
 * │ drone_flight_path  │ 无人机航线 → 更新 drone-store.drones                             │
 * │ heartbeat          │ 心跳 → 回复 pong                                                 │
 * └────────────────────┴──────────────────────────────────────────────────────────────────┘
 *
 * entity_status 完整流程（雷达/相机/机场/无人机）：
 *   接收 WS 消息 → JSON.parse → 按 type 路由到 entity_status 分支
 *   → 第1步：解析 relationships（机场/无人机）→ drone-store
 *   → 第2步：解析 data 数组（雷达/相机等）→ mapEntitiesPayload → mapOneEntityRow → wsEntityTypeRaw
 *            （specificType "Radar-XXX" → radar, "CAMERA" → camera）
 *            → applyAssetListFromWs → 与静态配置合并 → asset-store.setAssets
 *   → 第3步：同步 airport/drone 到 asset-store
 */
function dispatchWsMessage(raw: string) {
  try {
    const msg = JSON.parse(raw) as Record<string, unknown>;
    const type = String(msg.type ?? msg.data_type ?? "").toLowerCase();
    if (!type) return;

    switch (type) {
      // ── 航迹 ──
      case "trackbatch": {
        // V2 trackBatch: data = [{ type: "Track", data: {...} }]
        const arr = msg.data;
        if (Array.isArray(arr)) {
          const tracks = arr
            .map((item) => {
              if (!item || typeof item !== "object") return null;
              const envelope = item as Record<string, unknown>;
              const inner = envelope.data ?? envelope;
              return normalizeIncomingTrack(inner);
            })
            .filter(Boolean);
          if (tracks.length) {
            useTrackStore.getState().setTracks(tracks as Track[]);
            for (const t of tracks as Track[]) recordTrackReceived(!!t.isAirTrack);
          }
        }
        if (msg.timestamp) useTrackStore.getState().setLastUpdate(String(msg.timestamp));
        break;
      }
      case "track": {
        // V2 单条 Track
        const t = normalizeIncomingTrack(msg.data ?? msg);
        if (t) {
          useTrackStore.getState().setTracks([t]);
          recordTrackReceived(!!t.isAirTrack);
        }
        if (msg.timestamp) useTrackStore.getState().setLastUpdate(String(msg.timestamp));
        break;
      }
      case "track_update":
      case "track_snapshot": {
        const tracks = msg.tracks as unknown[] | undefined;
        if (Array.isArray(tracks)) {
          const normalized = normalizeIncomingTrackList(tracks);
          useTrackStore.getState().setTracks(normalized);
          for (const t of normalized) recordTrackReceived(!!t.isAirTrack);
          if (msg.timestamp) useTrackStore.getState().setLastUpdate(String(msg.timestamp));
        }
        break;
      }

      // ── 告警 ──
      // ── map_command ──
      case "map_command": {
        const wrap = msg.data;
        if (!wrap || typeof wrap !== "object") break;
        const w = wrap as Record<string, unknown>;
        if (w.command === "alert") break;
        break;
      }

      // ── 区域 ──
      case "dzwl_alarm":
      case "dzwlalarm":
      case "page_url":
      case "pageurl": {
        const data = msg.data && typeof msg.data === "object" ? (msg.data as Record<string, unknown>) : {};
        const readString = (...values: unknown[]) => {
          for (const value of values) {
            if (typeof value === "string" && value.trim()) return value.trim();
          }
          return "";
        };
        const action = readString(
          data.action,
          data.command,
          data.status,
          data.state,
          msg.action,
          msg.command,
          msg.status,
          msg.state,
        ).toLowerCase();
        const pageUrl = readString(
          data.pageUrl,
          data.page_url,
          data.url,
          msg.pageUrl,
          msg.page_url,
          msg.url,
        );
        const openFlag = data.open ?? data.enabled ?? data.visible ?? msg.open ?? msg.enabled ?? msg.visible;
        const shouldClose =
          openFlag === false ||
          action === "close" ||
          action === "closed" ||
          action === "hide" ||
          action === "off" ||
          action === "false" ||
          action === "0";

        const alarmStore = useDzwlAlarmStore.getState();
        if (pageUrl) alarmStore.setPageUrl(pageUrl);
        if (shouldClose) {
          alarmStore.hide();
        } else {
          alarmStore.show();
        }
        break;
      }
      case "dbareas":
      case "db_areas": {
        const rows = Array.isArray(msg.data)
          ? (msg.data as AreaTableRow[]).filter((row) => shouldDisplayDbArea(row))
          : [];
        useDbAreaStore.getState().setRows(rows, null);
        recordDbAreasReceived();
        break;
      }
      case "multitrackresult":
      case "singletrackresult": {
        const detectionData = msg.data as Record<string, unknown> | undefined;
        useEoDetectionStore.getState().pushDetectionEnvelope({
          type: type === "multitrackresult" ? "MultiTrackResult" : "SingleTrackResult",
          data: detectionData,
        });
        recordEoDetectionReceived(
          typeof detectionData?.cameraId === "string" || typeof detectionData?.cameraId === "number"
            ? String(detectionData.cameraId)
            : "",
        );
        break;
      }

      // ── 资产 ──
      case "assets":
      case "assetbatch": {
        const arr = payloadArray(msg);
        if (Array.isArray(arr)) applyAssetListFromWs(mapEntitiesPayload(arr));
        break;
      }
      /**
       * ══════════════════════════════════════════════════════════════════
       *  entity_status —— 实体状态消息（雷达、相机、无人机、机场等的统一入口）
       * ══════════════════════════════════════════════════════════════════
       *
       * 后端通过 type="entity_status" 推送所有实体信息，包含：
       *   - msg.entities[]      : 实体数组（雷达、相机、激光、TDOA 等资产）
       *   - msg.relationships   : 机场与无人机的归属关系
       *
       * ── 处理流程（共3步）──
       *
       * 【第1步】applyEntityStatusMessage(msg) —— 解析机场/无人机关系
       *   解析 msg.relationships.airports[]：
       *   ├─ 每个 airport → 创建 drone-store.docks[dockSn]（机场遥测记录）
       *   │   dock.displayName = "机场-1、2"（从下属无人机名称提取编号）
       *   ├─ 每个 airport.drones[] → 创建 drone-store.drones[deviceSn]（无人机遥测记录）
       *   │   drone.displayName = "无人机1"（直接取 relationships 里的 name）
       *   └─ 构建 droneToAirport / airportToDrones / entityIdToDeviceSn 映射表
       *
       * 【第2步】解析 msg.entities（优先）或 msg.data 数组中的资产 → 写入 asset-store
       *   调用 mapEntitiesPayload(rawEntities) 逐条解析：
       *   ├─ 每条实体通过 specificType 字段识别类型：
       *   │   ● specificType 以 "Radar-" 开头 / 包含 "RADAR" → asset_type = "radar"
       *   │   ● navigationParameters.with_radar=1 / radarParameters 存在 → asset_type = "radar"（隐式雷达）
       *   │   ● specificType 等于 "CAMERA" → asset_type = "camera"
       *   │   ● 其他类型（激光、TDOA 等）见 wsEntityTypeRaw 注释
       *   │   ● "SURVEILLANCE_AREA" / "FRAME" 等 → "unknown"，跳过不入库
       *   ├─ 提取坐标（顶层 lat/lng 或 location.position 嵌套）
       *   ├─ 雷达额外提取 radarParameters.range（海里→公里）或 navigationParameters.maxRangeNm
       *   └─ 调用 applyAssetListFromWs() 与静态配置合并，整体写入 asset-store
       *
       * 【第3步】syncDroneAndAirportAssetsFromRelationships() —— 同步机场/无人机到 asset-store
       *   遍历 relationships，将第1步解析好的机场和无人机 upsert 到 asset-store：
       *   ├─ 机场：name = docks[dockSn].displayName, 坐标 = ap.latitude/ap.longitude
       *   ├─ 无人机：name = dr.name, 坐标 = dr.latitude/dr.longitude
       *   └─ 无坐标则跳过，不兜底
       *
       * ── 后续 WS 消息只更新不新增 ──
       *   dock_status       → 更新 drone-store.docks + asset-store 已有机场
       *   drone_status      → 更新 drone-store.drones（遥测坐标/航向）
       *   high_freq         → 更新 drone-store.drones（高频坐标）
       *   drone_flight_path → 更新 drone-store.drones（航线）
       *   camera / optoelectronic → 更新 asset-store 已有光电（朝向/视场角/坐标）
       */
      case "entity_status": {
        /* ── 第1步：解析 relationships，提取机场/无人机关系到 drone-store ── */
        const relationships = buildRelationshipGraphFromWs(msg);
        useAssetStore.getState().setRelationships(relationships);
        useAssetStore.getState().setEntityMappings(buildEntityMappingsFromRelationships(relationships));

        /* ── 第2步：解析实体（雷达、相机等），写入 asset-store ── */
        const rawEntities: unknown[] | null =
          Array.isArray(msg.entities) ? msg.entities : null;
        if (rawEntities) {
          const parsed = mapEntitiesPayload(rawEntities);
          const parsedById = new Map(parsed.map((asset) => [asset.id, asset]));
          // console.groupCollapsed(`[entity_status] entities=${rawEntities.length} parsed=${parsed.length}`);
          // console.table(
          //   rawEntities.map((item, index) => {
          //     const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          //     const ontology = row.ontology && typeof row.ontology === "object"
          //       ? (row.ontology as Record<string, unknown>)
          //       : {};
          //     const id = String(row.entityId ?? row.entity_id ?? row.id ?? "");
          //     const parsedAsset = parsedById.get(id);
          //     return {
          //       index,
          //       entityId: id,
          //       name: row.name ?? row.entityName,
          //       specificType: row.specificType ?? row.specific_type,
          //       ontologySpecificType: ontology.specificType ?? ontology.specific_type ?? row.ontologySpecificType,
          //       assetType: row.assetType,
          //       asset_type: row.asset_type,
          //       type: row.type,
          //       parsedAssetType: parsedAsset?.asset_type ?? "(skipped)",
          //     };
          //   }),
          // );
            rawEntities.map((item, index) => {
            const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
            const ontology = row.ontology && typeof row.ontology === "object"
              ? (row.ontology as Record<string, unknown>)
              : {};
            const id = String(row.entityId ?? row.entity_id ?? row.id ?? "");
            const parsedAsset = parsedById.get(id);
            // if(id == 'dock-DockAABBCCDD201')
            // {
            //   console.log("'dock-DockAABBCCDD201'",row)
            // }
              // if( id  =="uav-201")
              // {
              // console.log("uav-201",row)
              // }
          })

          for (const asset of parsed) {
            if (normalizeAssetType(asset.asset_type) !== "drone") continue;
          }

          applyAssetListFromWs(parsed, { commit: false });
          for (const a of parsed) {
            if (a.id) recordEntityReceived(a.id, a.asset_type);
          }
        } else {
          console.warn(`[entity_status] 无实体数据`);
        }

        rebuildAndCommitAssetSnapshot();
        break;
      }

      /*
       * 光电 / 高速相机 — 实时状态
       *
       * WS type：speedcamera | camera | optoelectronic（三者同一套解析）
       * 高速相机 UDP 设备状态（MSG_DEV_STATUS_BASIC）后端推 type=SpeedCamera，也进此分支
       *
       * 主要字段：entityId、position、ptz/originPtz.pan（朝向）、fov.horizontal（开角）、range_km
       * 写入 lastWsAssetList → rebuildAndCommitAssetSnapshot → 地图光电 FOV 模块
       *
       * 高速相机额外：applyHsCameraFovProps 设 fov_sector_visible（默认关，检测中才开）
       */
      case "speedcamera":
      case "camera":
      case "optoelectronic": {
        const d = msg.data as Record<string, unknown> | undefined;
        if (d) {
          const entityId = String(d.entityId ?? "");
          if (entityId) {
            const atType = normalizeAssetType(String(d.asset_type ?? d.type ?? "camera"));
            if (!shouldDisplayAssetId(atType, entityId)) break;
            const originPtz = d.originPtz as Record<string, unknown> | undefined;
            const ptz = d.ptz as Record<string, unknown> | undefined;
            const rawHeading = originPtz?.pan ?? ptz?.pan;
            const hasHeading = rawHeading != null && Number.isFinite(Number(rawHeading));
            const bearing = hasHeading ? parseCameraBearingDeg(d) : undefined;

            const fovObj = d.fov as Record<string, unknown> | undefined;
            const rawFov = fovObj?.horizontal;
            const hasFov = rawFov != null && Number.isFinite(Number(rawFov)) && Number(rawFov) > 0;
            const fovDeg = hasFov ? parseCameraHorizontalFovDeg(d) : undefined;

            const rawRange = d.range_km;
            const hasRange = rawRange != null && Number.isFinite(Number(rawRange)) && Number(rawRange) > 0;
            const rangeKm = hasRange ? parseCameraRangeKm(d) : undefined;
            const effectiveRangeKm = rangeKm ?? cameraDefaultRangeKm(entityId);
            const status = assetStatusFromDeviceState(d.deviceState);
            const baseProps: Record<string, unknown> = {
              config_kind: "camera",
              ...(typeof d.properties === "object" && d.properties ? (d.properties as Record<string, unknown>) : {}),
              ...deviceStatePropsFromPayload(d),
            };
            // 仅 camera-hs-001~004：默认关 FOV，检测激活时 hs-camera 会再打开
            applyHsCameraFovProps(entityId, baseProps);
            if (d.ptz && typeof d.ptz === "object") baseProps.ptz = d.ptz as Record<string, unknown>;
            if (d.originPtz && typeof d.originPtz === "object") baseProps.originPtz = d.originPtz as Record<string, unknown>;
            if (d.fov && typeof d.fov === "object") baseProps.fov = d.fov as Record<string, unknown>;
            if (d.position && typeof d.position === "object") baseProps.position = d.position as Record<string, unknown>;
            const posObj = d.position as Record<string, unknown> | undefined;
            const posAlt = Number(posObj?.altitude ?? posObj?.alt ?? d.altitude ?? d.alt);
            if (Number.isFinite(posAlt)) baseProps.altitude = posAlt;
            if (d.taskType != null) baseProps.taskType = d.taskType;
            if (d.executionState != null) baseProps.executionState = d.executionState;

            const patch: Partial<AssetData> = {
              status,
              mission_status: "monitoring",
              properties: baseProps,
            };
            if (bearing !== undefined) patch.heading = bearing;
            if (fovDeg !== undefined) patch.fov_angle = fovDeg;
            if (effectiveRangeKm !== undefined) patch.range_km = effectiveRangeKm;
            const ll = extractCameraLatLng(d);
            if (ll) {
              patch.lat = ll.lat;
              patch.lng = ll.lng;
            }

            /* 合并进 lastWsAssetList 后触发地图刷新（OptoelectronicFovModule 画扇形） */
            patchExistingCameraAsset(entityId, patch);
            if (entityId === "camera_004") {
              const stored = useAssetStore.getState().assets.find((a) => a.id === entityId);
              // console.log("[camera_004 heading]", {
              //   originPan: Number(originPtz?.pan),
              //   patchHeading: patch.heading,
              //   storedHeading: stored?.heading,
              // });
            }
          }
        }
        break;
      }

      /*
       * 高速相机检测帧（UDP MSG_CAM_IMAGE_REPORT → SpeedCameraDetection）
       * data.boxes 非空时：开 FOV + 告警；2s 无新帧由 tickHsCameraDetection 关闭
       * 详见 lib/speed-camera/hs-camera.ts
       */
      case "radarstatus":
      case "radar_status": {
        const d = msg.data as Record<string, unknown> | undefined;
        if (!d) break;
        const radarAssetId = resolveRadarAssetIdFromPayload(d);
        if (!radarAssetId) break;
        const existing = useAssetStore.getState().assets.find((a) => a.id === radarAssetId);
        if (!existing) break;

        const prevProps =
          existing.properties && typeof existing.properties === "object"
            ? ({ ...(existing.properties as Record<string, unknown>) } as Record<string, unknown>)
            : {};
        const now = Date.now();
        const rangeNm = Number(d.range);
        const patch: Partial<AssetData> = {
          status: assetStatusFromDeviceState(d.deviceState),
          properties: {
            ...prevProps,
            radar_status: d,
            radar_status_received_at_ms: now,
            last_packet_at_ms: now,
            radarID: d.radarID ?? prevProps.radarID,
            radar_id: d.radar_id ?? d.radarID ?? prevProps.radar_id,
            radarType: d.radarType ?? prevProps.radarType,
            radarName: d.radarName ?? prevProps.radarName,
            radar_transmit: d.transmit ?? prevProps.radar_transmit,
            radar_range: d.range ?? prevProps.radar_range,
            ...deviceStatePropsFromPayload(d),
          },
        };
        const lat = Number(d.latitude);
        const lng = Number(d.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          patch.lat = lat;
          patch.lng = lng;
        }
        if (Number.isFinite(rangeNm) && rangeNm > 0) {
          patch.range_km = rangeNm * 1.852;
          patch.properties = {
            ...(patch.properties as Record<string, unknown>),
            max_range_m: rangeNm * 1852,
          };
        }
        useAssetStore.getState().mergeAssetFields(radarAssetId, patch);
        recordEntityReceived(radarAssetId, "radar");
        break;
      }

      case "speedcameradetection": {
        const d = msg.data as Record<string, unknown> | undefined;
        if (d) onHsCameraDetection(d, rebuildAndCommitAssetSnapshot);
        break;
      }

      // ── 机场 / 无人机 ──
      case "dockstatus":
      case "dock_status": {
        const d = msg.data as Record<string, unknown> | undefined;
        if (!d || d.latitude == null || d.longitude == null) break;
        // console.log("dockstatus:",d)
        recordDockReceived();
        const dockEntityId = resolveDockEntityIdFromPayload(d);
        if (!dockEntityId) break;
        const existingAsset = useAssetStore.getState().assets.find((x) => x.id === dockEntityId);
        if (!existingAsset) break;
        const airportName =
          relationshipNodeById(useAssetStore.getState().relationships, dockEntityId)?.name ??
          existingAsset.name ??
          "机场";
        const prevProps =
          existingAsset.properties && typeof existingAsset.properties === "object"
            ? ({ ...(existingAsset.properties as Record<string, unknown>) } as Record<string, unknown>)
            : {};
        const now = Date.now();
        const batteryPercent = readBatteryPercentFromPayload(d);
        // console.log("[dock_status][battery]", {
        //   entityId: dockEntityId,
        //   batteryPercent,
        //   raw: {
        //     battery_capacity_percent: d.battery_capacity_percent,
        //     batteryCapacityPercent: d.batteryCapacityPercent,
        //     battery_percent: d.battery_percent,
        //     batteryPercent: d.batteryPercent,
        //   },
        // });
        const modeCode = Number(d.mode_code);
        const nextProperties = {
          ...prevProps,
          dock: d,
          map_label: airportName,
          virtual_troop: existingAsset.properties?.virtual_troop ?? false,
          last_packet_at_ms: now,
          dock_status_received_at_ms: now,
          dock_battery_percent: batteryPercent ?? prevProps.dock_battery_percent,
          dock_mode_code: Number.isFinite(modeCode) ? modeCode : prevProps.dock_mode_code,
          ...deviceStatePropsFromPayload(d),
        };
        useAssetStore.getState().mergeAssetFields(dockEntityId, {
          lat: Number(d.latitude),
          lng: Number(d.longitude),
          name: airportName,
          status: assetStatusFromDeviceState(d.deviceState),
          properties: nextProperties,
        });
        break;
      }
      case "dronestatus":
      case "drone_status": {
        const d = msg.data as Record<string, unknown> | undefined;
        if (d) {
          // console.log("dronestatus",d)
          recordDroneReceived();
          const droneEntityId = resolveDroneEntityIdFromAssets(d);
          if (droneEntityId) {
            //  if( droneEntityId  =="uav-201")
            //   {
            //   console.log("uav-201",d)
            //   }

            const existing = useAssetStore.getState().assets.find((a) => a.id === droneEntityId);
            if (existing) {
              const prevProps = readDroneRuntimeOverlayProps(droneEntityId);
              const statusPayload = { ...d };
              const pos = readLatLngFromRuntimePayload(statusPayload);
              const now = Date.now();
              const highFreqFresh = isHighFreqFresh(droneEntityId, now);
              const statusTakeoffGate = pos
                ? shouldDiscardByTakeoff(droneEntityId, pos.lng, pos.lat)
                : { discard: false, farDistanceMeters: null };
              const discardStatus = statusTakeoffGate.discard;
              const acceptedStatusPos = pos && !discardStatus ? pos : null;
              const storedStatusPayload = discardStatus
                ? omitRuntimePositionFields(statusPayload)
                : statusPayload;
              const acceptedStatusAt =
                pos && !discardStatus ? now : readDroneRuntimeMeta(droneEntityId).lastStatusAcceptedAt;
              const heading = Number(
                statusPayload.heading ??
                statusPayload.attitude_head ??
                statusPayload.course ??
                statusPayload.yaw
              );
              const speedMps = readSpeedMpsFromRuntimePayload(statusPayload);
              const batteryPercent = readBatteryPercentFromPayload(statusPayload);
              // console.log("[drone_status][battery]", {
              //   entityId: droneEntityId,
              //   batteryPercent,
              //   raw: {
              //     battery_percent: statusPayload.battery_percent,
              //     batteryPercent: statusPayload.batteryPercent,
              //     battery_capacity_percent: statusPayload.battery_capacity_percent,
              //     batteryCapacityPercent: statusPayload.batteryCapacityPercent,
              //   },
              // });
              // console.log("[drone_status][speed]", {
              //   entityId: droneEntityId,
              //   speed_mps: speedMps,
              //   horizontal_speed: statusPayload.horizontal_speed ?? statusPayload.horizontalSpeed,
              //   vertical_speed: statusPayload.vertical_speed ?? statusPayload.verticalSpeed,
              //   speed: statusPayload.speed,
              //   speedMps: statusPayload.speedMps,
              //   speed_N: statusPayload.speed_N,
              //   speed__E: statusPayload.speed__E,
              //   speed_V: statusPayload.speed_V,
              //   raw: statusPayload,
              // });
              const nextHistoryTrail =
                pos && !discardStatus && !highFreqFresh
                  ? appendDroneHistoryTrail(droneEntityId, prevProps, pos.lat, pos.lng)
                  : (Array.isArray(prevProps.history_trail) ? prevProps.history_trail : []);
             
              patchDroneRuntimeOverlay(droneEntityId, {
                status: assetStatusFromDeviceState(d.deviceState),
                ...(!discardStatus && pos && !highFreqFresh ? { lat: pos.lat, lng: pos.lng } : {}),
                ...(Number.isFinite(heading) && !highFreqFresh ? { heading } : {}),
                properties: {
                  ...prevProps,
                  drone_status: storedStatusPayload,
                  entityId: droneEntityId,
                  entity_id: droneEntityId,
                  deviceSn:
                    statusPayload.deviceSn ??
                    statusPayload.device_sn ??
                    statusPayload.drone_sn ??
                    prevProps.deviceSn,
                  device_sn:
                    statusPayload.deviceSn ??
                    statusPayload.device_sn ??
                    statusPayload.drone_sn ??
                    prevProps.device_sn,
                  last_packet_at_ms: now,
                  status_received_at_ms: now,
                  lastStatusAcceptedAt: acceptedStatusAt,
                  speed_mps: speedMps ?? prevProps.speed_mps,
                  drone_battery_percent: batteryPercent ?? prevProps.drone_battery_percent,
                  battery_percent: batteryPercent ?? prevProps.battery_percent,
                  batteryPercent: batteryPercent ?? prevProps.batteryPercent,
                  ...updateTakeoffState(
                    droneEntityId,
                    now,
                    acceptedStatusPos,
                    statusTakeoffGate.farDistanceMeters,
                  ),
                  history_trail: nextHistoryTrail,
                  munition_quantity:
                    statusPayload.munitionQuantity ??
                    statusPayload.munition_quantity ??
                    prevProps.munition_quantity,
                  ...deviceStatePropsFromPayload(d),
                },
              });
            }
          }
        }
        break;
      }
      case "droneflightpath":
      case "dronetask":
      case "drone_flight_path":
      case "drone_task": {
        const d = msg.data as Record<string, unknown> | undefined;
        if (d && typeof d === "object") {
          const droneEntityId = resolveDroneEntityIdFromAssets(d);
          // console.log("[flight_path:recv]", {
          //   executionState: d.executionState ?? d.execution_state ?? null,
          //   entityId: droneEntityId ?? d.entityId ?? d.entity_id ?? null,
          // });
          recordDroneFlightPathReceived();
          if (droneEntityId) {
            const existing = useAssetStore.getState().assets.find((a) => a.id === droneEntityId);
            if (existing) {
              const prevProps = readDroneRuntimeOverlayProps(droneEntityId);
              const execState = d.executionState ?? d.execution_state;
              const isComplete = execState === 1 || execState === "1" || execState === "completed";
              const quantity = readMunitionQuantityFromPayload(d);
              patchDroneRuntimeOverlay(droneEntityId, {
                properties: {
                  ...prevProps,
                  drone_flight_path: isComplete ? null : { ...d },
                  flight_path_received_at_ms: isComplete ? null : Date.now(),
                  entityId: droneEntityId,
                  entity_id: droneEntityId,
                  deviceSn: d.deviceSn ?? d.device_sn ?? d.drone_sn ?? prevProps.deviceSn,
                  device_sn: d.deviceSn ?? d.device_sn ?? d.drone_sn ?? prevProps.device_sn,
                  munition_quantity:
                    quantity ??
                    prevProps.munition_quantity,
                },
              });
            }
          }
        }
        break;
      }
      case "highfreq":
      case "high_freq": {
        const d = msg.data as Record<string, unknown> | undefined;
        if (d && typeof d === "object") {
          recordDroneReceived();
          const droneEntityId = resolveDroneEntityIdFromAssets(d);
          // if( droneEntityId  =="uav-201")
          // {
          //   console.log("dronhighfreqestatus",d)
          // }
          if (droneEntityId) {
            const existing = useAssetStore.getState().assets.find((a) => a.id === droneEntityId);
            if (existing) {
              const prevProps = readDroneRuntimeOverlayProps(droneEntityId);
              const lat = Number(d.latitude ?? d.lat);
              const lng = Number(d.longitude ?? d.lng ?? d.lon);
              const posValid = Number.isFinite(lat) && Number.isFinite(lng);
              const highFreqTakeoffGate = posValid
                ? shouldDiscardByTakeoff(droneEntityId, lng, lat)
                : { discard: false, farDistanceMeters: null };
              const discardHighFreq = highFreqTakeoffGate.discard;
              const acceptedHighFreqPos = posValid && !discardHighFreq ? { lat, lng } : null;
              const prevTrail =
                Array.isArray(prevProps.history_trail) ? prevProps.history_trail : [];
              const acceptedHighFreqAt =
                posValid && !discardHighFreq ? Date.now() : readDroneRuntimeMeta(droneEntityId).lastHighFreqAcceptedAt;
              const nextHistoryTrail =
                posValid && !discardHighFreq
                  ? appendDroneHistoryTrail(droneEntityId, prevProps, lat, lng)
                  : prevTrail;
              const heading = Number(
                d.attitude_head ??
                d.heading ??
                d.course ??
                d.yaw ??
                d.gimbal_yaw
              );
              const speedMps = readSpeedMpsFromRuntimePayload(d);
              console.log("[high_freq][speed]", {
                entityId: droneEntityId,
                speed_mps: speedMps,
                horizontal_speed: d.horizontal_speed ?? d.horizontalSpeed,
                vertical_speed: d.vertical_speed ?? d.verticalSpeed,
                speed: d.speed,
                speedMps: d.speedMps,
                speed_N: d.speed_N,
                speed__E: d.speed__E,
                speed_V: d.speed_V,
                raw: d,
              });
              const now = Date.now();
              const highFreqPayload = Number.isFinite(heading)
                ? {
                    ...d,
                    heading,
                    headingDeg: heading,
                    attitude_head: d.attitude_head ?? heading,
                  }
                : d;
              const storedHighFreqPayload = discardHighFreq
                ? omitRuntimePositionFields(highFreqPayload)
                : highFreqPayload;
              patchDroneRuntimeOverlay(droneEntityId, {
                ...(!discardHighFreq && Number.isFinite(lat) ? { lat } : {}),
                ...(!discardHighFreq && Number.isFinite(lng) ? { lng } : {}),
                ...(!discardHighFreq && Number.isFinite(heading) ? { heading } : {}),
                properties: {
                  ...prevProps,
                  high_freq: storedHighFreqPayload,
                  ...(Number.isFinite(heading)
                    ? {
                        heading,
                        headingDeg: heading,
                        attitude_head: d.attitude_head ?? heading,
                      }
                    : {}),
                  entityId: droneEntityId,
                  entity_id: droneEntityId,
                  deviceSn: d.deviceSn ?? d.device_sn ?? d.drone_sn ?? prevProps.deviceSn,
                  device_sn: d.deviceSn ?? d.device_sn ?? d.drone_sn ?? prevProps.device_sn,
                  last_packet_at_ms: now,
                  high_freq_received_at_ms: now,
                  lastHighFreqAcceptedAt: acceptedHighFreqAt,
                  speed_mps: speedMps ?? prevProps.speed_mps,
                  ...updateTakeoffState(
                    droneEntityId,
                    now,
                    acceptedHighFreqPos,
                    highFreqTakeoffGate.farDistanceMeters,
                  ),
                  history_trail: nextHistoryTrail,
                },
              });
              // if (droneEntityId === "uav-201") {
              //   const stored = useAssetStore.getState().assets.find((a) => a.id === droneEntityId);
              //   const storedProps =
              //     stored?.properties && typeof stored.properties === "object"
              //       ? (stored.properties as Record<string, unknown>)
              //       : {};
              //   const storedHighFreq =
              //     storedProps.high_freq && typeof storedProps.high_freq === "object"
              //       ? (storedProps.high_freq as Record<string, unknown>)
              //       : null;
              //   console.log("[uav-201 high_freq stored]", {
              //     headingInput: heading,
              //     assetHeading: stored?.heading,
              //     highFreqHeading: storedHighFreq?.attitude_head,
              //     highFreqReceivedAt: storedProps.high_freq_received_at_ms,
              //     lat: stored?.lat,
              //     lng: stored?.lng,
              //   });
              // }
            }
          }
        }
        break;
      }
      case "munitionstatus":
      case "munition_status": {
        const d = msg.data as Record<string, unknown> | undefined;
        if (d && typeof d === "object") {
          applyMunitionWsPayload(d);
          recordEntityReceived(String(d.entityId ?? ""), "missile");
        }
        break;
      }
      case "usvstatus":
      case "usv_status": {
        const d = msg.data as Record<string, unknown> | undefined;
        if (d && typeof d === "object") {
          applyUsvWsPayload(d);
          recordEntityReceived(String(d.entityId ?? ""), "usv");
        }
        break;
      }
      /*
       * 激光 DDS：applyLaserWsPayload
       *   → patchExistingWeaponAsset（写 store）
       *   → 写入 asset-store；Map2D 只按 DDS deviceState=2 渲染执行扇区
       *   → 不再由前端自动激活、跟随或改设备状态
       */
      case "laserstatus":
      case "laser_status": {
        const d = msg.data as Record<string, unknown> | undefined;
        if (d && typeof d === "object") {
          // console.log("laserstatus:",d)
          applyLaserWsPayload(d);
          recordEntityReceived(String(d.entityId ?? ""), "laser");
        }
        break;
      }
      /* TDOA DDS：同上，入口为 applyTdoaWsPayload */
      case "tdoastatus":
      case "tdoa_status": {
        const d = msg.data as Record<string, unknown> | undefined;
        if (d && typeof d === "object") {
          // console.log("tdoastatus:",d)
          applyTdoaWsPayload(d);
          recordEntityReceived(String(d.entityId ?? ""), "tdoa");
        }
        break;
      }
      case "cleardrones":
      case "cleartracks":
        useAssetStore.getState().setRelationships(null);
        useAssetStore.getState().setEntityMappings({});
        rebuildAndCommitAssetSnapshot();
        if (type === "cleartracks") useTrackStore.getState().clearAllTracks();
        break;

      // ── 资产事件 ──
      case "asset_events": {
        const events = msg.events as unknown[] | undefined;
        if (Array.isArray(events)) {
          for (const ev of events) {
            if (ev && typeof ev === "object") applyAssetWsEvent(ev as Record<string, unknown>);
          }
        }
        break;
      }

      // ── 心跳 ──
      case "heartbeat": {
        const sock = ws.socket;
        if (sock?.readyState === WebSocket.OPEN) {
          sock.send(JSON.stringify({ type: "pong", created_at: new Date().toISOString(), data: { message: "pong" } }));
        }
        break;
      }

      // ── 忽略 ──
      case "pong":
        break;

      default:
        break;
    }
  } catch {
    /* 忽略非法 JSON */
  }
}

// ── 连接管理 ──

function startHeartbeat() {
  clearHeartbeat();
  const interval = getWebSocketConfig().heartbeatInterval;
  ws.heartbeatTimer = setInterval(() => {
    if (!ws.socket || ws.socket.readyState !== WebSocket.OPEN) return;
    try {
      ws.socket.send(JSON.stringify({ type: "ping", t: Date.now() }));
    } catch { /* ignore */ }
  }, interval);
}

function scheduleReconnect() {
  if (!ws.running) return;
  clearReconnectTimer();
  const delay = backoffMs();
  ws.reconnectTimer = setTimeout(() => {
    ws.reconnectTimer = null;
    if (!ws.running) return;
    notify("WebSocket 重连中", "连接已断开", "info");
    openConnection();
  }, delay);
}

function openConnection() {
  if (!ws.running) return;
  const url = getWebSocketConfig().url;
  if (!url) return;

  if (ws.socket && (ws.socket.readyState === WebSocket.OPEN || ws.socket.readyState === WebSocket.CONNECTING)) return;

  const socket = new WebSocket(url);
  ws.socket = socket;

  socket.onopen = () => {
    ws.reconnectAttempt = 0;
    useTrackStore.getState().setConnected(true);
    startHeartbeat();
    if (!ws.readyNotified) {
      ws.readyNotified = true;
      notify("WebSocket 已就绪111", url, "success");
    }
  };

  socket.onmessage = (ev) => {
    dispatchWsMessage(ev.data as string);
  };

  socket.onerror = () => {
    notify("WebSocket 连接异常", "请确认后端 WebSocket 服务可用", "error");
    try { socket.close(); } catch { /* noop */ }
  };

  socket.onclose = () => {
    clearHeartbeat();
    useTrackStore.getState().setConnected(false);
    ws.socket = null;
    if (!ws.running) return;
    ws.reconnectAttempt += 1;
    const maxAttempts = getWebSocketConfig().maxReconnectAttempts;
    if (ws.reconnectAttempt > maxAttempts) {
      notify("WebSocket 重连失败", "已停止自动重连", "error");
      return;
    }
    scheduleReconnect();
  };
}

// ── 定时器 ──

function startTrackStalePrune() {
  if (ws.trackPruneTimer) clearInterval(ws.trackPruneTimer);
  const tick = () => Math.max(500, getTrackRenderingConfig().trackTimeout.checkIntervalMs);
  ws.trackPruneTimer = setInterval(() => {
    useTrackStore.getState().pruneStaleTracks();
  }, tick());
}

function startDroneRuntimePrune() {
  if (ws.droneRuntimePruneTimer) clearInterval(ws.droneRuntimePruneTimer);
  ws.droneRuntimePruneTimer = setInterval(() => {
    const cfg = getDroneMapRenderingConfig();
    const staleMs = Math.max(1000, cfg.timeoutSeconds * 1000);
    const now = Date.now();
    for (const asset of useAssetStore.getState().assets) {
      const assetType = normalizeAssetType(asset.asset_type);
      if (assetType !== "drone" && assetType !== "airport") continue;
      const props =
        asset.properties && typeof asset.properties === "object"
          ? ({ ...(asset.properties as Record<string, unknown>) } as Record<string, unknown>)
          : {};
      const runtimeAt = readRuntimeTimestampMs(props);
      const highFreqAt = Number(props.high_freq_received_at_ms);
      const highFreqFresh = Number.isFinite(highFreqAt) && now - highFreqAt <= cfg.highFreqPositionMaxAgeMs;
      const runtimeFresh = runtimeAt != null && now - runtimeAt <= staleMs;
      const isFresh = highFreqFresh || runtimeFresh;
      const nextStatus = isFresh ? assetStatusFromDeviceState(props.deviceState) : "offline";
      if (asset.status !== nextStatus) {
        useAssetStore.getState().mergeAssetFields(asset.id, { status: nextStatus });
      }
      if (assetType !== "drone") continue;
      if (isFresh) continue;
      const historyTrail = Array.isArray(props.history_trail) ? props.history_trail : [];
      if (
        historyTrail.length === 0 &&
        props.high_freq == null &&
        props.drone_status == null &&
        props.drone_flight_path == null &&
        props.last_packet_at_ms == null
      ) {
        continue;
      }
      droneHistoryTrailCache.delete(asset.id);
      droneRuntimeOverlayById.set(asset.id, {
        properties: {
          ...props,
          history_trail: [],
          high_freq: null,
          drone_status: null,
          high_freq_received_at_ms: null,
          status_received_at_ms: null,
          last_packet_at_ms: null,
          lastStatusAcceptedAt: null,
          lastHighFreqAcceptedAt: null,
          isTakingOff: false,
          wasLanded: true,
        },
      });
      useAssetStore.getState().mergeAssetFields(asset.id, {
        status: "offline",
        properties: {
          ...props,
          history_trail: [],
          high_freq: null,
          drone_status: null,
          high_freq_received_at_ms: null,
          status_received_at_ms: null,
          last_packet_at_ms: null,
          lastStatusAcceptedAt: null,
          lastHighFreqAcceptedAt: null,
          isTakingOff: false,
          wasLanded: true,
        },
      });
    }
  }, 1000);
}

function startAlarmCleanup() {
  if (ws.alarmCleanupTimer) clearInterval(ws.alarmCleanupTimer);
  ws.alarmCleanupTimer = setInterval(() => {
    return;
  }, 5_000);
}

function stopAlarmCleanup() {
  if (ws.alarmCleanupTimer) { clearInterval(ws.alarmCleanupTimer); ws.alarmCleanupTimer = null; }
}

function startSpeedCameraDetectionPrune() {
  if (ws.speedCameraPruneTimer) clearInterval(ws.speedCameraPruneTimer);
  ws.speedCameraPruneTimer = setInterval(() => {
    tickHsCameraDetection(rebuildAndCommitAssetSnapshot);
  }, 500);
}

function stopSpeedCameraDetectionPrune() {
  if (ws.speedCameraPruneTimer) {
    clearInterval(ws.speedCameraPruneTimer);
    ws.speedCameraPruneTimer = null;
  }
}

function startAlertRevisionSync() {
  return;
}

function stopAlertRevisionSync() {
  if (ws.alertRevisionUnsub) { ws.alertRevisionUnsub(); ws.alertRevisionUnsub = null; }
}

// ── 查证图片轮询 ──

function startImagePolling() {
  if (ws.imagePollTimer) clearInterval(ws.imagePollTimer);
  const httpCfg = getHttpConfig();
  if (!httpCfg.imagePollingEnabled) {
    ws.imagePollTimer = null;
    return;
  }
  const { updateTrackImage } = useTrackStore.getState();
  let polling = false;

  ws.imagePollTimer = setInterval(async () => {
    if (polling) return;
    polling = true;
    const cache = getRenderCache();
    for (const [targetID] of cache) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), httpCfg.imageFetchTimeoutMs);
        const res = await fetch(`${httpCfg.backendUrl}/api/image/${encodeURIComponent(targetID)}`, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) continue;
        const json = await res.json() as Record<string, unknown>;
        const raw = json.data as Record<string, unknown> | undefined;
        const imageBase64 = raw?.imageBase64 as string | undefined;
        if (!imageBase64) continue;
        const imageUrl = imageBase64.startsWith("data:")
          ? imageBase64
          : `data:image/jpeg;base64,${imageBase64}`;
        updateTrackImage(targetID, imageUrl);
      } catch {
        // timeout / network error → next cycle will retry
      }
    }
    polling = false;
  }, httpCfg.imagePollIntervalMs);
}

function stopImagePolling() {
  if (ws.imagePollTimer) { clearInterval(ws.imagePollTimer); ws.imagePollTimer = null; }
}

// ── 启停 ──

function startUnifiedWs() {
  if (ws.running) return;
  ws.running = true;
  ws.readyNotified = false;
  notify("正在连接 WebSocket", "", "info");
  openConnection();
  startTrackStalePrune();
  startDroneRuntimePrune();
  startAlarmCleanup();
  startSpeedCameraDetectionPrune();
  startAlertRevisionSync();
  startImagePolling();
}

function stopUnifiedWs() {
  ws.running = false;
  if (ws.trackPruneTimer) { clearInterval(ws.trackPruneTimer); ws.trackPruneTimer = null; }
  if (ws.droneRuntimePruneTimer) { clearInterval(ws.droneRuntimePruneTimer); ws.droneRuntimePruneTimer = null; }
  stopAlarmCleanup();
  stopSpeedCameraDetectionPrune();
  stopAlertRevisionSync();
  stopImagePolling();
  clearReconnectTimer();
  clearHeartbeat();
  if (ws.socket && ws.socket.readyState === WebSocket.OPEN) ws.socket.close(1000, "client shutdown");
  ws.socket = null;
  useTrackStore.getState().setConnected(false);
}

export function useUnifiedWsFeed() {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 必须先拉取 app-config.json 并 applyResolvedNewConfigs，否则 WS 仍用默认 ws://localhost:8001，
      // 从局域网 IP 打开页面时会连到本机 localhost 而非配置里的后端地址。
      await reloadAppConfigAssetBase();
      if (cancelled) return;
      startUnifiedWs();
    })();
    return () => {
      cancelled = true;
      stopUnifiedWs();
    };
  }, []);
}
