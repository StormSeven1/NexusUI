"use client";

/**
 * WebSocket：建连、解析、按 `type` 写入各 store（思路对齐 V2 App.vue）。
 * 静态配置（app-config.json 的 radar、cameras.devices）经 fetchConfigAssetBase 与 WS 合并，见 map-app-config。
 */

import { useEffect } from "react";
import { toast } from "sonner";
import { useTrackStore } from "@/stores/track-store";
import { useAlertStore } from "@/stores/alert-store";
import type { AssetData } from "@/stores/asset-store";
import { useAssetStore } from "@/stores/asset-store";
import type { ZoneData } from "@/stores/zone-store";
import { useZoneStore } from "@/stores/zone-store";
import { useDroneStore } from "@/stores/drone-store";
import {
  mapOneEntityRow,
  mapEntitiesPayload,
  fetchConfigAssetBase,
  mergeDynamicAndStaticAssets,
} from "@/lib/map-app-config";
import { mergeTrackWsPayloadWithHistory, normalizeIncomingTrackList } from "@/lib/ws-track-normalize";
import { normalizeWsAlertItem, normalizeWsAlertList } from "@/lib/ws-alert-normalize";
import {
  filterTracksByTimeout,
  getAirportMapDefaults,
  getTrackRenderingConfig,
} from "@/lib/map-app-config";

type WsShard = "tracks" | "alerts" | "assets";

/** 与 WS 全量资产列表合并：先静态后动态，同 id 以 WS 为准 */
let configAssetBaseCache: AssetData[] = [];
let lastWsAssetList: AssetData[] = [];

async function reloadAppConfigAssetBase() {
  configAssetBaseCache = await fetchConfigAssetBase();
  useAssetStore.getState().setAssets(mergeDynamicAndStaticAssets(configAssetBaseCache, lastWsAssetList));
}

function applyAssetListFromWs(list: AssetData[]) {
  lastWsAssetList = list;
  useAssetStore.getState().setAssets(mergeDynamicAndStaticAssets(configAssetBaseCache, list));
}

const INITIAL_RECONNECT_MS = 2_000;
const MAX_RECONNECT_MS = 30_000;
const HEARTBEAT_MS = 25_000;

const ws = {
  running: false,
  sockets: {} as Partial<Record<WsShard, WebSocket | null>>,
  reconnectTimers: {} as Partial<Record<WsShard, ReturnType<typeof setTimeout>>>,
  reconnectAttempt: { tracks: 0, alerts: 0, assets: 0 } as Record<WsShard, number>,
  heartbeatTimers: {} as Partial<Record<WsShard, ReturnType<typeof setInterval>>>,
  channelsAllReadyNotified: false,
  /** 无新 WS 航迹包时仍按 `lastUpdate` 定时剔除超时目标 */
  trackPruneTimer: null as ReturnType<typeof setInterval> | null,
};

function wsUrl(path: "/ws/tracks" | "/ws/alerts" | "/ws/assets"): string {
  if (typeof window === "undefined") return "";
  return `ws://${window.location.hostname}:8001/api${path}`;
}

function notify(title: string, body: string | undefined, variant: "info" | "success" | "error") {
  if (variant === "error") toast.error(title, { description: body });
  else if (variant === "success") toast.success(title, { description: body });
  else toast.info(title, { description: body });
}

function shardLabel(ch: WsShard): string {
  if (ch === "tracks") return "航迹";
  if (ch === "alerts") return "告警";
  return "资产";
}

function clearReconnectTimer(ch: WsShard) {
  const t = ws.reconnectTimers[ch];
  if (t) clearTimeout(t);
  ws.reconnectTimers[ch] = undefined;
}

function clearHeartbeat(ch: WsShard) {
  const t = ws.heartbeatTimers[ch];
  if (t) clearInterval(t);
  ws.heartbeatTimers[ch] = undefined;
}

function backoffMs(ch: WsShard): number {
  const n = ws.reconnectAttempt[ch];
  return Math.min(MAX_RECONNECT_MS, INITIAL_RECONNECT_MS * Math.pow(2, Math.min(n, 4)));
}

function isoNow() {
  return new Date().toISOString();
}

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

/** 规范化多边形环 [lng,lat][]，供 MapLibre Polygon */
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

/** 圆心 + 半径（米）→ 多边形近似环 */
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

