"use client";

/**
 * ══════════════════════════════════════════════════════════════════════
 *  WebSocket 统一接入 —— 建连、解析、按 type 写入各 store
 * ══════════════════════════════════════════════════════════════════════
 *
 * 本模块是前端所有实时数据的唯一入口，负责：
 *   1. 建立 WebSocket 连接（地址、心跳间隔等从 app-config.json 的 websocket 节读取）
 *   2. 接收消息 → JSON.parse → 按 msg.type 分发
 *   3. 解析后的数据写入对应的 Zustand store（track-store / alert-store / asset-store / drone-store / zone-store）
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

import { useEffect, startTransition } from "react";
import { toast } from "sonner";
import { useTrackStore } from "@/stores/track-store";
import { useAlertStore } from "@/stores/alert-store";
import type { AssetData } from "@/stores/asset-store";
import { useAssetStore } from "@/stores/asset-store";
import type { ZoneData } from "@/stores/zone-store";
import { useZoneStore } from "@/stores/zone-store";
import { useDroneStore } from "@/stores/drone-store";
import { useEoCameraDdsStatusStore } from "@/stores/eo-camera-dds-status-store";
import { useAppConfigStore } from "@/stores/app-config-store";
import {
  mapEntitiesPayload,
  mergeDynamicAndStaticAssets,
  getCoordinateTransformConfig,
  getTrackRenderingConfig,
  getWebSocketConfig,
  getHttpConfig,
  shouldDisplayAssetId,
  shouldDisplayZone,
} from "@/lib/map-app-config";
import type { TrackWorkerConfig, TrackWorkerResult } from "@/lib/track-parse-worker";
import { normalizeIncomingTrack, normalizeIncomingTrackList } from "@/lib/ws-track-normalize";
import { normalizeWsAlertItem } from "@/lib/ws-alert-normalize";
import { normalizeAssetType, type PublicMapAssetType, type Track } from "@/lib/map-entity-model";
import { recordTrackReceived, recordAlertReceived, recordZoneReceived, recordEntityReceived, recordCameraReceived, recordDockReceived, recordDroneReceived, recordDroneFlightPathReceived } from "@/stores/network-stats-store";
import { parseForceDisposition } from "@/lib/theme-colors";
import { canonicalEntityId } from "@/lib/camera-entity-id";

/**
 * 联调：`.env.local` 设 `NEXT_PUBLIC_WS_DISABLE_TRACK_INGEST=true` 时不处理航迹类 WS、不写 `track-store`，
 * 并跳过航迹修剪定时器 / 查证图片轮询 / 告警 revision→航迹同步（`entity_status`、camera、告警列表等仍照常）。
 * 同时对该类消息尽量 **不做 JSON.parse**：大包 trackbatch 解析会长时间占主线程，拖慢同连接上后续光电帧。
 */
const WS_DISABLE_TRACK_INGEST =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_WS_DISABLE_TRACK_INGEST === "true";

/** 信封前若干字节内嗅探 `type`；嗅探失败则回退完整 parse（避免误判嵌套里 `"type":"Track"` 等） */
function peekWsTopLevelTypePrefix(raw: string, maxScan = 4096): string | null {
  const head = raw.charCodeAt(0) === 0xfeff ? raw.slice(1, maxScan) : raw.slice(0, maxScan);
  const m = /"type"\s*:\s*"([^"\\]*)"/i.exec(head);
  return m ? m[1]!.trim().toLowerCase() : null;
}

/** 在禁用航迹摄入（`WS_DISABLE_TRACK_INGEST=true`）时，直接按前缀嗅探丢弃的航迹消息类型集合 */
const WS_SKIP_PARSE_WHEN_TRACK_INGEST_DISABLED = new Set(["trackbatch", "track_update", "track_snapshot"]);

/**
 * 航迹批量包在 Worker 内完成 JSON.parse + normalize，完全不阻塞主线程。
 * 主线程只做最终的 setTracks（Zustand update + MapLibre setData）。
 * 覆盖 trackbatch / track_update / track_snapshot；单条 track 仍走主线程（帧较小）。
 */
const WORKER_TRACK_TYPES = new Set(["trackbatch", "track_update", "track_snapshot"]);

// ── 航迹蓄水池：同一时间窗口内多个 trackbatch 合并，主线程每 TRACK_FLUSH_INTERVAL_MS 只调一次 setTracks ──
/**
 * 根本问题：trackbatch 高频到达（如每 100ms 一包×500 条），即使 JSON.parse 在 Worker 完成，
 * Worker 的 onmessage 仍逐包调 setTracks，setTracks 本身的 Map 迭代仍在主线程占时 → 光电被挤占。
 *
 * 方案：把 Worker/主线程解析出的 Track 先积入 `_trackAccumulator`（以 showID 为 key，后来覆盖前值），
 * 以 TRACK_FLUSH_INTERVAL_MS 为周期统一调 setTracks 一次。
 * - camera/optodata/entity_status 不经此路径，继续同步处理。
 * - 单条 `track` 小包直接走同步路径（帧小，parse 快，无需积压）。
 */
const TRACK_FLUSH_INTERVAL_MS = 500;
const _trackAccumulator = new Map<string, import("@/lib/map-entity-model").Track>();
let _trackFlushTimer: ReturnType<typeof setTimeout> | null = null;
let _trackFlushTimestamp: string | undefined;

