import { create } from "zustand";
import { getDroneMapRenderingConfig } from "@/lib/map-app-config";
import { EXCLUDE_AIRPORT_IDS, EXCLUDE_DRONE_NAMES } from "@/lib/map-display-filters";

/**
 * 无人机 / 机场实时态（WS 写入，无 HTTP 轮询）。
 *
 * 设计原则：
 * - entity_status 是唯一的新增入口（无人机和机场资产只能由此创建）
 * - drone_status / high_freq / drone_flight_path / dock_status 只更新已有资产，不新增
 * - entityReady 门控：在第一次 entity_status 到达之前，所有状态消息被忽略
 * - 名称只从 entity_status 的 relationships.airports[].drones[].name 提取，存入 telemetry.displayName
 *
 * ID 映射（关键）：
 * - entity_status 的 relationships 按 deviceSn 索引，由此创建无人机记录（key = deviceSn）
 * - drone_flight_path / drone_status / high_freq 消息仅携带 entityId（如 "uav-xxx"）
 * - 因此在解析 relationships 时同步构建 entityId→deviceSn 映射表（entityIdToDeviceSn）
 * - 所有 set* 方法通过 resolveDroneSn() 用 entityId 查映射表得到 deviceSn，再定位缓存记录
 */

/** 虚兵无人机 SN 表 */
const VIRTUAL_TROOP_DRONE_SNS = [
  "DroneAABBCCDD101",
  "DroneAABBCCDD102",
  "DroneAABBCCDD103",
  "DroneAABBCCDD104",
] as const;
/** 虚兵机场 SN 表 */
const VIRTUAL_TROOP_DOCK_SNS = [
  "DockAABBCCDD101",
  "DockAABBCCDD102",
  "DockAABBCCDD103",
  "DockAABBCCDD104",
] as const;

const VT_DRONE_SET = new Set<string>(VIRTUAL_TROOP_DRONE_SNS);
const VT_DOCK_SET = new Set<string>(VIRTUAL_TROOP_DOCK_SNS);

export function virtualTroopForDroneSn(sn: string): boolean {
  return VT_DRONE_SET.has(String(sn || "").trim());
}

export function virtualTroopForDockSn(sn: string): boolean {
  return VT_DOCK_SET.has(String(sn || "").trim());
}

function isExcludedAirportDock(dockSn: string): boolean {
  const s = String(dockSn ?? "").trim();
  if (!s) return true;
  return EXCLUDE_AIRPORT_IDS.has(s);
}

function isExcludedDroneName(name: string | undefined): boolean {
  const n = String(name ?? "").trim();
  if (!n) return false;
  return EXCLUDE_DRONE_NAMES.has(n);
}

/** `entity_status` WS 消息 -> `relationships.airports` 原始数组 | null */
function parseRelationshipsAirportsFromWsMessage(msg: Record<string, unknown>): unknown[] | null {
  const pick = (root: unknown): unknown[] | null => {
    if (!root || typeof root !== "object") return null;
    const rel = (root as Record<string, unknown>).relationships;
    if (!rel || typeof rel !== "object") return null;
    const a = (rel as Record<string, unknown>).airports;
    return Array.isArray(a) ? a : null;
  };
  const data = msg.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const fromNested = pick(data);
    if (fromNested) return fromNested;
  }
  return pick(msg);
}

/** 机务 `drones[]` 一行：deviceSn + entityId + 可选名称 + 坐标 + 虚兵 */
interface RelationshipDroneRow {
  /** 设备序列号（drone_status / high_freq 用此字段） */
  deviceSn: string;
  /** 实体 ID（drone_flight_path 用此字段，如 "uav-xxx"） */
  entityId?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  virtualTroop: boolean;
}

