import { create } from "zustand";
import { getDroneMapRenderingConfig } from "@/lib/map-app-config";

/**
 * 无人机 / 机场实时态（对齐 V2 `App.vue` WebSocket：`DroneStatus`、`DroneFlightPath`、`HighFreq`、`DockStatus`、`Drone`/`DroneData`、`ClearDrones`）。
 * 数据仅由 `useUnifiedWsFeed` 写入，不做 HTTP 轮询。
 */

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
  /** 设备序列号或业务主键 */
  sn: string;
  /** `DroneStatus` 最新整包 */
  status: Record<string, unknown> | null;
  /** `DroneFlightPath` 航线 / 任务 */
  flightPath: Record<string, unknown> | null;
  /** `HighFreq` 高频位置等 */
  highFreq: Record<string, unknown> | null;
  /** `Drone` / `DroneData` 兼容通道原始包 */
  legacy: Record<string, unknown> | null;
  /** 便于地图 / 列表绑定的归一化坐标（由各通道合并） */
  lat: number | null;
  lng: number | null;
  headingDeg: number | null;
  updatedAt: string;
  /** 收到 `HighFreq` 的本地时间戳（ms），供地图与 V2 一致判断高频新鲜度 */
  highFreqReceivedAt: number | null;
  /** 收到 `DroneStatus` 的本地时间戳（ms） */
  statusReceivedAt: number | null;
  /** 任意通道最后一次写入的本地时间戳（ms），供超时剔除 */
  lastPacketAtMs: number;
  /** 历史轨迹点 [lng,lat][]，长度受 `droneMapRendering.maxHistoryPoints` 约束 */
  historyTrail: Array<[number, number]>;
  /** 虚兵：航线/历史线为虚线，地图符号走虚线框图标 */
  virtualTroop: boolean;
}

export interface DockTelemetry {
  dockSn: string;
  payload: Record<string, unknown>;
  updatedAt: string;
}

function isoNow() {
  return new Date().toISOString();
}

function readSnFromDronePayload(d: Record<string, unknown>): string {
  return String(
    d.drone_sn ?? d.droneSn ?? d.entityId ?? d.id ?? d.topic ?? d.drone_id ?? "",
  ).trim();
}

/** 与 V2 `DroneDataProcessor` 取 id 顺序一致 */
function legacyDroneSn(raw: Record<string, unknown>): string {
  return String(raw.topic ?? raw.id ?? raw.drone_id ?? raw.drone_sn ?? "").trim();
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

function readVirtualTroop(d: Record<string, unknown>): boolean {
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
    legacy: null,
    lat: null,
    lng: null,
    headingDeg: null,
    updatedAt: t,
    highFreqReceivedAt: null,
    statusReceivedAt: null,
    lastPacketAtMs: now,
    historyTrail: [],
    virtualTroop: false,
  };
}

interface DroneFleetState {
  /** 以 `drone_sn` / `entityId` 等为键的无人机快照 */
  drones: Record<string, DroneTelemetry>;
  /** 以 `dock_sn`（GATEWAY_SN）为键的机场状态 */
  docks: Record<string, DockTelemetry>;

  setDroneStatus: (data: Record<string, unknown>) => void;
  setDroneFlightPath: (data: Record<string, unknown>) => void;
  setHighFreq: (data: Record<string, unknown>) => void;
  /** `Drone` / `DroneData` 与 V2 `processDroneData` 同思路的简化合并（不做 turf 距离节流） */
  setLegacyDrone: (raw: Record<string, unknown>) => void;
  setDockStatus: (data: Record<string, unknown>) => void;
  /** 对应 V2 `ClearDrones` */
  clearDrones: () => void;
  /** 移除单机（超时或业务清屏） */
  removeDrone: (sn: string) => void;
}

function mergeCoords(prev: DroneTelemetry, d: Record<string, unknown>): DroneTelemetry {
  const ll = readLatLng(d);
  const hd = readHeading(d);
  const vt = readVirtualTroop(d) ? true : prev.virtualTroop;
  return {
    ...prev,
    lat: ll?.lat ?? prev.lat,
    lng: ll?.lng ?? prev.lng,
    headingDeg: hd ?? prev.headingDeg,
    virtualTroop: vt,
    updatedAt: isoNow(),
  };
}

export const useDroneStore = create<DroneFleetState>((set) => ({
  drones: {},
  docks: {},

  removeDrone: (sn) =>
    set((s) => {
      if (!sn || !s.drones[sn]) return s;
      const next = { ...s.drones };
      delete next[sn];
      return { drones: next };
    }),

  setDroneStatus: (data) => {
    const sn = readSnFromDronePayload(data);
    if (!sn) return;
    const ts = Date.now();
    set((s) => {
      const prev = s.drones[sn] ?? baseTelemetry(sn);
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
    const sn = readSnFromDronePayload(data);
    if (!sn) return;
    const ts = Date.now();
    set((s) => {
      const prev = s.drones[sn] ?? baseTelemetry(sn);
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
    const sn = readSnFromDronePayload(data);
    if (!sn) return;
    const ts = Date.now();
    set((s) => {
      const prev = s.drones[sn] ?? baseTelemetry(sn);
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

  setLegacyDrone: (raw) => {
    const sn = legacyDroneSn(raw);
    if (!sn) return;
    const ts = Date.now();
    set((s) => {
      const prev = s.drones[sn] ?? baseTelemetry(sn);
      let next = mergeCoords(
        {
          ...prev,
          legacy: { ...raw },
          updatedAt: isoNow(),
          highFreqReceivedAt: prev.highFreqReceivedAt,
          statusReceivedAt: prev.statusReceivedAt,
          lastPacketAtMs: ts,
        },
        raw,
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
    const tss = isoNow();
    set((s) => ({
      docks: {
        ...s.docks,
        [dockSn]: { dockSn, payload: { ...data }, updatedAt: tss },
      },
    }));
  },

  clearDrones: () => set({ drones: {} }),
}));