function scheduleTrackFlush() {
  if (_trackFlushTimer != null) return;
  _trackFlushTimer = setTimeout(() => {
    _trackFlushTimer = null;
    if (_trackAccumulator.size === 0) return;
    const batch = [..._trackAccumulator.values()];
    _trackAccumulator.clear();
    const ts = _trackFlushTimestamp;
    _trackFlushTimestamp = undefined;
    /* 航迹合并为低优先级过渡更新，让光电/资产等更「急」的渲染与 input 先跑 */
    startTransition(() => {
      useTrackStore.getState().setTracks(batch, ts !== undefined ? { lastUpdate: ts } : undefined);
      for (const t of batch) recordTrackReceived(!!t.isAirTrack);
    });
  }, TRACK_FLUSH_INTERVAL_MS);
}

/** 丢弃未 flush 的航迹（如 cleartracks），避免清空后下一 tick 仍写入旧数据 */
function discardPendingTrackAccumulator() {
  if (_trackFlushTimer !== null) {
    clearTimeout(_trackFlushTimer);
    _trackFlushTimer = null;
  }
  _trackAccumulator.clear();
  _trackFlushTimestamp = undefined;
}

function accumulateTracks(
  tracks: import("@/lib/map-entity-model").Track[],
  timestamp?: string,
) {
  for (const t of tracks) _trackAccumulator.set(t.showID, t);
  if (timestamp) _trackFlushTimestamp = timestamp;
  scheduleTrackFlush();
}

// ── 航迹解析 Worker 单例：JSON.parse + normalize 在工作线程，结果入蓄水池 ──
let _trackWorker: Worker | null = null;
let _workerAvailable = typeof Worker !== "undefined";

function getTrackWorker(): Worker | null {
  if (!_workerAvailable) return null;
  if (_trackWorker) return _trackWorker;
  try {
    const w = new Worker(new URL("../lib/track-parse-worker.ts", import.meta.url));
    w.onmessage = (e: MessageEvent<TrackWorkerResult>) => {
      const { tracks, timestamp } = e.data;
      if (tracks.length) {
        accumulateTracks(tracks as import("@/lib/map-entity-model").Track[], timestamp);
      }
    };
    w.onerror = (err) => {
      console.warn("[track-worker] 不可用，降级主线程处理", err.message ?? err);
      _trackWorker = null;
      _workerAvailable = false;
    };
    _trackWorker = w;
    sendTrackWorkerConfig();
    return w;
  } catch {
    _workerAvailable = false;
    return null;
  }
}

function sendTrackWorkerConfig() {
  const w = getTrackWorker();
  if (!w) return;
  const tCfg = getTrackRenderingConfig();
  const cCfg = getCoordinateTransformConfig();
  const config: TrackWorkerConfig = {
    coordinateTransformEnabled: cCfg.enabled,
    airIconHeadingOffsetDeg: tCfg.airIconHeadingOffsetDeg,
    airDefaultCourseDeg: tCfg.airDefaultCourseDeg,
  };
  w.postMessage({ type: "init", config });
}

/** 大批量航迹优先走 Worker（JSON.parse 在子线程），Worker 不可用则主线程解析后直接积入蓄水池 */
function postTrackPayloadToWorkerOrAccumulate(raw: string) {
  const w = getTrackWorker();
  if (w) {
    w.postMessage({ type: "parse", raw });
  } else {
    try {
      const msg = JSON.parse(raw) as Record<string, unknown>;
      const type = String((msg.type as string | undefined) ?? "").toLowerCase();
      const timestamp = msg.timestamp ? String(msg.timestamp) : undefined;
      let tracks: import("@/lib/map-entity-model").Track[] = [];
      if (type === "trackbatch") {
        const arr = msg.data;
        if (Array.isArray(arr)) {
          tracks = arr.map((item) => {
            if (!item || typeof item !== "object") return null;
            const envelope = item as Record<string, unknown>;
            return normalizeIncomingTrack(envelope.data ?? envelope);
          }).filter(Boolean) as import("@/lib/map-entity-model").Track[];
        }
      } else {
        const arr = msg.tracks;
        if (Array.isArray(arr)) tracks = normalizeIncomingTrackList(arr);
      }
      if (tracks.length) accumulateTracks(tracks, timestamp);
    } catch {
      /* 静默丢弃解析失败的包 */
    }
  }
}

/** 光电 Camera WS 调试：development 默认开；生产需 `NEXT_PUBLIC_DEBUG_WS_CAMERA=true`；全关设 `NEXT_PUBLIC_DEBUG_WS_CAMERA=false` */
function wsCameraDebugEnabled(): boolean {
  if (typeof process === "undefined") return false;
  if (process.env.NEXT_PUBLIC_DEBUG_WS_CAMERA === "false") return false;
  if (process.env.NEXT_PUBLIC_DEBUG_WS_CAMERA === "true") return true;
  return process.env.NODE_ENV === "development";
}

function logWsCamera(label: string, payload: Record<string, unknown>) {
  if (!wsCameraDebugEnabled()) return;
  console.info(`[NexusUI WS camera] ${label}`, payload);
}

/** 与 WS 全量资产列表合并：先静态后动态，同 id 以 WS 为准 */
let configAssetBaseCache: AssetData[] = [];
let lastWsAssetList: AssetData[] = [];
let relationshipAssetsCache: AssetData[] = [];
let cameraDefaultRangeKmCache: number | undefined;