/** 机务 `airports[]` 一行：dockSn + 下属 drones[] + 可选坐标 */
interface RelationshipAirportRow {
  dockSn: string;
  entityId?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  drones: RelationshipDroneRow[];
  virtualTroop: boolean;
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function appendHistoryTrail(
  prev: DroneTelemetry,
  lat: number,
  lng: number,
): Array<[number, number]> {
  const cfg = getDroneMapRenderingConfig();
  if (!cfg.showHistoryTrail) return [];
  const max = Math.max(2, Math.floor(cfg.maxHistoryPoints));
  const trail: Array<[number, number]> = [...prev.historyTrail];
  const last = trail[trail.length - 1];
  if (last) {
    const [plng, plat] = last;
    if (haversineM(plat, plng, lat, lng) < 1) return trail;
  }
  trail.push([lng, lat]);
  while (trail.length > max) trail.shift();
  return trail;
}

export interface DroneTelemetry {
  /** 主键：无人机 SN */
  sn: string;
  /** WS `DroneStatus` 整包 */
  status: Record<string, unknown> | null;
  /** WS `DroneFlightPath` -> 航线 / 任务 */
  flightPath: Record<string, unknown> | null;
  /** WS `HighFreq` -> 高频位置等 */
  highFreq: Record<string, unknown> | null;
  /** 归一化经纬度 */
  lat: number | null;
  lng: number | null;
  headingDeg: number | null;
  updatedAt: string;
  /** 本地时间戳 ms -> 判断高频是否新鲜 */
  highFreqReceivedAt: number | null;
  /** 本地时间戳 ms -> 最近 DroneStatus */
  statusReceivedAt: number | null;
  /** 本地时间戳 ms -> 任意通道最后包（超时剔除） */
  lastPacketAtMs: number;
  /** 历史轨迹 [lng,lat][] */
  historyTrail: Array<[number, number]>;
  /** 虚兵标记 */
  virtualTroop: boolean;
  /** 地图显示名（来自 entity_status relationships；空字符串回退到 sn） */
  displayName: string;
  /** 起飞阶段标记：首次出现或重新降落后再出现时为 true，退出条件见 updateTakeoffState */
  isTakingOff: boolean;
  /** 降落标记：长时间无数据后设为 true，下次数据视为再次起飞 */
  wasLanded: boolean;
  /** 起飞阶段：最近一次被接受的状态位置时间（用于判断是否退出起飞态） */
  lastStatusAcceptedAt: number | null;
  /** 起飞阶段：最近一次被接受的高频位置时间 */
  lastHighFreqAcceptedAt: number | null;
}

export interface DockTelemetry {
  /** 机场 SN */
  dockSn: string;
  /** `dock_status` 原始字段 */
  payload: Record<string, unknown>;
  /** ISO 时间 -> 最近更新 */
  updatedAt: string;
  /** 地图显示名（来自 entity_status relationships） */
  displayName: string;
}

function isoNow() {
  return new Date().toISOString();
}

function readLatLng(d: Record<string, unknown>): { lat: number; lng: number } | null {
  const lat = Number(d.latitude ?? d.lat);
  const lng = Number(d.longitude ?? d.lng ?? d.lon);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return null;
}

function readHeading(d: Record<string, unknown>): number | null {
  const h = Number(d.heading ?? d.attitude_head ?? d.course ?? d.yaw);
  return Number.isFinite(h) ? h : null;
}

export function readVirtualTroop(d: Record<string, unknown>): boolean {
  return (
    d.virtual_troop === true ||
    d.virtualTroop === true ||
    d.is_virtual === true ||
    d.is_virtual === 1
  );
}

function baseTelemetry(sn: string): DroneTelemetry {
  const t = isoNow();
  const now = Date.now();
  return {
    sn,
    status: null,
    flightPath: null,
    highFreq: null,
    lat: null,
    lng: null,
    headingDeg: null,
    updatedAt: t,
    highFreqReceivedAt: null,
    statusReceivedAt: null,
    lastPacketAtMs: now,
    historyTrail: [],
    virtualTroop: false,
    displayName: "",
    isTakingOff: true,
    wasLanded: false,
    lastStatusAcceptedAt: null,
    lastHighFreqAcceptedAt: null,
  };
}

interface DroneFleetState {
  /** 无人机 SN -> `DroneTelemetry` */
  drones: Record<string, DroneTelemetry>;
  /** 机场 SN -> `DockTelemetry` */
  docks: Record<string, DockTelemetry>;

  /**
   * 机务关系总表：`null` = 未下发或已清空；非 null 时内含 `airports[]`。
   */
  relationships: { airports: RelationshipAirportRow[] } | null;
  /** 无人机 SN -> 所属机场 SN */
  droneToAirport: Record<string, string>;
  /** 机场 SN -> 下属无人机 SN 列表 */
  airportToDrones: Record<string, string[]>;
  /**
   * 实体 ID → 设备 SN 映射。
   * drone_flight_path 用 entityId 标识无人机，但 drone-store 按 deviceSn 索引，
   * 此映射用于在 setDroneFlightPath / setDroneStatus / setHighFreq 中将 entityId 解析为 deviceSn。
   */
  entityIdToDeviceSn: Record<string, string>;

