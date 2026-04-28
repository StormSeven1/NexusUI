/**
 * asset-target-line — 处置方案执行后地图上的资产→目标动态连接线
 *
 * 【作用】处置方案执行成功后，在地图上绘制从执行设备（资产）到目标的动态连线，
 *   含固定虚线 + 流动点动画，直观展示「谁在打谁」。
 *
 * 【数据流】
 *   1. disposalPlanStore.executeScheme 成功 → applySchemeSideEffects
 *   2. mergeConnectionLines(connections) → 追加连线到模块内存
 *   3. 地图动画帧内 flush() → 实时刷新坐标（从 drone/asset/track/TDOA/激光 取最新位置）
 *   4. 目标消失时 pruneConnectionLinesForMissingTargets → 自动清理
 *
 * 【连线 key】`assetId::targetId`，同一对资产-目标只保留一条线
 *
 * 【坐标查找优先级】
 *   - 资产端：drone-store → asset-store → TDOA 设备 → 激光设备
 *   - 目标端：track-store 渲染缓存 → 影子缓存 → 蓝方坐标回退
 *   - 目标解析对齐 trackIdMode（distinguishSeaAir 模式下对海/对空用不同 ID）
 *
 * 【清理机制】
 *   - pruneConnectionLinesForTarget：指定目标只保留 allowedAssets 内的连线
 *   - pruneConnectionLinesForMissingTargets：移除目标已不存在的连线
 *   - clearAllConnectionLines：disposePlanStore.clearBlocks 时全清
 */

import type maplibregl from "maplibre-gl";
import { getMapModules } from "./map-module-registry";
import { useDroneStore } from "@/stores/drone-store";
import { useAssetStore } from "@/stores/asset-store";
import { useTrackStore } from "@/stores/track-store";
import type { Track } from "@/lib/map-entity-model";
import { getAssetTargetLineConfig, getTrackIdModeConfig } from "@/lib/map-app-config";

/* ── 常量 ── */

const SOURCE_ID = "nexus-asset-target-line-src";
const LINE_LAYER_ID = "nexus-asset-target-line";
const FLOW_POINT_SOURCE_ID = "nexus-asset-target-flow-point-src";
const FLOW_POINT_LAYER_ID = "nexus-asset-target-flow-point";

/* ── 连线 key：`assetId::targetId` ── */

export interface AssetTargetConnection {
  assetEntityId: string;
  targetId: string;
  /** 航迹主键与处置 targetId 不一致时，用蓝方坐标画线（可选） */
  targetFallbackLng?: number;
  targetFallbackLat?: number;
}

function connKey(c: AssetTargetConnection): string {
  return `${c.assetEntityId}::${c.targetId}`;
}

/* ── 坐标查找 ── */

function resolveAssetCoords(entityId: string): { lng: number; lat: number } | null {
  const droneStore = useDroneStore.getState();
  const sn = droneStore.entityIdToDeviceSn[entityId] ?? entityId;
  const drone = droneStore.drones[sn];
  if (drone && drone.lat != null && drone.lng != null) {
    return { lng: drone.lng, lat: drone.lat };
  }
  const asset = useAssetStore.getState().assets.find((a) => a.id === entityId);
  if (asset) return { lng: asset.lng, lat: asset.lat };
  const mods = getMapModules();
  if (mods?.tdoa) {
    const d = mods.tdoa.getDevice(entityId);
    if (d && Number.isFinite(d.lng) && Number.isFinite(d.lat)) return { lng: d.lng, lat: d.lat };
  }
  if (mods?.laser) {
    const ld = mods.laser.getDevice(entityId);
    if (ld && Number.isFinite(ld.lng) && Number.isFinite(ld.lat)) return { lng: ld.lng, lat: ld.lat };
  }
  return null;
}

/**
 * 与 track-store `isTrackMatchedByAlarm` 口径一致：
 * - distinguishSeaAir=false：优先 trackId，再 uniqueID/showID/id
 * - distinguishSeaAir=true：对空用 trackId 命中；对海用 uniqueID/showID
 */
export function findTrackForDisposalTarget(targetId: string, isAirHint?: boolean): Track | undefined {
  const tid = String(targetId ?? "").trim();
  if (!tid) return undefined;
  const tracks = useTrackStore.getState().tracks;
  const mode = getTrackIdModeConfig().distinguishSeaAir;

  const tryMatch = (t: Track): boolean => {
    if (t.trackId != null && String(t.trackId) === tid) return true;
    if (String(t.uniqueID) === tid) return true;
    if (String(t.showID) === tid) return true;
    if (String(t.id) === tid) return true;
    return false;
  };

  const direct = tracks.find(tryMatch);
  if (direct) return direct;

  if (!mode) return undefined;

  if (isAirHint === true) {
    return tracks.find((t) => t.isAirTrack === true && t.trackId != null && String(t.trackId) === tid);
  }
  if (isAirHint === false) {
    return tracks.find(
      (t) =>
        t.isAirTrack !== true &&
        (String(t.uniqueID) === tid || String(t.showID) === tid || String(t.id) === tid),
    );
  }
  return undefined;
}