function filterAssetsForDisplay(assets: AssetData[]): AssetData[] {
  return assets.filter((a) => shouldDisplayAssetId(a.asset_type, a.id, a.name));
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
  try {
    sendTrackWorkerConfig();
  } catch {
    /* Worker 或非浏览器环境不可用 */
  }
}

function mergeAssetRowsById(base: AssetData[], overlays: AssetData[]): AssetData[] {
  if (!overlays.length) return base;
  const byId = new Map<string, AssetData>(base.map((a) => [a.id, a]));
  for (const row of overlays) {
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

/** 资产总入口：静态配置 + WS 实体 + relationships 机场/无人机 统一合并后一次性写入 */
function rebuildAndCommitAssetSnapshot() {
  const mergedStaticAndWs = mergeDynamicAndStaticAssets(configAssetBaseCache, lastWsAssetList);
  const mergedAll = mergeAssetRowsById(mergedStaticAndWs, relationshipAssetsCache);
  useAssetStore.getState().setAssets(filterAssetsForDisplay(mergedAll));
}

/** WS 列表级合并：新帧字段缺失/无效时，保留上一帧同 id 的数值字段，避免被 null 覆盖 */
function mergeWsRowsPreserveNullableNumeric(prevRows: AssetData[], incomingRows: AssetData[]): AssetData[] {
  if (prevRows.length === 0) return incomingRows;
  const prevById = new Map(prevRows.map((r) => [r.id, r]));
  const incomingById = new Map(incomingRows.map((r) => [r.id, r]));

  const mergeOne = (row: AssetData, prev: AssetData | undefined): AssetData => {
    if (!prev) return row;
    return {
      ...row,
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
  };

  const out: AssetData[] = incomingRows.map((row) => mergeOne(row, prevById.get(row.id)));

  /* 相机：部分环境 entity_status 不全量带光电，仅 DDS camera 在推角；若只按 incoming map 会丢掉仅有实时流的行，合并后只剩静态角 → 「不刷新不变」 */
  for (const prev of prevRows) {
    if (prev.asset_type !== "camera") continue;
    if (incomingById.has(prev.id)) continue;
    out.push(prev);
  }
  return out;
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
  /* 无人机由 syncDroneAndAirportAssetsFromRelationships 统一管理（用 deviceSn 做 key），
   * 此处过滤掉 WS 实体列表中的无人机（用 entityId 做 key），防止同一无人机出现两条记录 */
  const nonDroneList = list
    .filter((a) => a.asset_type !== "drone")
    .map((a) => {
      if (a.asset_type !== "camera") return a;
      /* camera 的 PTZ/FOV/射程只接受 camera/optoelectronic，entity_status 一律不写这三项 */
      return { ...a, heading: null, fov_angle: null, range_km: null };
    });
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
  alarmCleanupTimer: null as ReturnType<typeof setInterval> | null,
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

function isoNow() {
  return new Date().toISOString();
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

/** DDS 全景：地图方位 ≈ `ptz.pan + panoOffset`（与常见帧里 `originPtz.pan` 一致）；缺 `panoOffset` 时用 origin→ptz。 */
function parseCameraBearingDeg(d: Record<string, unknown>): number | undefined {
  const originPtz = d.originPtz as Record<string, unknown> | undefined;
  const ptz = d.ptz as Record<string, unknown> | undefined;
  const pPan = Number(ptz?.pan);
  const pano = Number(d.panoOffset);
  if (Number.isFinite(pPan) && Number.isFinite(pano)) {
    return pPan + pano;
  }
  const v = originPtz?.pan ?? ptz?.pan ?? d.pan ?? d.p;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 相机水平视场开角（度）：`fov.horizontal`、DDS `FOVStatus.hs`（`fov.hs`）、顶层别名。
 */
function parseCameraHorizontalFovDeg(d: Record<string, unknown>): number | undefined {
  const fov = d.fov as Record<string, unknown> | undefined;
  const v = fov?.horizontal ?? fov?.hs ?? d.horizontalFov ?? d.horizontal_fov ?? d.hs;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** 部分网关把载荷放在 `msg.data`，也有字段摊在根上；id 在信封、PTZ/FOV 在 data 时合并。仅在 camera/optoelectronic/optodata 分支调用。 */
function unwrapCameraWsMessagePayload(msg: Record<string, unknown>): Record<string, unknown> {
  const data = msg.data;
  if (data != null && typeof data === "object" && !Array.isArray(data)) {
    const inner = data as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...inner };
    for (const k of ["entityId", "cameraId", "deviceId", "id"] as const) {
      if (merged[k] == null && msg[k] != null) merged[k] = msg[k];
    }
    return merged;
  }
  return msg;
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

function inferZoneType(name: string): "no-fly" | "warning" | "exercise" {
  const n = name || "";
  if (n.includes("禁飞") || n.includes("拒止") || /no-fly/i.test(n)) return "no-fly";
  if (n.includes("警告") || n.includes("驱离") || /warning/i.test(n)) return "warning";
  return "exercise";
}

function toLngLatPair(v: unknown): [number, number] | null {
  if (Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number") {
    return [v[0], v[1]];
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const lng = o.lng ?? o.longitude ?? o.lon;
    const lat = o.lat ?? o.latitude;
    const ln = typeof lng === "number" ? lng : Number(lng);
    const la = typeof lat === "number" ? lat : Number(lat);
    if (Number.isFinite(ln) && Number.isFinite(la)) return [ln, la];
  }
  return null;
}

function normalizePolygonRing(raw: unknown): Array<[number, number]> | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const ring: Array<[number, number]> = [];
  for (const p of raw) {
    const c = toLngLatPair(p);
    if (c) ring.push(c);
  }
  if (ring.length < 3) return null;
  const [fx, fy] = ring[0]!;
  const [lx, ly] = ring[ring.length - 1]!;
  if (fx !== lx || fy !== ly) ring.push([fx, fy]);
  return ring;
}

function circleToRingMeters(cx: number, cy: number, radiusM: number, segments = 36): Array<[number, number]> {
  const R = Math.max(1, radiusM);
  const mPerDegLat = 111_320;
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    const ang = (i / segments) * Math.PI * 2;
    const northM = R * Math.cos(ang);
    const eastM = R * Math.sin(ang);
    const dLat = northM / mPerDegLat;
    const dLng = eastM / (mPerDegLat * Math.max(0.2, Math.cos((cy * Math.PI) / 180)));
    ring.push([cx + dLng, cy + dLat]);
  }
  return ring;
}

function vueZoneItemToZoneData(z: Record<string, unknown>): ZoneData | null {
  const id = String(z.id ?? z.areaId ?? "");
  if (!id) return null;
  const name = String(z.name ?? z.areaName ?? id);
  const geometryType = String(z.geometryType ?? "Polygon");
  const now = isoNow();

  let coordinates: Array<[number, number]> | null = null;
  if (geometryType === "Circle") {
    const c = z.center;
    const r = Number(z.radius);
    const center = Array.isArray(c) ? toLngLatPair(c) : null;
    if (center && Number.isFinite(r) && r > 0) {
      coordinates = circleToRingMeters(center[0], center[1], r);
    }
  } else {
    coordinates = normalizePolygonRing(z.coordinates);
  }
  if (!coordinates || coordinates.length < 4) return null;

  const zt = inferZoneType(name);
  const line = (z.strokeColor as string) ?? "#3b82f6";
  const fill = (z.fillColor as string) ?? line;
  const rawFo = z.fillOpacity ?? z.fill_opacity;
  let fill_opacity = 0.25;
  if (typeof rawFo === "number" && Number.isFinite(rawFo)) fill_opacity = Math.min(1, Math.max(0, rawFo));
  else if (rawFo != null && String(rawFo).trim() !== "") {
    const n = Number(rawFo);
    if (Number.isFinite(n)) fill_opacity = Math.min(1, Math.max(0, n));
  }
  return {
    id, name, zone_type: zt, source: "websocket", coordinates,
    color: line, fill_color: fill,
    fill_opacity,
    properties: { geometryType, areaType: z.areaType, isActive: z.isActive },
    created_at: now, updated_at: now,
  };
}

function mapZonesPayload(payload: unknown): ZoneData[] {
  if (!Array.isArray(payload)) return [];
  const out: ZoneData[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const zd = vueZoneItemToZoneData(item as Record<string, unknown>);
    if (zd) out.push(zd);
  }
  return out;
}

// ── 资产事件 ──

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

function payloadArray(msg: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(msg.data)) return msg.data as unknown[];
  if (Array.isArray(msg.assets)) return msg.assets as unknown[];
  if (Array.isArray(msg.entities)) return msg.entities as unknown[];
  if (Array.isArray(msg.zones)) return msg.zones as unknown[];
  return null;
}

/**
 * 【entity_status 第3步】遍历 drone-store.relationships，将机场和无人机 upsert 进 asset-store。
 *
 * 【关键】机场/无人机沿用 dockSn/deviceSn 作为资产 ID（与 drone-store 一致），
 * 在统一快照阶段一次性覆盖进 asset-store，避免「先 setAssets 再 upsert」双入口写入。
 *
 * 数据来源：drone-store.relationships 由第1步 applyEntityStatusMessage() 解析得到。
 */
function collectDroneAndAirportAssetsFromRelationships(): AssetData[] {
  const ds = useDroneStore.getState();
  const now = isoNow();
  const rows: AssetData[] = [];

  for (const ap of ds.relationships?.airports ?? []) {
    if (!ap.dockSn) continue;

    // ── 机场：用 dockSn 作为资产 key（机场没有 entityId）──
    const airportId = ap.dockSn;
    if (shouldDisplayAssetId("airport", airportId)) {
      const airportName = ds.docks[ap.dockSn]?.displayName ?? "机场";
      const lat = ap.latitude ?? null;
      const lng = ap.longitude ?? null;
      if (lat == null || lng == null) continue;
      rows.push({
        id: airportId,
        name: airportName,
        asset_type: "airport",
        status: "online",
        disposition: "friendly",
        lat,
        lng,
        range_km: null,
        heading: null,
        fov_angle: null,
        properties: { virtual_troop: ap.virtualTroop, dock_sn: ap.dockSn },
        mission_status: "monitoring",
        assigned_target_id: null,
        target_lat: null,
        target_lng: null,
        created_at: now,
        updated_at: now,
      });
    }

    // ── 无人机：用 deviceSn 作为资产 key（与机场用 dockSn 一致，与地图点击返回的 sn 一致）──
    for (const dr of ap.drones) {
      if (!dr.deviceSn) continue;
      const droneAssetId = dr.deviceSn;
      if (!shouldDisplayAssetId("drone", droneAssetId, dr.name)) continue;
      const droneName = dr.name || dr.deviceSn;
      const lat = dr.latitude ?? null;
      const lng = dr.longitude ?? null;
      if (lat == null || lng == null) continue;
      rows.push({
        id: droneAssetId,
        name: droneName,
        asset_type: "drone",
        status: "online",
        disposition: "friendly",
        lat,
        lng,
        range_km: null,
        heading: null,
        fov_angle: null,
        properties: { virtual_troop: dr.virtualTroop, dock_sn: ap.dockSn, device_sn: dr.deviceSn, entity_id: dr.entityId ?? "" },
        mission_status: "monitoring",
        assigned_target_id: null,
        target_lat: null,
        target_lng: null,
        created_at: now,
        updated_at: now,
      });
    }
  }
  return rows;
}

// ── 告警 taskStatus 判断 ──

function isVerifySuccessAlarmRaw(raw: Record<string, unknown>): boolean {
  const status = raw.taskStatus ?? raw.task_status;
  if (status == null) return false;
  if (typeof status === "string") {
    const n = status.trim().toUpperCase();
    return n === "VERIFY_SUCCESS" || n.endsWith("::VERIFY_SUCCESS");
  }
  return Number(status) === 3;
}

/** 统一的 alarm 处理：判断 alarm vs threat 后写入 store */
function handleAlarmItem(raw: Record<string, unknown>) {
  const normalized = normalizeWsAlertItem(raw);
  if (!normalized) return;
  const alertStore = useAlertStore.getState();
  if (isVerifySuccessAlarmRaw(raw)) alertStore.upsertAlarm(normalized);
  else alertStore.upsertThreat(normalized);
}

/**
 * 【消息分发】WebSocket 收到消息后的统一入口。
 *
 * 解析 JSON 后按 msg.type 分发到对应处理逻辑：
 *
 * ┌─ type ─────────────┬─ 处理说明 ────────────────────────────────────────────────────────┐
 * │ trackbatch / track │ 航迹数据 → normalizeIncomingTrack → track-store.setTracks       │
 * │ alarm / alert      │ 告警数据 → normalizeWsAlertItem → alert-store.upsertAlarm/Threat │
 * │ zones              │ 区域数据 → normalizePolygonRing → zone-store.setZones            │
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
function dispatchWsMessageSync(raw: string) {
  const msg = JSON.parse(raw) as Record<string, unknown>;
  const type = (msg.type as string | undefined)?.toLowerCase();
  if (!type) return;

  switch (type) {
      // ── 航迹 ──
      case "trackbatch": {
        if (WS_DISABLE_TRACK_INGEST) break;
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
            .filter(Boolean) as Track[];
          if (tracks.length)
            accumulateTracks(tracks, msg.timestamp ? String(msg.timestamp) : undefined);
        }
        break;
      }
      case "track": {
        if (WS_DISABLE_TRACK_INGEST) break;
        // V2 单条 Track
        const t = normalizeIncomingTrack(msg.data ?? msg);
        if (t) {
          const ts = msg.timestamp ? String(msg.timestamp) : undefined;
          startTransition(() => {
            useTrackStore.getState().setTracks([t], ts !== undefined ? { lastUpdate: ts } : undefined);
            recordTrackReceived(!!t.isAirTrack);
          });
        }
        break;
      }
      case "track_update":
      case "track_snapshot": {
        if (WS_DISABLE_TRACK_INGEST) break;
        const tracks = msg.tracks as unknown[] | undefined;
        if (Array.isArray(tracks)) {
          const normalized = normalizeIncomingTrackList(tracks);
          if (normalized.length)
            accumulateTracks(normalized, msg.timestamp ? String(msg.timestamp) : undefined);
        }
        break;
      }

      // ── 告警 ──
      case "alarm": {
        // V2 Alarm: data = { alarms: [...] } 或 data 直接是单条
        const d = msg.data as Record<string, unknown> | undefined;
        if (d) {
          if (Array.isArray(d.alarms)) {
            for (const a of d.alarms) {
              if (a && typeof a === "object") handleAlarmItem(a as Record<string, unknown>);
            }
          } else {
            handleAlarmItem(d);
          }
          recordAlertReceived();
        }
        break;
      }
      case "alert_batch": {
        const list = msg.alerts as unknown[] | undefined;
        if (Array.isArray(list)) {
          for (const r of list) {
            if (r && typeof r === "object") handleAlarmItem(r as Record<string, unknown>);
          }
          recordAlertReceived();
        }
        break;
      }
      case "alert": {
        const inner = (msg.data ?? msg) as Record<string, unknown>;
        handleAlarmItem(inner);
        recordAlertReceived();
        break;
      }

      // ── map_command ──
      case "map_command": {
        const wrap = msg.data;
        if (!wrap || typeof wrap !== "object") break;
        const w = wrap as Record<string, unknown>;
        if (w.command !== "alert") break;
        const inner = w.data;
        const payload =
          inner != null && typeof inner === "object" && !Array.isArray(inner)
            ? (inner as Record<string, unknown>)
            : w;
        const one = normalizeWsAlertItem(payload);
        if (one) useAlertStore.getState().upsertAlarm(one);
        break;
      }

      // ── 区域 ──
      case "zones": {
        const arr = payloadArray(msg);
        if (arr?.length) {
          const zones = mapZonesPayload(arr).filter((z) => shouldDisplayZone(z));
          useZoneStore.getState().setZones(zones);
          recordZoneReceived();
        }
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
        useDroneStore.getState().applyEntityStatusMessage(msg);

        /* ── 第2步：解析实体（雷达、相机等），写入 asset-store ── */
        const rawEntities: unknown[] | null =
          Array.isArray(msg.entities) ? msg.entities : null;
        if (rawEntities) {
          const parsed = mapEntitiesPayload(rawEntities);
          applyAssetListFromWs(parsed, { commit: false });
          for (const a of parsed) {
            if (a.id) recordEntityReceived(a.id, a.asset_type);
          }
        } else {
          console.warn(`[entity_status] 无实体数据`);
        }

        /* ── 第3步：将第1步解析的机场/无人机并入统一资产快照 ── */
        relationshipAssetsCache = collectDroneAndAirportAssetsFromRelationships();
        rebuildAndCommitAssetSnapshot();
        break;
      }

      // ── 光电 ──
      case "camera":
      case "optoelectronic":
      case "optodata": {
        // V2 / DDS：pan + fov.horizontal 或 fov.hs（FastDDS FOVStatus.hs）；载荷可能在 data 或根上
        const d = unwrapCameraWsMessagePayload(msg);
        const rawId = String(d.entityId ?? d.cameraId ?? d.deviceId ?? d.id ?? "").trim();
        logWsCamera("frame", {
          wsType: type,
          rawId: rawId || "(empty)",
          hasDataObject: msg.data != null && typeof msg.data === "object",
        });
        const rawForDds = rawId;
        if (rawForDds) {
          useEoCameraDdsStatusStore.getState().ingestCameraPayload({
            ...d,
            entityId: canonicalEntityId(rawForDds),
          });
        }
        const entityId = rawId ? canonicalEntityId(rawId) : "";
        if (!entityId) {
          logWsCamera("skip:no-entityId", { rawId, keys: Object.keys(d).slice(0, 24) });
          break;
        }
        if (entityId) {
          /* 勿用 `d.type`：载荷里可能是任务/本体类型等非 map 资产枚举，`normalizeAssetType` 会抛错并被 dispatch 外层 catch 吞掉 → 扇区永不更新 */
          let atType: PublicMapAssetType = "camera";
          if (d.asset_type != null && String(d.asset_type).trim() !== "") {
            try {
              atType = normalizeAssetType(String(d.asset_type));
            } catch {
              atType = "camera";
            }
          }
          if (!shouldDisplayAssetId(atType, entityId)) {
            logWsCamera("skip:shouldDisplayAssetId=false", { entityId, atType });
            break;
          }
          const bearing = parseCameraBearingDeg(d);
          const fovDeg = parseCameraHorizontalFovDeg(d);

          const rawRange = d.range_km;
          const hasRange = rawRange != null && Number.isFinite(Number(rawRange)) && Number(rawRange) > 0;
          const rangeKm = hasRange ? parseCameraRangeKm(d) : undefined;
          const effectiveRangeKm = rangeKm ?? cameraDefaultRangeKm(entityId);
          const status = d.online === false ? "offline" : "online";
          const ptzPan = Number((d.ptz as Record<string, unknown> | undefined)?.pan);
          const originPan = Number((d.originPtz as Record<string, unknown> | undefined)?.pan);
          const panoOff = Number(d.panoOffset);
          logWsCamera("parsed", {
            entityId,
            bearing,
            fovDeg,
            effectiveRangeKm,
            ptzPan: Number.isFinite(ptzPan) ? ptzPan : "(none)",
            originPan: Number.isFinite(originPan) ? originPan : "(none)",
            panoOffset: Number.isFinite(panoOff) ? panoOff : "(none)",
            hasLatLng: !!extractCameraLatLng(d),
          });
          const baseProps: Record<string, unknown> = {
            config_kind: "camera",
            ...(typeof d.properties === "object" && d.properties ? (d.properties as Record<string, unknown>) : {}),
          };
          if (d.taskType != null) baseProps.taskType = d.taskType;
          if (d.executionState != null) baseProps.executionState = d.executionState;
          if (d.online !== undefined) baseProps.online = d.online;

          const patch: Partial<AssetData> = {
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

          /* 把实时 PTZ/坐标/状态写入 lastWsAssetList，再走统一重建通道 → setAssets → Map2D 订阅 → flushAssets */
          const now = isoNow();
          const others = lastWsAssetList.filter((a) => a.id !== entityId);
          const prev = lastWsAssetList.find((a) => a.id === entityId);
          if (prev) {
            lastWsAssetList = [
              ...others,
              {
                ...prev,
                status,
                properties: { ...(prev.properties as Record<string, unknown> | null ?? {}), ...baseProps },
                ...(patch.heading !== undefined ? { heading: patch.heading } : {}),
                ...(patch.fov_angle !== undefined ? { fov_angle: patch.fov_angle } : {}),
                ...(patch.range_km !== undefined ? { range_km: patch.range_km } : {}),
                ...(patch.lat !== undefined ? { lat: patch.lat } : {}),
                ...(patch.lng !== undefined ? { lng: patch.lng } : {}),
                updated_at: now,
              },
            ];
          } else {
            lastWsAssetList = [
              ...others,
              {
                id: entityId,
                name: String(d.name ?? d.entityName ?? entityId),
                asset_type: atType,
                status,
                disposition: parseForceDisposition(d.disposition, "friendly"),
                lat: ll?.lat ?? 0,
                lng: ll?.lng ?? 0,
                range_km: effectiveRangeKm ?? null,
                heading: bearing ?? null,
                fov_angle: fovDeg ?? null,
                properties: {
                  ...baseProps,
                  ...(!ll ? { center_icon_visible: false, fov_sector_visible: false, ws_camera_pending_position: true } : {}),
                },
                mission_status: "monitoring",
                assigned_target_id: null,
                target_lat: null,
                target_lng: null,
                created_at: now,
                updated_at: now,
              },
            ];
          }
          rebuildAndCommitAssetSnapshot();
          const assetsSnap = useAssetStore.getState().assets;
          const row = assetsSnap.find((a) => a.id === entityId);
          const cameraIdsOnMap = assetsSnap.filter((a) => a.asset_type === "camera").map((a) => a.id);
          logWsCamera("after-rebuild", {
            entityId,
            lastWsHadPrevRow: !!prev,
            lastWsCameraRows: lastWsAssetList.filter((r) => r.asset_type === "camera").map((r) => r.id),
            inStore: !!row,
            storeHeading: row?.heading ?? "(null)",
            storeFov: row?.fov_angle ?? "(null)",
            storeRangeKm: row?.range_km ?? "(null)",
            cameraIdsInStore: cameraIdsOnMap,
          });
          /* 与 C2 行为对齐：重建快照后再直接 patch store，避免 lastWsAssetList/合并链路与屏上 id 不一致时扇区不刷新 */
          const canMerge = assetsSnap.some((a) => a.id === entityId);
          if (canMerge) {
            const direct: Partial<AssetData> = {};
            if (bearing !== undefined) direct.heading = bearing;
            if (fovDeg !== undefined) direct.fov_angle = fovDeg;
            if (effectiveRangeKm !== undefined) direct.range_km = effectiveRangeKm;
            if (ll) {
              direct.lat = ll.lat;
              direct.lng = ll.lng;
            }
            direct.status = status;
            useAssetStore.getState().mergeAssetFields(entityId, direct);
            logWsCamera("mergeAssetFields", { entityId, keys: Object.keys(direct) });
          } else {
            logWsCamera("skip:mergeAssetFields(no row in store after rebuild)", { entityId, cameraIdsInStore: cameraIdsOnMap });
          }
        }
        break;
      }

      // ── 机场 / 无人机 ──
      case "dockstatus":
      case "dock_status": {
        const d = msg.data as Record<string, unknown> | undefined;
        if (!d || d.latitude == null || d.longitude == null) break;
        const dockSn = String(d.dock_sn ?? d.sn ?? "").trim();
        if (!dockSn) break;
        useDroneStore.getState().setDockStatus(d);
        /* dock_status 只更新已有机场资产，不新增。
         * 机场用 dockSn 做 key（机场没有 entityId） */
        const existingAsset = useAssetStore.getState().assets.find((x) => x.id === dockSn);
        if (!existingAsset) break;
        const airportName = useDroneStore.getState().docks[dockSn]?.displayName ?? "机场";
        const prevProps =
          existingAsset.properties && typeof existingAsset.properties === "object"
            ? ({ ...(existingAsset.properties as Record<string, unknown>) } as Record<string, unknown>)
            : {};
        useAssetStore.getState().mergeAssetFields(dockSn, {
          lat: Number(d.latitude),
          lng: Number(d.longitude),
          name: airportName,
          properties: {
            ...prevProps,
            dock: d,
            map_label: airportName,
            virtual_troop: existingAsset.properties?.virtual_troop ?? false,
          },
        });
        break;
      }
      case "dronestatus":
      case "drone_status": {
        const d = msg.data as Record<string, unknown> | undefined;
        if (d) useDroneStore.getState().setDroneStatus(d);
        break;
      }
      case "droneflightpath":
      case "drone_flight_path": {
        const d = msg.data as Record<string, unknown> | undefined;
        if (d && typeof d === "object") useDroneStore.getState().setDroneFlightPath(d);
        break;
      }
      case "highfreq":
      case "high_freq": {
        const d = msg.data as Record<string, unknown> | undefined;
        if (d && typeof d === "object") useDroneStore.getState().setHighFreq(d);
        break;
      }
      case "cleardrones":
      case "cleartracks":
        useDroneStore.getState().clearDrones();
        relationshipAssetsCache = [];
        rebuildAndCommitAssetSnapshot();
        if (type === "cleartracks" && !WS_DISABLE_TRACK_INGEST) {
          discardPendingTrackAccumulator();
          useTrackStore.getState().clearAllTracks();
        }
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
      case "speedcamera":
        break;

      default:
        break;
    }
}

function dispatchWsMessage(raw: string) {
  try {
    if (WS_DISABLE_TRACK_INGEST) {
      const earlyType = peekWsTopLevelTypePrefix(raw);
      if (earlyType && WS_SKIP_PARSE_WHEN_TRACK_INGEST_DISABLED.has(earlyType)) {
        return;
      }
    } else {
      const earlyType = peekWsTopLevelTypePrefix(raw);
      if (earlyType && WORKER_TRACK_TYPES.has(earlyType)) {
        postTrackPayloadToWorkerOrAccumulate(raw);
        return;
      }
    }
    dispatchWsMessageSync(raw);
  } catch (e) {
    if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_DEBUG_WS_CAMERA === "true") {
      console.warn("[NexusUI WS] dispatchWsMessage error (完整 JSON 可能被截断)", e, String(raw).slice(0, 500));
    }
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
      notify("WebSocket 已就绪", url, "success");
    }
  };

  socket.onmessage = (ev) => {
    const data = ev.data;
    if (typeof data === "string") {
      dispatchWsMessage(data);
      return;
    }
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      void data
        .text()
        .then((raw) => dispatchWsMessage(raw))
        .catch(() => {});
    }
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
  if (WS_DISABLE_TRACK_INGEST) return;
  if (ws.trackPruneTimer) clearInterval(ws.trackPruneTimer);
  const tick = () => Math.max(500, getTrackRenderingConfig().trackTimeout.checkIntervalMs);
  ws.trackPruneTimer = setInterval(() => {
    useTrackStore.getState().pruneStaleTracks();
  }, tick());
}