  /** entity_status 门控：第一次成功解析后为 true */
  entityReady: boolean;

  /** `drone_status` 载荷 -> 合并进 `drones[sn].status`（不新增） */
  setDroneStatus: (data: Record<string, unknown>) => void;
  /** `drone_flight_path` 载荷 -> 写入 `drones[sn].flightPath`（不新增） */
  setDroneFlightPath: (data: Record<string, unknown>) => void;
  /** `high_freq` 载荷 -> 合并进 `drones[sn].highFreq`（不新增） */
  setHighFreq: (data: Record<string, unknown>) => void;
  /** `dock_status` 载荷 -> 更新 `docks[dockSn]`（不新增） */
  setDockStatus: (data: Record<string, unknown>) => void;
  /** `entity_status` 消息 -> 解析关系 + 创建/更新无人机和机场 + 提取名称 */
  applyEntityStatusMessage: (msg: Record<string, unknown>) => void;

  /** 清空 `drones`（不清关系缓存） */
  clearDrones: () => void;
  /** 无人机 SN -> 从 `drones` 删除该键 */
  removeDrone: (sn: string) => void;
}

/** `relationships.airports` 原始数组 -> 过滤后的机务缓存 + 映射表 + 名称映射 */
function buildRelationshipCachesFromAirportsRaw(airportsRaw: unknown[]): {
  relationships: { airports: RelationshipAirportRow[] };
  droneToAirport: Record<string, string>;
  airportToDrones: Record<string, string[]>;
  /** entityId → deviceSn（drone_flight_path 用 entityId 查找 deviceSn） */
  entityIdToDeviceSn: Record<string, string>;
  droneNames: Record<string, string>;
  dockNames: Record<string, string>;
} {
  const droneToAirport: Record<string, string> = {};
  const airportToDrones: Record<string, string[]> = {};
  const entityIdToDeviceSn: Record<string, string> = {};
  const droneNames: Record<string, string> = {};
  const dockNames: Record<string, string> = {};
  const filteredAirports: RelationshipAirportRow[] = [];

  for (const raw of airportsRaw) {
    if (!raw || typeof raw !== "object") continue;
    const ap = raw as Record<string, unknown>;
    const dockSn = String(ap.dockSn ?? ap.dock_sn ?? "").trim();
    if (!dockSn || isExcludedAirportDock(dockSn)) continue;

    const rawDrones = Array.isArray(ap.drones) ? ap.drones : [];
    const drones: RelationshipDroneRow[] = [];
    for (const dr of rawDrones) {
      if (!dr || typeof dr !== "object") continue;
      const d = dr as Record<string, unknown>;
      const nm = String(d.name ?? d.droneName ?? d.drone_name ?? "").trim();
      if (isExcludedDroneName(nm)) continue;
      const deviceSn = String(d.deviceSn ?? d.droneSn ?? d.drone_sn ?? "").trim();
      if (!deviceSn) continue;
      // 从 relationships 中提取 entityId（drone_flight_path / drone_status / high_freq 用此标识无人机）
      const eid = String(d.entityId ?? d.entity_id ?? "").trim();
      const dLat = Number(d.latitude);
      const dLng = Number(d.longitude);
      drones.push({
        deviceSn,
        entityId: eid || undefined,
        name: nm || undefined,
        latitude: Number.isFinite(dLat) ? dLat : undefined,
        longitude: Number.isFinite(dLng) ? dLng : undefined,
        virtualTroop: virtualTroopForDroneSn(deviceSn),
      });
      // 提取无人机名称 -> droneNames
      if (nm && deviceSn) {
        droneNames[deviceSn] = nm;
      }
      // 建立 entityId → deviceSn 映射（关键：drone_flight_path 等消息用 entityId 标识无人机）
      if (eid && deviceSn) {
        entityIdToDeviceSn[eid] = deviceSn;
      }
    }

    const lat = Number(ap.latitude);
    const lng = Number(ap.longitude);
    filteredAirports.push({
      dockSn,
      entityId: ap.entityId != null ? String(ap.entityId).trim() || undefined : undefined,
      name: ap.name != null ? String(ap.name) : undefined,
      latitude: Number.isFinite(lat) ? lat : undefined,
      longitude: Number.isFinite(lng) ? lng : undefined,
      drones,
      virtualTroop: virtualTroopForDockSn(dockSn),
    });

    // 机场标注名：取下属无人机名称去掉"无人机"前缀的数字部分，用"、"连接
    // 例如：["无人机1","无人机2"] → ["1","2"] → "机场-1、2"
    // 数字来源：relationships 里 drones[].name 后端的编号，如 "无人机1" 的 "1"
    const segments = drones
      .map((d) => {
        const raw = String(d.name ?? d.deviceSn ?? "").trim();
        if (!raw) return "";
        const stripped = raw.replace(/无人机/g, "").trim();
        return stripped || raw;
      })
      .filter(Boolean);
    dockNames[dockSn] = segments.length > 0 ? `机场-${segments.join("、")}` : "机场";

    airportToDrones[dockSn] = drones.map((x) => x.deviceSn);
    for (const x of drones) {
      droneToAirport[x.deviceSn] = dockSn;
    }
  }

  return {
    relationships: { airports: filteredAirports },
    droneToAirport,
    airportToDrones,
    entityIdToDeviceSn,
    droneNames,
    dockNames,
  };
}

/** 起飞阶段距机场阈值（米）：高频位置距机场 >50m 丢弃（与 V2 DroneRenderer 一致） */
const TAKEOFF_DISTANCE_M = 50;
/** 起飞退出窗口：状态与高频均需在窗口内有过 50m 内有效点才退出起飞态 */
const BOTH_DATA_RECENT_MS = 3000;
/** 高频位置最大有效时间（ms）：超过此时间未更新则改用 status 位置（与 V2 一致） */
const HIGH_FREQ_MAX_AGE_MS = 2500;
/** 降落判定：超过此时长无数据则标记 wasLanded */
const LANDED_NO_DATA_MS = 5000;

/** 获取无人机所属机场坐标（从 relationships 或 docks 缓存查） */
function getDockPositionForDrone(sn: string, state: DroneFleetState): { lng: number; lat: number } | null {
  const dockSn = state.droneToAirport[sn];
  if (!dockSn) return null;
  const dock = state.docks[dockSn];
  if (!dock) {
    /* 从 relationships 查机场坐标 */
    const ap = state.relationships?.airports.find((a) => a.dockSn === dockSn);
    if (ap?.latitude != null && ap?.longitude != null) return { lng: ap.longitude, lat: ap.latitude };
    return null;
  }
  const lng = (dock.payload?.longitude ?? dock.payload?.longitudeDegrees) as number | undefined;
  const lat = (dock.payload?.latitude ?? dock.payload?.latitudeDegrees) as number | undefined;
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) return { lng, lat };
  /* 从 relationships 查 */
  const ap = state.relationships?.airports.find((a) => a.dockSn === dockSn);
  if (ap?.latitude != null && ap?.longitude != null) return { lng: ap.longitude, lat: ap.latitude };
  return null;
}