/**
 * Vue/V2 风格单条区域 → `ZoneData`。
 * - **颜色**：报文里的 `strokeColor` → `color`（边线/标签），`fillColor` → `fill_color`；缺省则描边 `#3b82f6`，填充回落为与描边同色。
 *   `fillOpacity`（数字）→ `fill_opacity`（写入 store；2D `POLY_ZONES_FILL` 是否使用该字段见 `buildZonesFeatureCollection` 注释）。
 * - **类型**：`zone_type` 由名称 `inferZoneType` 推断（禁飞/警告/演训），供无显式颜色时在 `ZONE_COLORS` 里取默认填充与线色。
 */
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
  return {
    id,
    name,
    zone_type: zt,
    source: "websocket",
    coordinates,
    color: line,
    fill_color: fill,
    fill_opacity: typeof z.fillOpacity === "number" ? z.fillOpacity : 0.25,
    properties: {
      geometryType,
      areaType: z.areaType,
      isActive: z.isActive,
    },
    created_at: now,
    updated_at: now,
  };
}

/** 与 V2 App.vue Zones 分支一致：名称含「拒止拦截区」「警告驱离区」等 */
function zoneNameMatchesV2Filter(name: string): boolean {
  const n = name || "";
  return n.includes("拒止拦截区") || n.includes("警告驱离区");
}

function mapZonesPayload(payload: unknown): ZoneData[] {
  if (!Array.isArray(payload)) return [];
  const out: ZoneData[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const zd = vueZoneItemToZoneData(rec);
    if (zd) out.push(zd);
  }
  return out;
}

function applyAssetWsEvent(ev: Record<string, unknown>) {
  const t = ev.type as string;
  if (t === "asset_arrived") {
    const id = String(ev.assetId ?? "");
    if (!id) return;
    const lat = Number(ev.lat);
    const lng = Number(ev.lng);
    const patch: Partial<AssetData> = { mission_status: "monitoring" };
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      patch.lat = lat;
      patch.lng = lng;
    }
    /* 光电扇区：与 `mapOneEntityRow` 一致，支持 `bearing` / `fovAngle` 等别名 */
    const hRaw = ev.heading ?? ev.bearing ?? ev.azimuth;
    if (hRaw != null && Number.isFinite(Number(hRaw))) patch.heading = Number(hRaw);
    const fovRaw = ev.fov_angle ?? ev.fovAngle ?? ev.openingDeg;
    if (fovRaw != null && Number.isFinite(Number(fovRaw))) patch.fov_angle = Number(fovRaw);
    useAssetStore.getState().mergeAssetFields(id, patch);
  }
}

function payloadArray(msg: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(msg.data)) return msg.data as unknown[];
  if (Array.isArray(msg.assets)) return msg.assets as unknown[];
  if (Array.isArray(msg.entities)) return msg.entities as unknown[];
  if (Array.isArray(msg.zones)) return msg.zones as unknown[];
  return null;
}