function startAlarmCleanup() {
  if (ws.alarmCleanupTimer) clearInterval(ws.alarmCleanupTimer);
  ws.alarmCleanupTimer = setInterval(() => {
    const before = useAlertStore.getState().alerts.length;
    useAlertStore.getState().removeStaleAlarms();
    const after = useAlertStore.getState().alerts.length;
    if (before !== after && !WS_DISABLE_TRACK_INGEST) {
      useTrackStore.getState().syncWithAlarms(useAlertStore.getState().alarmTrackIds);
    }
  }, 5_000);
}

function stopAlarmCleanup() {
  if (ws.alarmCleanupTimer) { clearInterval(ws.alarmCleanupTimer); ws.alarmCleanupTimer = null; }
}

function startAlertRevisionSync() {
  if (ws.alertRevisionUnsub) return;
  let lastRev = useAlertStore.getState().alarmTrackRevision;
  ws.alertRevisionUnsub = useAlertStore.subscribe((state) => {
    if (state.alarmTrackRevision !== lastRev) {
      lastRev = state.alarmTrackRevision;
      if (!WS_DISABLE_TRACK_INGEST) {
        useTrackStore.getState().syncWithAlarms(state.alarmTrackIds);
      }
    }
  });
}

function stopAlertRevisionSync() {
  if (ws.alertRevisionUnsub) { ws.alertRevisionUnsub(); ws.alertRevisionUnsub = null; }
}