/** 起飞阶段：判断高频位置是否应丢弃（距机场 >50m） */
function shouldDiscardByTakeoff(
  sn: string,
  lng: number,
  lat: number,
  dataType: "high_freq" | "status",
  state: DroneFleetState,
): boolean {
  const drone = state.drones[sn];
  if (!drone?.isTakingOff) return false;
  const dock = getDockPositionForDrone(sn, state);
  if (!dock) return true; /* 无机场坐标时丢弃高频，避免跳点 */
  const dist = haversineM(dock.lat, dock.lng, lat, lng);
  if (dist <= TAKEOFF_DISTANCE_M) return false;
  if (dataType === "status") return false; /* 状态点不丢弃，用于判断已离场 */
  return true;
}

/** 更新起飞状态：判断是否应退出起飞态 */
function updateTakeoffState(sn: string, currentTime: number, state: DroneFleetState): Partial<DroneTelemetry> {
  const drone = state.drones[sn];
  if (!drone || !drone.isTakingOff) return {};
  /* 条件1：状态位置已超过 50m → 退出起飞 */
  const statusPos = drone.status ? readLatLng(drone.status) : null;
  if (statusPos) {
    const dock = getDockPositionForDrone(sn, state);
    if (dock) {
      const dist = haversineM(dock.lat, dock.lng, statusPos.lat, statusPos.lng);
      if (dist > TAKEOFF_DISTANCE_M) return { isTakingOff: false };
    }
  }
  /* 条件2：状态+高频均近期有过 50m 内有效点 */
  const statusOk = drone.lastStatusAcceptedAt != null && currentTime - drone.lastStatusAcceptedAt <= BOTH_DATA_RECENT_MS;
  const highFreqOk = drone.lastHighFreqAcceptedAt != null && currentTime - drone.lastHighFreqAcceptedAt <= BOTH_DATA_RECENT_MS;
  if (statusOk && highFreqOk) return { isTakingOff: false };
  return {};
}