function dispatchWsMessage(shard: WsShard, raw: string) {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const type = data.type as string | undefined;
    if (!type) return;

    switch (type) {
      case "track_update":
      case "track_snapshot": {
        const tracks = data.tracks as unknown[] | undefined;
        if (Array.isArray(tracks)) {
          const prev = useTrackStore.getState().tracks;
          const normalized = normalizeIncomingTrackList(tracks);
          useTrackStore.getState().setTracks(mergeTrackWsPayloadWithHistory(prev, normalized));
          const ts = data.timestamp as string | undefined;
          if (ts) useTrackStore.getState().setLastUpdate(ts);
        }
        break;
      }
      case "alert_batch": {
        const list = data.alerts as unknown[] | undefined;
        if (Array.isArray(list) && list.length) {
          const normalized = normalizeWsAlertList(list);
          if (normalized.length) useAlertStore.getState().addAlerts(normalized);
        }
        break;
      }
      /* V2：`map_command` → MCP `alert`，payload 在 `data.data`（与 `MCPMapController.handleMapCommand` 一致） */
      case "map_command": {
        const wrap = data.data;
        if (!wrap || typeof wrap !== "object") break;
        const w = wrap as Record<string, unknown>;
        if (w.command !== "alert") break;
        const inner = w.data;
        const payload =
          inner != null && typeof inner === "object" && !Array.isArray(inner)
            ? (inner as Record<string, unknown>)
            : w;
        const one = normalizeWsAlertItem(payload);
        if (one) useAlertStore.getState().addAlerts([one]);
        break;
      }
      case "alert":
      case "Alert": {
        const inner = (data.data ?? data) as Record<string, unknown>;
        const one = normalizeWsAlertItem(inner);
        if (one) useAlertStore.getState().addAlerts([one]);
        break;
      }
      /* 区域：对齐 V2 App.vue 的 Zones 推送 */
      case "Zones":
      case "zones": {
        const arr = payloadArray(data);
        if (arr?.length) {
          useZoneStore.getState().setZones(mapZonesPayload(arr));
        }
        break;
      }
      /* 资产：全量或批量 */
      case "Assets":
      case "assets":
      case "AssetBatch":
      case "assetBatch": {
        const arr = payloadArray(data);
        if (Array.isArray(arr)) {
          applyAssetListFromWs(mapEntitiesPayload(arr));
        }
        break;
      }
      case "entity_status": {
        const d = data.data;
        if (Array.isArray(d)) {
          applyAssetListFromWs(mapEntitiesPayload(d));
        } else if (d && typeof d === "object" && !Array.isArray(d)) {
          applyAssetListFromWs(mapEntitiesPayload(Object.values(d as Record<string, unknown>)));
        }
        break;
      }
      case "DockStatus":
      case "dockStatus":
      case "dock_status": {
        const d = data.data as Record<string, unknown> | undefined;
        if (!d || d.latitude == null || d.longitude == null) break;
        useDroneStore.getState().setDockStatus(d);
        const dockSn = String(d.dock_sn ?? d.sn ?? "dock");
        const id = `airport_${dockSn}`;
        const now = isoNow();
        const ap = getAirportMapDefaults();
        const vt =
          d.virtual_troop === true ||
          d.virtualTroop === true ||
          d.is_virtual === true ||
          d.is_virtual === 1;
        useAssetStore.getState().upsertAsset({
          id,
          name: `机场 ${dockSn}`,
          asset_type: "airport",
          status: "online",
          lat: Number(d.latitude),
          lng: Number(d.longitude),
          range_km: null,
          heading: null,
          fov_angle: null,
          properties: {
            dock: d,
            center_icon_visible: ap.centerIconVisible,
            center_name_visible: ap.centerNameVisible,
            virtual_troop: vt,
            is_virtual: vt,
          },
          mission_status: "monitoring",
          assigned_target_id: null,
          target_lat: null,
          target_lng: null,
          created_at: now,
          updated_at: now,
        });
        break;
      }
      case "DroneStatus":
      case "droneStatus":
      case "drone_status": {
        const d = data.data as Record<string, unknown> | undefined;
        if (!d) break;
        useDroneStore.getState().setDroneStatus(d);
        break;
      }
      case "DroneFlightPath":
      case "droneFlightPath":
      case "drone_flight_path": {
        const d = data.data as Record<string, unknown> | undefined;
        if (d && typeof d === "object") useDroneStore.getState().setDroneFlightPath(d);
        break;
      }
      case "HighFreq":
      case "highFreq":
      case "high_freq": {
        const d = data.data as Record<string, unknown> | undefined;
        if (d && typeof d === "object") useDroneStore.getState().setHighFreq(d);
        break;
      }
      case "Drone":
      case "drone":
      case "DroneData": {
        const d = data.data as Record<string, unknown> | undefined;
        if (d && typeof d === "object") useDroneStore.getState().setLegacyDrone(d);
        break;
      }
      case "ClearDrones":
      case "clearDrones":
        useDroneStore.getState().clearDrones();
        break;
      case "asset_events": {
        const events = data.events as unknown[] | undefined;
        if (Array.isArray(events)) {
          for (const ev of events) {
            if (ev && typeof ev === "object") applyAssetWsEvent(ev as Record<string, unknown>);
          }
        }
        break;
      }
      case "heartbeat": {
        const sock = ws.sockets[shard];
        if (sock?.readyState === WebSocket.OPEN) {
          sock.send(
            JSON.stringify({
              type: "pong",
              created_at: new Date().toISOString(),
              data: { message: "pong" },
            })
          );
        }
        break;
      }
      default:
        break;
    }
  } catch {
    /* 忽略非法 JSON */
  }
}

function startHeartbeat(ch: WsShard, socket: WebSocket) {
  clearHeartbeat(ch);
  ws.heartbeatTimers[ch] = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify({ type: "ping", channel: ch, t: Date.now() }));
    } catch {
      /* ignore */
    }
  }, HEARTBEAT_MS);
}

