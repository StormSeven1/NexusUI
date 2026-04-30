"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IClientOptions, MqttClient } from "mqtt";
/** 浏览器包为 mqtt.esm.js：仅 default，无命名 export connect（Turbopack 会静态报错） */
import mqttImport from "mqtt";

/** 从 default 上取 connect（兼容 __esModule / 嵌套 default） */
function resolveMqttConnect(): (url: string, opts?: IClientOptions) => MqttClient {
  const m = mqttImport as unknown as {
    connect?: (url: string, opts?: IClientOptions) => MqttClient;
    default?: { connect?: (url: string, opts?: IClientOptions) => MqttClient } | ((url: string, opts?: IClientOptions) => MqttClient);
  };
  if (typeof m.connect === "function") return m.connect;
  const d = m.default;
  if (d && typeof d === "object" && "connect" in d && typeof (d as { connect: unknown }).connect === "function") {
    return (d as { connect: (url: string, opts?: IClientOptions) => MqttClient }).connect;
  }
  if (typeof d === "function") return d as (url: string, opts?: IClientOptions) => MqttClient;
  throw new Error("mqtt.connect 不可用（mqtt 浏览器包缺少 connect）");
}

const mqttConnect = resolveMqttConnect();

function parseJsonLoose(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** 在 DJI 云 JSON 中递归查找 `drone_in_dock`（兼容 data 为对象/字符串、字段嵌套） */
function extractDroneInDock(root: unknown, depth = 0): boolean | null {
  if (depth > 14 || root == null) return null;
  if (typeof root === "string") {
    const inner = parseJsonLoose(root);
    return inner == null ? null : extractDroneInDock(inner, depth + 1);
  }
  if (typeof root !== "object") return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const v = extractDroneInDock(item, depth + 1);
      if (v !== null) return v;
    }
    return null;
  }
  const o = root as Record<string, unknown>;
  if ("drone_in_dock" in o) {
    const v = o.drone_in_dock;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const t = v.trim().toLowerCase();
      if (t === "1" || t === "true" || t === "yes") return true;
      if (t === "0" || t === "false" || t === "no" || t === "") return false;
      const n = Number(v);
      if (Number.isFinite(n)) return n !== 0;
    }
    return Boolean(v);
  }
  if ("data" in o) {
    const d = o.data;
    if (typeof d === "string") {
      const inner = parseJsonLoose(d);
      if (inner != null) {
        const v = extractDroneInDock(inner, depth + 1);
        if (v !== null) return v;
      }
    } else {
      const v = extractDroneInDock(d, depth + 1);
      if (v !== null) return v;
    }
  }
  for (const v of Object.values(o)) {
    if (v != null && (typeof v === "object" || typeof v === "string")) {
      const hit = extractDroneInDock(v, depth + 1);
      if (hit !== null) return hit;
    }
  }
  return null;
}

/**
 * 从 DJI 物模型 JSON 中解析机场经纬（与 customconfig ParseAirportMsgFromDJI 中 data.latitude / data.longitude 一致）。
 * 优先进入 `data` 再递归，避免误用无关字段；并做粗略经纬范围校验。
 */