function mergeCoords(prev: DroneTelemetry, d: Record<string, unknown>): DroneTelemetry {
  const ll = readLatLng(d);
  const hd = readHeading(d);
  const vt = readVirtualTroop(d) || virtualTroopForDroneSn(prev.sn) || prev.virtualTroop;
  return {
    ...prev,
    lat: ll?.lat ?? prev.lat,
    lng: ll?.lng ?? prev.lng,
    headingDeg: hd ?? prev.headingDeg,
    virtualTroop: vt,
    updatedAt: isoNow(),
  };
}

/**
 * 从 WS 载荷中用 entityId 查找 deviceSn。
 *
 * drone_flight_path / drone_status / high_freq 消息仅携带 entityId（如 "uav-xxx"），
 * 而 drone-store 按 deviceSn 索引，因此必须通过 entityIdToDeviceSn 映射表转换。
 * 映射表由 entity_status 的 relationships.airports[].drones[] 构建。
 */
export function resolveDroneSn(data: Record<string, unknown>): string | null {
  /* 优先通过 entityId → deviceSn 映射表解析（drone_flight_path / high_freq 使用） */
  const eid = String(data.entityId ?? data.entity_id ?? "").trim();
  if (eid) {
    const mapped = useDroneStore.getState().entityIdToDeviceSn[eid];
    if (mapped) return mapped;
    /* entityId 本身可能就是 deviceSn（直接索引） */
    if (useDroneStore.getState().drones[eid]) return eid;
  }
  /* drone_status 可能直接携带 deviceSn / sn 字段 */
  const directSn = String(data.deviceSn ?? data.drone_sn ?? data.sn ?? data.device_sn ?? data.droneSn ?? "").trim();
  if (directSn && useDroneStore.getState().drones[directSn]) return directSn;
  /* 嵌套 drone 对象 */
  const drone = data.drone ?? data.uav;
  if (drone && typeof drone === "object") {
    const d = drone as Record<string, unknown>;
    const nestedEid = String(d.entityId ?? d.entity_id ?? "").trim();
    if (nestedEid) {
      const mapped = useDroneStore.getState().entityIdToDeviceSn[nestedEid];
      if (mapped) return mapped;
      if (useDroneStore.getState().drones[nestedEid]) return nestedEid;
    }
    const nestedSn = String(d.deviceSn ?? d.drone_sn ?? d.sn ?? d.device_sn ?? "").trim();
    if (nestedSn && useDroneStore.getState().drones[nestedSn]) return nestedSn;
  }
  return null;
}