function maybeNotifyAllReady() {
  const ok =
    ws.sockets.tracks?.readyState === WebSocket.OPEN &&
    ws.sockets.alerts?.readyState === WebSocket.OPEN &&
    ws.sockets.assets?.readyState === WebSocket.OPEN;
  if (ok && !ws.channelsAllReadyNotified) {
    ws.channelsAllReadyNotified = true;
    notify("WebSocket 已就绪", "航迹 / 告警 / 资产 通道已连接", "success");
  }
}

function scheduleReconnect(ch: WsShard, reason: string) {
  if (!ws.running) return;
  clearReconnectTimer(ch);
  const delay = backoffMs(ch);
  ws.reconnectTimers[ch] = setTimeout(() => {
    ws.reconnectTimers[ch] = undefined;
    if (!ws.running) return;
    notify(`${shardLabel(ch)} 重连中`, reason, "info");
    openWsChannel(ch);
  }, delay);
}

function openWsChannel(ch: WsShard) {
  if (!ws.running) return;
  const path =
    ch === "tracks" ? "/ws/tracks" : ch === "alerts" ? "/ws/alerts" : "/ws/assets";
  const url = wsUrl(path);
  if (!url) return;

  const prev = ws.sockets[ch];
  if (prev && (prev.readyState === WebSocket.OPEN || prev.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const socket = new WebSocket(url);
  ws.sockets[ch] = socket;

  socket.onopen = () => {
    ws.reconnectAttempt[ch] = 0;
    if (ch === "tracks") useTrackStore.getState().setConnected(true);
    startHeartbeat(ch, socket);
    maybeNotifyAllReady();
  };

  socket.onmessage = (ev) => {
    dispatchWsMessage(ch, ev.data as string);
  };

  socket.onerror = () => {
    notify(`${shardLabel(ch)} 连接异常`, "请确认后端 8001 端口 WebSocket 服务可用", "error");
    try {
      socket.close();
    } catch {
      /* noop */
    }
  };

  socket.onclose = () => {
    clearHeartbeat(ch);
    if (ch === "tracks") useTrackStore.getState().setConnected(false);
    ws.sockets[ch] = null;
    if (!ws.running) return;
    ws.reconnectAttempt[ch] += 1;
    if (ws.reconnectAttempt[ch] > 12) {
      notify(`${shardLabel(ch)} 重连失败`, "已停止自动重连", "error");
      return;
    }
    scheduleReconnect(ch, "连接已断开");
  };
}

/** 航迹超时**仅**在此定时扫 `track-store`；WS 入站不做 `filterTracksByTimeout`。 */
function startTrackStalePrune() {
  if (ws.trackPruneTimer) clearInterval(ws.trackPruneTimer);
  const tick = () => Math.max(500, getTrackRenderingConfig().trackTimeout.checkIntervalMs);
  ws.trackPruneTimer = setInterval(() => {
    const cfg = getTrackRenderingConfig();
    if (!cfg.trackTimeout.enabled) return;
    const cur = useTrackStore.getState().tracks;
    const next = filterTracksByTimeout(cur);
    if (next.length !== cur.length) useTrackStore.getState().setTracks(next);
  }, tick());
}

function startUnifiedWs() {
  if (ws.running) return;
  ws.running = true;
  ws.channelsAllReadyNotified = false;
  notify("正在连接 WebSocket", "航迹 / 告警 / 资产", "info");
  (["tracks", "alerts", "assets"] as const).forEach((ch) => openWsChannel(ch));
  startTrackStalePrune();
}

function stopUnifiedWs() {
  ws.running = false;
  if (ws.trackPruneTimer) {
    clearInterval(ws.trackPruneTimer);
    ws.trackPruneTimer = null;
  }
  (["tracks", "alerts", "assets"] as const).forEach((ch) => {
    clearReconnectTimer(ch);
    clearHeartbeat(ch);
    const sock = ws.sockets[ch];
    if (sock && sock.readyState === WebSocket.OPEN) sock.close(1000, "client shutdown");
    ws.sockets[ch] = null;
  });
  useTrackStore.getState().setConnected(false);
}

export function useUnifiedWsFeed() {
  useEffect(() => {
    void reloadAppConfigAssetBase();
    startUnifiedWs();
    return () => stopUnifiedWs();
  }, []);
}