function extractAirportLatLon(root: unknown, depth = 0): { latitude: number; longitude: number } | null {
  if (depth > 14 || root == null) return null;
  if (typeof root === "string") {
    const inner = parseJsonLoose(root);
    return inner == null ? null : extractAirportLatLon(inner, depth + 1);
  }
  if (typeof root !== "object") return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const v = extractAirportLatLon(item, depth + 1);
      if (v) return v;
    }
    return null;
  }
  const o = root as Record<string, unknown>;
  if ("data" in o) {
    const d = o.data;
    if (typeof d === "string") {
      const inner = parseJsonLoose(d);
      const v = inner != null ? extractAirportLatLon(inner, depth + 1) : null;
      if (v) return v;
    } else {
      const v = extractAirportLatLon(d, depth + 1);
      if (v) return v;
    }
  }
  const latRaw = o.latitude;
  const lonRaw = o.longitude;
  const lat = typeof latRaw === "number" ? latRaw : typeof latRaw === "string" ? Number(latRaw) : NaN;
  const lon = typeof lonRaw === "number" ? lonRaw : typeof lonRaw === "string" ? Number(lonRaw) : NaN;
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    return { latitude: lat, longitude: lon };
  }
  for (const [k, v] of Object.entries(o)) {
    if (k === "data") continue;
    if (v != null && (typeof v === "object" || typeof v === "string")) {
      const hit = extractAirportLatLon(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** 与 C++ DroneInformation / AirportInformation 对应的遥测字段 */
export interface UavMqttTelemetry {
  /** 飞行器电池电量 %（离舱时来自飞行器，在舱时来自机场充电状态） */
  batteryPercent: number | null;
  /** 机场充电状态电量 %（在舱时优先使用） */
  airportDroneChargePercent: number | null;
  /** 剩余飞行时间（秒） */
  remainFlightTimeSec: number | null;
  /** 距返航点距离（米） */
  homeDistanceM: number | null;
  /** 航向角（度，正北=0，顺时针） */
  attitudeHeadDeg: number | null;
  /** 相对起飞点高度（米） */
  elevationM: number | null;
  /** 海拔绝对高度（米） */
  heightM: number | null;
  /** 垂直速度（m/s，上升正） */
  verticalSpeedMps: number | null;
  /** 水平速度（m/s） */
  horizontalSpeedMps: number | null;
  /** 飞行器测得风速（m/s） */
  droneWindSpeedMps: number | null;
  /** 机场测得风速（m/s） */
  airportWindSpeedMps: number | null;
  /** 降雨量（0=无雨） */
  rainfall: number | null;
  /** 机场任务状态（flighttask_step_code） */
  airportFlightTaskStepCode: number | null;
  /** 机场调试状态（mode_code） */
  airportModeCode: number | null;
}

const TELEMETRY_INITIAL: UavMqttTelemetry = {
  batteryPercent: null,
  airportDroneChargePercent: null,
  remainFlightTimeSec: null,
  homeDistanceM: null,
  attitudeHeadDeg: null,
  elevationM: null,
  heightM: null,
  verticalSpeedMps: null,
  horizontalSpeedMps: null,
  droneWindSpeedMps: null,
  airportWindSpeedMps: null,
  rainfall: null,
  airportFlightTaskStepCode: null,
  airportModeCode: null,
};

/** 从 data 层解析无人机 OSD 遥测（对应 ParseDroneMsgFromDJI） */
function extractDroneTelemetry(root: unknown): Partial<UavMqttTelemetry> | null {
  if (root == null || typeof root !== "object" || Array.isArray(root)) return null;
  const o = root as Record<string, unknown>;
  let data: Record<string, unknown> | null = null;
  if ("data" in o && o.data != null) {
    if (typeof o.data === "string") {
      const inner = parseJsonLoose(o.data);
      if (inner != null && typeof inner === "object" && !Array.isArray(inner)) {
        data = inner as Record<string, unknown>;
      }
    } else if (typeof o.data === "object" && !Array.isArray(o.data)) {
      data = o.data as Record<string, unknown>;
    }
  }
  if (data == null) return null;
  const getNum = (key: string): number | null => {
    const v = data![key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : null; }
    return null;
  };
  let batteryPercent: number | null = null;
  let remainFlightTimeSec: number | null = null;
  if ("battery" in data && data.battery != null && typeof data.battery === "object" && !Array.isArray(data.battery)) {
    const bat = data.battery as Record<string, unknown>;
    const cp = bat.capacity_percent;
    if (typeof cp === "number" && Number.isFinite(cp)) batteryPercent = cp;
    else if (typeof cp === "string") { const n = Number(cp); if (Number.isFinite(n)) batteryPercent = n; }
    const rft = bat.remain_flight_time;
    if (typeof rft === "number" && Number.isFinite(rft)) remainFlightTimeSec = rft;
    else if (typeof rft === "string") { const n = Number(rft); if (Number.isFinite(n)) remainFlightTimeSec = n; }
  }
  const result: Partial<UavMqttTelemetry> = {
    batteryPercent,
    remainFlightTimeSec,
    homeDistanceM: getNum("home_distance"),
    attitudeHeadDeg: getNum("attitude_head"),
    elevationM: getNum("elevation"),
    heightM: getNum("height"),
    verticalSpeedMps: getNum("vertical_speed"),
    horizontalSpeedMps: getNum("horizontal_speed"),
    droneWindSpeedMps: getNum("wind_speed"),
  };
  // 至少一个有效值才返回
  return Object.values(result).some((v) => v !== null) ? result : null;
}

/** 从 data 层解析机场遥测（对应 ParseAirportMsgFromDJI） */
function extractAirportTelemetry(
  root: unknown,
): Pick<UavMqttTelemetry, "airportWindSpeedMps" | "rainfall" | "airportDroneChargePercent" | "airportFlightTaskStepCode" | "airportModeCode"> | null {
  if (root == null || typeof root !== "object" || Array.isArray(root)) return null;
  const o = root as Record<string, unknown>;
  let data: Record<string, unknown> | null = null;
  if ("data" in o && o.data != null) {
    if (typeof o.data === "string") {
      const inner = parseJsonLoose(o.data);
      if (inner != null && typeof inner === "object" && !Array.isArray(inner)) {
        data = inner as Record<string, unknown>;
      }
    } else if (typeof o.data === "object" && !Array.isArray(o.data)) {
      data = o.data as Record<string, unknown>;
    }
  }
  if (data == null) return null;
  const ws = data.wind_speed;
  const airportWindSpeedMps = typeof ws === "number" && Number.isFinite(ws) ? ws
    : typeof ws === "string" ? (Number.isFinite(Number(ws)) ? Number(ws) : null) : null;
  const rf = data.rainfall;
  const rainfall = typeof rf === "number" && Number.isFinite(rf) ? rf
    : typeof rf === "string" ? (Number.isFinite(Number(rf)) ? Number(rf) : null) : null;
  // 在舱充电状态（data.drone_charge_state.capacity_percent）
  let airportDroneChargePercent: number | null = null;
  if ("drone_charge_state" in data && data.drone_charge_state != null && typeof data.drone_charge_state === "object" && !Array.isArray(data.drone_charge_state)) {
    const dcs = data.drone_charge_state as Record<string, unknown>;
    const cp = dcs.capacity_percent;
    if (typeof cp === "number" && Number.isFinite(cp)) airportDroneChargePercent = cp;
    else if (typeof cp === "string") { const n = Number(cp); if (Number.isFinite(n)) airportDroneChargePercent = n; }
  }
  const fts = data.flighttask_step_code;
  const airportFlightTaskStepCode =
    typeof fts === "number" && Number.isFinite(fts) ? Math.trunc(fts)
    : typeof fts === "string" && Number.isFinite(Number(fts)) ? Math.trunc(Number(fts)) : null;
  const mc = data.mode_code;
  const airportModeCode =
    typeof mc === "number" && Number.isFinite(mc) ? Math.trunc(mc)
    : typeof mc === "string" && Number.isFinite(Number(mc)) ? Math.trunc(Number(mc)) : null;
  if (
    airportWindSpeedMps === null &&
    rainfall === null &&
    airportDroneChargePercent === null &&
    airportFlightTaskStepCode === null &&
    airportModeCode === null
  ) {
    return null;
  }
  return { airportWindSpeedMps, rainfall, airportDroneChargePercent, airportFlightTaskStepCode, airportModeCode };
}

export interface UseUavMqttDockStateOpts {
  /** 机场 / 机巢 product SN（thing/product/{sn}/state|osd） */
  airportSN: string | null;
  /** 机体 product SN，与 WatchSys mqttworker 一致同时订阅，避免舱状态只出现在某一侧 topic */
  deviceSN?: string | null;
  enabled: boolean;
  /** 例如 ws://192.168.18.141:8083/mqtt */
  wsUrl: string | null;
  /** 私有云登录返回的 MQTT 鉴权（可选） */
  mqttUsername?: string | null;
  mqttPassword?: string | null;
}

const MQTT_HUD_INITIAL = {
  connected: false,
  /** 当前已订阅 topic，竖线分隔 */
  topicsLine: "",
  /** 连接前根据 SN 计算出的计划 topic（不受 import/连接失败清空） */
  plannedTopicsLine: "",
  rxCount: 0,
  lastTopic: null as string | null,
  /** 单行截断后的原始载荷，便于对照 DJI 报文 */
  lastPayloadLine: null as string | null,
  /** 连接 / 订阅 / 动态加载 mqtt 包失败原因 */
  lastError: null as string | null,
  /** 实际用于 mqtt.connect 的地址（含 https 下 ws→wss） */
  connectUrl: null as string | null,
};

export type UavMqttHud = typeof MQTT_HUD_INITIAL;

/** 供界面展示「计划订阅」与 MQTT topic 构建（与 hook 内逻辑一致） */
export function buildDjiProductTopics(airportSN: string | null | undefined, deviceSN: string | null | undefined): string[] {
  const topics: string[] = [];
  const seen = new Set<string>();
  const addSn = (sn: string | null | undefined) => {
    const s = (sn ?? "").trim();
    if (!s) return;
    for (const suf of ["/state", "/osd"] as const) {
      const t = `thing/product/${s}${suf}`;
      if (seen.has(t)) continue;
      seen.add(t);
      topics.push(t);
    }
  };
  addSn(airportSN);
  addSn(deviceSN);
  return topics;
}

/** https 页面下不再把 MQTT 的 `ws://` 自动改成 `wss://`：
 *  现场 broker（如 8083）多为明文 WebSocket，`wss` 会因无 TLS 报 ERR_SSL_PROTOCOL_ERROR。
 *  若必须使用 https 前端：请让 broker 提供真实 WSS，并在 .env.local 配置 `NEXT_PUBLIC_MQTT_WS_URL=wss://...`；
 *  或改用 `npm run dev`（不加 --experimental-https）用 http:// 打开前端，可同时避免态势 WS「混合内容」被拦。
 */
export function normalizeMqttWsUrlForBrowserPage(wsUrl: string): string {
  return wsUrl.trim();
}

/**
 * 订阅 DJI 云 thing/product/{机场或机体 SN}/state|osd（与 WatchSys mqttworker 订阅范围对齐），
 * 从报文递归解析 `drone_in_dock`（与 ParseAirportMsgFromDJI 中 data.drone_in_dock 语义一致）。
 * 未连接或报文无该字段时 droneInDock 为 null。
 * 同时从报文解析 `data.latitude` / `data.longitude`（与机场 MQTT 缓存一致），供起飞 takeoffTarget 使用。
 * 同一连接可 `publishStickControl` 下发 drc/down（stick_control），与桌面 MQTT 直连一致。
 */
/** 与 C++ mainwindow.cpp stick_control / `/api/uav-control/stick` 载荷一致 */
export interface UavStickControlPayload {
  roll: number;
  pitch: number;
  throttle: number;
  yaw: number;
  seq: number;
}

export function useUavMqttDockState(opts: UseUavMqttDockStateOpts): {
  droneInDock: boolean | null;
  /** 最近一次 MQTT 帧中解析到的机场经纬；无则 null（起飞前应等待） */
  mqttAirportLatLon: { latitude: number; longitude: number } | null;
  /** 从 MQTT 实时解析的飞行器/机场遥测数据 */
  mqttTelemetry: UavMqttTelemetry;
  mqttConnected: boolean;
  /** 界面底部展示：连接、订阅、最近一帧、舱状态解析 */
  mqttHud: UavMqttHud;
  /**
   * 经同一 WS MQTT 连接下发 `thing/product/{机场SN}/drc/down`（stick_control），与桌面直连一致。
   * 未连接或缺少 SN 时返回 false，便于调用方回退 HTTP。
   */
  publishStickControl: (payload: UavStickControlPayload) => boolean;
} {
  const [droneInDock, setDroneInDock] = useState<boolean | null>(null);
  const [mqttAirportLatLon, setMqttAirportLatLon] = useState<{ latitude: number; longitude: number } | null>(null);
  const [mqttTelemetry, setMqttTelemetry] = useState<UavMqttTelemetry>(TELEMETRY_INITIAL);
  const [mqttConnected, setMqttConnected] = useState(false);
  const [mqttHud, setMqttHud] = useState<UavMqttHud>(MQTT_HUD_INITIAL);
  const mqttClientRef = useRef<MqttClient | null>(null);

  const publishStickControl = useCallback((payload: UavStickControlPayload) => {
    const sn = (opts.airportSN ?? "").trim();
    const c = mqttClientRef.current;
    if (!sn || !c?.connected) return false;
    const topic = `thing/product/${sn}/drc/down`;
    const body = JSON.stringify({
      method: "stick_control",
      data: {
        roll: payload.roll,
        pitch: payload.pitch,
        throttle: payload.throttle,
        yaw: payload.yaw,
        seq: payload.seq,
      },
    });
    try {
      c.publish(topic, body, { qos: 0 });
      return true;
    } catch {
      return false;
    }
  }, [opts.airportSN]);

  useEffect(() => {
    const topics = buildDjiProductTopics(opts.airportSN, opts.deviceSN ?? null);
    const planned = topics.join(" | ");
    if (!opts.enabled || topics.length === 0 || !opts.wsUrl?.trim()) {
      mqttClientRef.current = null;
      setDroneInDock(null);
      setMqttAirportLatLon(null);
      setMqttTelemetry(TELEMETRY_INITIAL);
      setMqttConnected(false);
      setMqttHud({
        ...MQTT_HUD_INITIAL,
        plannedTopicsLine: planned,
        topicsLine: planned,
        lastError:
          !opts.wsUrl?.trim()
            ? "无 WebSocket 地址"
            : topics.length === 0
              ? "缺少机场或机体 SN，无法订阅"
              : !opts.enabled
                ? "未启用（非无人机流或未就绪）"
                : null,
      });
      return;
    }

    const url = normalizeMqttWsUrlForBrowserPage(opts.wsUrl.trim());
    let cancelled = false;
    let client: MqttClient | null = null;
    setDroneInDock(null);
    setMqttAirportLatLon(null);
    setMqttTelemetry(TELEMETRY_INITIAL);
    setMqttHud({
      ...MQTT_HUD_INITIAL,
      plannedTopicsLine: planned,
      topicsLine: planned,
      connectUrl: url,
      lastError: null,
    });

    try {
      const user = (opts.mqttUsername ?? "").trim();
      const pass = (opts.mqttPassword ?? "").trim();
      mqttClientRef.current = null;
      client = mqttConnect(url, {
        protocolVersion: 4,
        reconnectPeriod: 4000,
        connectTimeout: 20_000,
        clean: true,
        clientId: `nexus-eo-${Math.random().toString(16).slice(2, 10)}`,
        ...(user ? { username: user, password: pass } : {}),
      });
      client.on("connect", () => {
        if (cancelled) return;
        mqttClientRef.current = client;
        setMqttConnected(true);
        setMqttHud((h) => ({
          ...h,
          connected: true,
          topicsLine: topics.join(" | "),
          lastError: null,
        }));
        client?.subscribe(topics, { qos: 0 }, (err) => {
          if (err != null && !cancelled) {
            const m = err instanceof Error ? err.message : String(err);
            setMqttHud((h) => ({ ...h, lastError: `subscribe: ${m}` }));
          }
        });
      });
      client.on("reconnect", () => {
        if (!cancelled) setMqttConnected(true);
      });
      client.on("close", () => {
        mqttClientRef.current = null;
        if (!cancelled) {
          setMqttConnected(false);
          setMqttHud((h) => ({ ...h, connected: false }));
        }
      });
      client.on("offline", () => {
        mqttClientRef.current = null;
        if (!cancelled) {
          setMqttConnected(false);
          setMqttHud((h) => ({ ...h, connected: false, lastError: h.lastError ?? "offline" }));
        }
      });
      client.on("error", (err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setMqttHud((h) => ({ ...h, lastError: msg }));
        }
      });
      client.on("message", (topic, payload) => {
        try {
          const text = payload.toString();
          const oneLine = text.replace(/\s+/g, " ").slice(0, 420);
          setMqttHud((h) => ({
            ...h,
            rxCount: h.rxCount + 1,
            lastTopic: topic,
            lastPayloadLine: oneLine || null,
          }));
          const j = parseJsonLoose(text);
          if (j == null) return;
          const docked = extractDroneInDock(j);
          if (docked !== null) setDroneInDock(docked);
          const ll = extractAirportLatLon(j);
          if (ll != null) setMqttAirportLatLon(ll);
          // 按 topic 中的 SN 区分机场 vs 机体，分别更新对应遥测字段
          const airSN = (opts.airportSN ?? "").trim();
          const devSN = (opts.deviceSN ?? "").trim();
          const isAirport = airSN !== "" && topic.includes(airSN);
          const isDrone = devSN !== "" && topic.includes(devSN);
          if (isDrone || (!isAirport && devSN === "")) {
            const dt = extractDroneTelemetry(j);
            if (dt) setMqttTelemetry((prev) => ({ ...prev, ...dt }));
          }
          if (isAirport || (!isDrone && airSN === "")) {
            const at = extractAirportTelemetry(j);
            if (at) {
              setMqttTelemetry((prev) => ({
                ...prev,
                ...(at.airportWindSpeedMps !== null ? { airportWindSpeedMps: at.airportWindSpeedMps } : {}),
                ...(at.rainfall !== null ? { rainfall: at.rainfall } : {}),
                ...(at.airportDroneChargePercent !== null ? { airportDroneChargePercent: at.airportDroneChargePercent } : {}),
                ...(at.airportFlightTaskStepCode !== null ? { airportFlightTaskStepCode: at.airportFlightTaskStepCode } : {}),
                ...(at.airportModeCode !== null ? { airportModeCode: at.airportModeCode } : {}),
              }));
            }
          }
        } catch {
          /* ignore */
        }
      });
    } catch (e) {
      if (!cancelled) {
        setMqttConnected(false);
        const msg = e instanceof Error ? e.message : String(e);
        setMqttHud((h) => ({
          ...h,
          connected: false,
          lastError: `mqtt_load_or_connect: ${msg}`,
        }));
      }
    }

    return () => {
      cancelled = true;
      mqttClientRef.current = null;
      try {
        client?.end(true);
      } catch {
        /* ignore */
      }
      client = null;
      setMqttConnected(false);
      setMqttHud(MQTT_HUD_INITIAL);
    };
  }, [opts.enabled, opts.airportSN, opts.deviceSN, opts.wsUrl, opts.mqttUsername, opts.mqttPassword]);

  return { droneInDock, mqttAirportLatLon, mqttTelemetry, mqttConnected, mqttHud, publishStickControl };
}
