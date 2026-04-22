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
function resolveDroneSn(data: Record<string, unknown>): string | null {
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
    set((s) => {
      const prev = s.drones[sn];
      if (!prev) return s;
      let next = mergeCoords(
        {
          ...prev,
          status: { ...data },
          updatedAt: isoNow(),
          statusReceivedAt: ts,
          lastPacketAtMs: ts,
        },
        data,
      );
      if (next.lat != null && next.lng != null) {
        next = { ...next, historyTrail: appendHistoryTrail(prev, next.lat, next.lng) };
      }
      return { drones: { ...s.drones, [sn]: next } };
    });
  },

  setDroneFlightPath: (data) => {
    const sn = resolveDroneSn(data);
    if (!sn) return;
    const s = get();
    if (!(sn in s.drones)) return;
    const ts = Date.now();
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
        },
        data,
      );
      if (next.lat != null && next.lng != null) {
        next = { ...next, historyTrail: appendHistoryTrail(prev, next.lat, next.lng) };
      }
      return { drones: { ...s.drones, [sn]: next } };
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