export function resolveTrackLngLatForTargetId(
  targetId: string,
  isAirHint?: boolean,
): { lng: number; lat: number } | null {
  const track = findTrackForDisposalTarget(targetId, isAirHint);
  if (track && track.lat != null && track.lng != null) {
    return { lng: track.lng, lat: track.lat };
  }
  const asset = useAssetStore.getState().assets.find((a) => a.id === targetId);
  if (asset) return { lng: asset.lng, lat: asset.lat };
  return null;
}

function resolveTargetCoords(conn: AssetTargetConnection): { lng: number; lat: number } | null {
  const direct = resolveTrackLngLatForTargetId(conn.targetId);
  if (direct) return direct;
  const { targetFallbackLng: flng, targetFallbackLat: flat } = conn;
  if (
    Number.isFinite(flng) &&
    Number.isFinite(flat) &&
    flng != null &&
    flat != null
  ) {
    return { lng: flng, lat: flat };
  }
  return null;
}

/* ── 状态 ── */

let activeConnections = new Map<string, AssetTargetConnection>();
let animTimer: ReturnType<typeof setInterval> | null = null;
let animPhase = 0;

/* ── GeoJSON 构建 ── */

function buildGeoJSON(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const [key, conn] of activeConnections) {
    const from = resolveAssetCoords(conn.assetEntityId);
    const to = resolveTargetCoords(conn);
    if (!from || !to) continue;
    features.push({
      type: "Feature",
      properties: { key, kind: "asset-target-line" },
      geometry: {
        type: "LineString",
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function keySeed01(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = (h >>> 0) % 10000;
  return u / 10000;
}

function buildFlowPointGeoJSON(phase: number): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const pointsPerLine = 3;
  for (const [key, conn] of activeConnections) {
    const from = resolveAssetCoords(conn.assetEntityId);
    const to = resolveTargetCoords(conn);
    if (!from || !to) continue;
    const seed = keySeed01(key);
    for (let i = 0; i < pointsPerLine; i += 1) {
      const p = (phase + seed + i / pointsPerLine) % 1;
      const lng = from.lng + (to.lng - from.lng) * p;
      const lat = from.lat + (to.lat - from.lat) * p;
      features.push({
        type: "Feature",
        properties: { key, kind: "asset-target-flow-point" },
        geometry: { type: "Point", coordinates: [lng, lat] },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

function applyConnectionLinePaint(map: maplibregl.Map): void {
  if (!map.getLayer(LINE_LAYER_ID)) return;
  const c = getAssetTargetLineConfig();
  map.setPaintProperty(LINE_LAYER_ID, "line-color", c.color);
  map.setPaintProperty(LINE_LAYER_ID, "line-width", c.lineWidth);
  map.setPaintProperty(LINE_LAYER_ID, "line-opacity", 1);
  map.setPaintProperty(LINE_LAYER_ID, "line-dasharray", [0, 1.6, 3.4]);
  if (map.getLayer(FLOW_POINT_LAYER_ID)) {
    map.setPaintProperty(FLOW_POINT_LAYER_ID, "circle-color", c.color);
    map.setPaintProperty(FLOW_POINT_LAYER_ID, "circle-opacity", 0.95);
    map.setPaintProperty(FLOW_POINT_LAYER_ID, "circle-radius", c.flowPointRadius);
  }
}

/* ── 地图图层管理 ── */

function ensureLayers(map: maplibregl.Map): void {
  const c = getAssetTargetLineConfig();
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: "geojson",
      lineMetrics: true,
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getSource(FLOW_POINT_SOURCE_ID)) {
    map.addSource(FLOW_POINT_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }

  if (!map.getLayer(LINE_LAYER_ID)) {
    const linePaint: maplibregl.LineLayerSpecification["paint"] = {
      "line-color": c.color,
      "line-width": c.lineWidth,
      "line-opacity": 1,
      "line-dasharray": [0, 1.6, 3.4],
    };
    map.addLayer({
      id: LINE_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      filter: ["==", ["get", "kind"], "asset-target-line"],
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: linePaint,
    });
  }
  if (!map.getLayer(FLOW_POINT_LAYER_ID)) {
    map.addLayer({
      id: FLOW_POINT_LAYER_ID,
      type: "circle",
      source: FLOW_POINT_SOURCE_ID,
      filter: ["==", ["get", "kind"], "asset-target-flow-point"],
      paint: {
        "circle-color": c.color,
        "circle-radius": c.flowPointRadius,
        "circle-opacity": 0.95,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-opacity": 0.85,
      },
    });
  }
  applyConnectionLinePaint(map);
}

function flushGeoJSON(): void {
  const mods = getMapModules();
  if (!mods) return;
  const map = mods.map;
  const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  src.setData(buildGeoJSON());
  const pointSrc = map.getSource(FLOW_POINT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (pointSrc) pointSrc.setData(buildFlowPointGeoJSON(animPhase));
}

/* ── 动画（含动态刷新线段端点） ── */

function startAnimation(): void {
  if (animTimer) return;
  animTimer = setInterval(() => {
    const cfg = getAssetTargetLineConfig();
    const cycleMs = Math.max(200, cfg.flowCycleMs);
    animPhase = (Date.now() % cycleMs) / cycleMs;
    /* 每 tick 刷新 GeoJSON，无人机/航迹/TDOA 移动后连线跟随 */
    flushGeoJSON();
    const mods = getMapModules();
    if (!mods) return;
    const map = mods.map;
    if (!map.getLayer(LINE_LAYER_ID)) return;
    applyConnectionLinePaint(map);
    const dashSequence: [number, number, number][] = [
      [0, 1.6, 3.4],
      [0.6, 1.6, 2.8],
      [1.2, 1.6, 2.2],
      [1.8, 1.6, 2.2],
    ];
    const idx = Math.floor(animPhase * dashSequence.length) % dashSequence.length;
    map.setPaintProperty(LINE_LAYER_ID, "line-dasharray", dashSequence[idx]);
  }, 80);
}

function stopAnimation(): void {
  if (animTimer) {
    clearInterval(animTimer);
    animTimer = null;
  }
}

/* ── 公共 API ── */

/**
 * 全量同步：连接列表即全集（旧实现）。仍用于需整体替换的场景。
 */
export function syncConnectionLines(connections: AssetTargetConnection[]): string[] {
  const mods = getMapModules();
  if (!mods) return [];

  const map = mods.map;
  ensureLayers(map);

  const newKeys = new Set(connections.map(connKey));
  const added: string[] = [];

  for (const key of [...activeConnections.keys()]) {
    if (!newKeys.has(key)) {
      activeConnections.delete(key);
    }
  }

  for (const conn of connections) {
    const key = connKey(conn);
    if (!activeConnections.has(key)) {
      activeConnections.set(key, conn);
      added.push(key);
    } else {
      activeConnections.set(key, conn);
    }
  }

  flushGeoJSON();

  if (activeConnections.size > 0) {
    startAnimation();
  } else {
    stopAnimation();
  }

  return added;
}

/** 仅追加/更新若干条连线，不删除其它已存在的连线（多资产处置同一目标） */
export function mergeConnectionLines(connections: AssetTargetConnection[]): void {
  const mods = getMapModules();
  if (!mods) return;
  ensureLayers(mods.map);
  for (const conn of connections) {
    activeConnections.set(connKey(conn), conn);
  }
  flushGeoJSON();
  if (activeConnections.size > 0) startAnimation();
}

/**
 * 同一告警目标下换新方案：删除「目标为该 targetId、且资产不在允许集合内」的连线。
 * @returns 被移除的资产 id（用于对该目标释放处置侧地图绑定：连线、激光/TDOA 等）
 */
export function pruneConnectionLinesForTarget(targetId: string, allowedAssetIds: Set<string>): string[] {
  const tid = String(targetId ?? "").trim();
  const removedAssets: string[] = [];
  if (!tid) return removedAssets;
  const allowedNorm = new Set([...allowedAssetIds].map((x) => String(x).trim().toLowerCase()));
  for (const [key, conn] of [...activeConnections.entries()]) {
    if (String(conn.targetId) !== tid) continue;
    const aid = String(conn.assetEntityId).trim().toLowerCase();
    if (!allowedNorm.has(aid)) {
      removedAssets.push(String(conn.assetEntityId));
      activeConnections.delete(key);
    }
  }
  flushGeoJSON();
  if (activeConnections.size === 0) stopAnimation();
  return removedAssets;
}

/**
 * 目标已消失（无法再由 track/asset 解析）时，清理对应连线。
 * - 不使用 fallback 坐标续画，避免目标消失后连线残留。
 * @returns 被移除的资产 id（用于关闭激光/TDOA 激活态）
 */
export function pruneConnectionLinesForMissingTargets(): string[] {
  const removedAssets: string[] = [];
  for (const [key, conn] of [...activeConnections.entries()]) {
    const targetAlive = resolveTrackLngLatForTargetId(conn.targetId) != null;
    if (targetAlive) continue;
    removedAssets.push(String(conn.assetEntityId));
    activeConnections.delete(key);
  }
  if (removedAssets.length > 0) {
    flushGeoJSON();
    if (activeConnections.size === 0) stopAnimation();
  }
  return removedAssets;
}

export function clearAllConnectionLines(): void {
  activeConnections.clear();
  flushGeoJSON();
  stopAnimation();
}

export function removeConnectionLinesForAsset(assetEntityId: string): void {
  for (const [key, conn] of activeConnections) {
    if (conn.assetEntityId === assetEntityId) {
      activeConnections.delete(key);
    }
  }
  flushGeoJSON();
  if (activeConnections.size === 0) stopAnimation();
}

export function destroyConnectionLines(): void {
  stopAnimation();
  activeConnections.clear();
  const mods = getMapModules();
  if (!mods) return;
  const map = mods.map;
  if (map.getLayer(FLOW_POINT_LAYER_ID)) map.removeLayer(FLOW_POINT_LAYER_ID);
  if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
  if (map.getSource(FLOW_POINT_SOURCE_ID)) map.removeSource(FLOW_POINT_SOURCE_ID);
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}