export const useDroneStore = create<DroneFleetState>((set, get) => ({
  drones: {},
  docks: {},
  relationships: null,
  droneToAirport: {},
  airportToDrones: {},
  entityIdToDeviceSn: {},
  entityReady: false,

  /** entity_status -> 解析关系 + 创建/更新无人机和机场 + 提取名称（唯一新增入口） */
  applyEntityStatusMessage: (msg) => {
    const airportsRaw = parseRelationshipsAirportsFromWsMessage(msg);
    if (airportsRaw == null) {
      set({ relationships: null, droneToAirport: {}, airportToDrones: {}, entityIdToDeviceSn: {} });
      return;
    }

    const built = buildRelationshipCachesFromAirportsRaw(airportsRaw);
    const { droneNames, dockNames } = built;

    set((s) => {
      // 创建/更新无人机：遍历 droneNames，对每个 SN 确保 drones 中存在
      const newDrones = { ...s.drones };
      for (const [sn, name] of Object.entries(droneNames)) {
        if (newDrones[sn]) {
          // 已存在 -> 更新 displayName
          if (newDrones[sn].displayName !== name) {
            newDrones[sn] = { ...newDrones[sn], displayName: name };
          }
        } else {
          // 不存在 -> 创建（entity_status 是唯一创建入口）
          newDrones[sn] = { ...baseTelemetry(sn), displayName: name };
        }
      }
      // 创建/更新机场：遍历 dockNames，对每个 dockSn 确保 docks 中存在
      const newDocks = { ...s.docks };
      for (const [dockSn, name] of Object.entries(dockNames)) {
        if (newDocks[dockSn]) {
          // 已存在 -> 更新 displayName
          if (newDocks[dockSn].displayName !== name) {
            newDocks[dockSn] = { ...newDocks[dockSn], displayName: name };
          }
        } else {
          // 不存在 -> 创建
          newDocks[dockSn] = {
            dockSn,
            payload: {},
            updatedAt: isoNow(),
            displayName: name,
          };
        }
      }

      return {
        relationships: built.relationships,
        droneToAirport: built.droneToAirport,
        airportToDrones: built.airportToDrones,
        entityIdToDeviceSn: built.entityIdToDeviceSn,
        drones: newDrones,
        docks: newDocks,
        entityReady: true,
      };
    });
  },

  removeDrone: (sn) =>
    set((s) => {
      if (!sn || !s.drones[sn]) return s;
      const next = { ...s.drones };
      delete next[sn];
      return { drones: next };
    }),

  setDroneStatus: (data) => {
    const sn = resolveDroneSn(data);
    if (!sn) return;
    const s = get();
    if (!(sn in s.drones)) return;
    const ts = Date.now();
    /* 起飞阶段：状态点不丢弃，但记录是否被接受 */
    const posStatus = readLatLng(data);
    const discardStatus = posStatus && shouldDiscardByTakeoff(sn, posStatus.lng, posStatus.lat, "status", s);
    const statusAcceptedAt = posStatus && !discardStatus ? ts : s.drones[sn].lastStatusAcceptedAt;
    /* wasLanded → isTakingOff */
    const wasLanded = s.drones[sn].wasLanded;
    set((s) => {
      const prev = s.drones[sn];
      if (!prev) return s;
      const base = {
        ...prev,
        status: discardStatus ? prev.status : { ...data },
        updatedAt: isoNow(),
        statusReceivedAt: ts,
        lastPacketAtMs: ts,
        lastStatusAcceptedAt: statusAcceptedAt,
        wasLanded: false,
        isTakingOff: wasLanded ? true : prev.isTakingOff,
      };
      /* 高频陈旧检测：高频超过 2.5s 未更新时，status 位置优先 */
      const highFreqAge = prev.highFreqReceivedAt ? ts - prev.highFreqReceivedAt : Infinity;
      const useHighFreq = highFreqAge <= HIGH_FREQ_MAX_AGE_MS && prev.highFreq;
      if (!useHighFreq) {
        /* 高频陈旧，status 位置直接覆盖 */
        let next = mergeCoords(base, data);
        if (next.lat != null && next.lng != null) {
          next = { ...next, historyTrail: appendHistoryTrail(prev, next.lat, next.lng) };
        }
        const takeoffUpdate = updateTakeoffState(sn, ts, s);
        return { drones: { ...s.drones, [sn]: { ...next, ...takeoffUpdate } } };
      }
      /* 高频仍新鲜，保留高频位置，仅更新 heading 等 */
      const hd = readHeading(data);
      let next = { ...base, headingDeg: hd ?? base.headingDeg };
      if (posStatus && !discardStatus) {
        next = { ...next, historyTrail: appendHistoryTrail(prev, posStatus.lat, posStatus.lng) };
      }
      const takeoffUpdate = updateTakeoffState(sn, ts, s);
      return { drones: { ...s.drones, [sn]: { ...next, ...takeoffUpdate } } };
    });
  },

  setDroneFlightPath: (data) => {
    const sn = resolveDroneSn(data);
    if (!sn) return;
    const s = get();
    if (!(sn in s.drones)) return;
    const ts = Date.now();
    /* 与 V2 DroneRenderer.updateDroneTask 一致：
     * executionState=1 表示任务已完成，此时清空 flightPath（规划航线），
     * 避免任务结束后旧航线残留。虚兵额外清空历史轨迹。 */
    const execState = data.executionState ?? data.execution_state;
    const isComplete = execState === 1 || execState === "1" || execState === "completed";
    const isVt = s.drones[sn]?.virtualTroop;
    if (isComplete) {
      set((s) => {
        const prev = s.drones[sn];
        if (!prev) return s;
        const next: DroneTelemetry = {
          ...prev,
          flightPath: null,
          updatedAt: isoNow(),
          lastPacketAtMs: ts,
          ...(isVt ? { historyTrail: [] } : {}),
        };
        return { drones: { ...s.drones, [sn]: next } };
      });
      return;
    }
    set((s) => {
      const prev = s.drones[sn];
      if (!prev) return s;
      const next = mergeCoords(
        {
          ...prev,
          flightPath: { ...data },
          updatedAt: isoNow(),
          statusReceivedAt: prev.statusReceivedAt,
          lastPacketAtMs: ts,
        },
        data,
      );
      return { drones: { ...s.drones, [sn]: next } };
    });
  },

  setHighFreq: (data) => {
    const sn = resolveDroneSn(data);
    if (!sn) return;
    const s = get();
    if (!(sn in s.drones)) return;
    const ts = Date.now();
    /* 起飞阶段：高频位置距机场 >50m 丢弃 */
    const posHighFreq = readLatLng(data);
    const discardHighFreq = posHighFreq && shouldDiscardByTakeoff(sn, posHighFreq.lng, posHighFreq.lat, "high_freq", s);
    const highFreqAcceptedAt = posHighFreq && !discardHighFreq ? ts : s.drones[sn].lastHighFreqAcceptedAt;
    /* wasLanded → isTakingOff */
    const wasLanded = s.drones[sn].wasLanded;
    if (discardHighFreq) {
      /* 仅更新 highFreq 原始数据和时间戳，不更新位置 */
      set((s) => {
        const prev = s.drones[sn];
        if (!prev) return s;
        const takeoffUpdate = updateTakeoffState(sn, ts, s);
        return {
          drones: {
            ...s.drones,
            [sn]: {
              ...prev,
              ...takeoffUpdate,
              lastHighFreqAcceptedAt: highFreqAcceptedAt,
              wasLanded: false,
              isTakingOff: wasLanded ? true : prev.isTakingOff,
              lastPacketAtMs: ts,
            },
          },
        };
      });
      return;
    }
    set((s) => {
      const prev = s.drones[sn];
      if (!prev) return s;
      let next = mergeCoords(
        {
          ...prev,
          highFreq: { ...data },
          updatedAt: isoNow(),
          highFreqReceivedAt: ts,
          lastPacketAtMs: ts,
          lastHighFreqAcceptedAt: highFreqAcceptedAt,
          wasLanded: false,
          isTakingOff: wasLanded ? true : prev.isTakingOff,
        },
        data,
      );
      if (next.lat != null && next.lng != null) {
        next = { ...next, historyTrail: appendHistoryTrail(prev, next.lat, next.lng) };
      }
      const takeoffUpdate = updateTakeoffState(sn, ts, s);
      return { drones: { ...s.drones, [sn]: { ...next, ...takeoffUpdate } } };
    });
  },

  setDockStatus: (data) => {
    const dockSn = String(data.dock_sn ?? data.sn ?? "").trim();
    if (!dockSn) return;
    const s = get();
    if (!(dockSn in s.docks)) return;
    const tss = isoNow();
    set((s) => {
      const prev = s.docks[dockSn];
      return {
        docks: {
          ...s.docks,
          [dockSn]: {
            dockSn,
            payload: { ...data },
            updatedAt: tss,
            displayName: prev?.displayName ?? "",
          },
        },
      };
    });
  },

  clearDrones: () => set({ drones: {} }),
}));

/* ── 降落超时检测（与 V2 DroneRenderer.checkTimeout 一致）── */
const DRONE_TIMEOUT_MS = 30_000;
let timeoutCheckTimer: ReturnType<typeof setInterval> | null = null;

function startTimeoutCheck() {
  if (timeoutCheckTimer) return;
  timeoutCheckTimer = setInterval(() => {
    const s = useDroneStore.getState();
    const now = Date.now();
    let changed = false;
    const next = { ...s.drones };
    for (const [sn, d] of Object.entries(next)) {
      const noDataMs = now - d.lastPacketAtMs;
      if (noDataMs > LANDED_NO_DATA_MS && !d.wasLanded) {
        next[sn] = { ...d, wasLanded: true };
        changed = true;
      }
      if (noDataMs > DRONE_TIMEOUT_MS) {
        delete next[sn];
        changed = true;
      }
    }
    if (changed) useDroneStore.setState({ drones: next });
  }, 2000);
}

startTimeoutCheck();