// ── 查证图片轮询 ──
/** GET /api/image/{id} 连续 404 时暂缓该 ID，减少控制台刷屏 */
const imageNotFoundUntil = new Map<string, number>();
const IMAGE_404_RETRY_AFTER_MS = 5 * 60 * 1000;

function startImagePolling() {
  if (WS_DISABLE_TRACK_INGEST) return;
  if (ws.imagePollTimer) clearInterval(ws.imagePollTimer);
  const httpCfg = getHttpConfig();
  const { getRenderCache } = require("@/stores/track-store") as { getRenderCache: () => Map<string, import("@/lib/map-entity-model").Track> };
  const { updateTrackImage } = useTrackStore.getState();

  ws.imagePollTimer = setInterval(async () => {
    const cache = getRenderCache();
    const now = Date.now();
    for (const [showID, track] of cache) {
      try {
        const resumeAt = imageNotFoundUntil.get(showID);
        if (resumeAt != null && resumeAt > now) continue;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), httpCfg.imageFetchTimeoutMs);
        const res = await fetch(`${httpCfg.backendUrl}/api/image/${encodeURIComponent(showID)}`, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.status === 404) {
          imageNotFoundUntil.set(showID, now + IMAGE_404_RETRY_AFTER_MS);
          continue;
        }
        if (!res.ok) continue;
        imageNotFoundUntil.delete(showID);
        const json = await res.json() as Record<string, unknown>;
        const result = json.result as Record<string, unknown> | undefined;
        const raw = result?.data as Record<string, unknown> | undefined;
        const imageBase64 = raw?.imageBase64 as string | undefined;
        if (!imageBase64) continue;
        const imageUrl = imageBase64.startsWith("data:")
          ? imageBase64
          : `data:image/jpeg;base64,${imageBase64}`;
        updateTrackImage(showID, imageUrl);
      } catch {
        // timeout / network error → next cycle will retry
      }
    }
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
  if (WS_DISABLE_TRACK_INGEST) {
    useTrackStore.getState().clearAllTracks();
  }
  notify("正在连接 WebSocket", "", "info");
  openConnection();
  startTrackStalePrune();
  startAlarmCleanup();
  startAlertRevisionSync();
  startImagePolling();
}

function stopUnifiedWs() {
  ws.running = false;
  if (ws.trackPruneTimer) { clearInterval(ws.trackPruneTimer); ws.trackPruneTimer = null; }
  stopAlarmCleanup();
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

/**
 * 仅保证统一 WS 已启动（如光电页需要 DDS/资产态前拉配置）。
 * 不在卸载时调用 `stopUnifiedWs`，避免关闭光电弹窗或子页卸载时断开全站 WS（由 `AppShell` 里 `useUnifiedWsFeed` 独占 teardown）。
 */
export function useEnsureUnifiedWsConnection(): void {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await reloadAppConfigAssetBase();
      if (cancelled) return;
      startUnifiedWs();
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
