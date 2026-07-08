/**
 * track-parse-worker.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * 独立 Web Worker：将大批量航迹的 JSON.parse + normalize 全部移出主线程。
 * 主线程只做最终的 `setTracks`（Zustand + MapLibre setData），不再被解析堵塞。
 *
 * 该文件**不**能 import 任何 app 模块（Zustand、React、Next.js 特有 API）；
 * 仅可依赖与主线程共用的**无框架**纯函数模块（如 `track-category-id-parse.ts`）。
 * ─────────────────────────────────────────────────────────────────────────────
 */
/* eslint-disable */

import {
  readTrackCategoryFromRecord,
  readClassifiedTypeFromRecord,
  resolveAirTrackIsUav,
} from "./track-category-id-parse";
import { readRealityTypeFromRecord, resolveTrackIsVirtual } from "./track-reality-type";
import { resolveTrackLastUpdateString } from "./track-last-update-resolve";

// 使 TypeScript 将本文件视为独立模块，避免与 DOM lib 中 Window.self 的类型冲突
export type { };

// ── 类型 ──────────────────────────────────────────────────────────────────────

type ForceDisposition = "friendly" | "hostile" | "neutral";
type TrackKind = "air" | "sea" | "underwater";

/** 与主线程 `TRACK_LAYER_KEY_BY_DDS_SOURCE_ID` / Custombackend 接收器 id 一致（Worker 不能 import 带 @/ 的模块） */
type LayerKey = "fuse_sea" | "fuse_air" | "bird_radar" | "fanwu_car_radar" | "radar_wharf" | "radar_jingzi" | "ais_track" | "uav_pose_track" | "boat_self_track" | "xpf_track";

type FusionSourceItem = {
  sourceName?: string;
  dataSourceId?: string | number;
  trackId?: string | number;
};

function _parseFusionSourcesFromRec(rec: Record<string, unknown>): FusionSourceItem[] | undefined {
  const raw = rec.fusionSources;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: FusionSourceItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const sourceName = String(s.sourceName ?? s.source_name ?? "").trim();
    const dataSourceId = s.dataSourceId ?? s.data_source_id;
    const trackId = s.trackId ?? s.track_id;
    if (!sourceName && dataSourceId == null && trackId == null) continue;
    out.push({
      ...(sourceName ? { sourceName } : {}),
      ...(dataSourceId != null ? { dataSourceId: dataSourceId as string | number } : {}),
      ...(trackId != null ? { trackId: trackId as string | number } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

const DDS_TO_LAYER: Record<string, LayerKey> = {
  dds_forward_fuse_track: "fuse_sea",
  dds_forward_fuse_bird_radar_track: "fuse_air",
  dds_forward_bird_radar_track: "bird_radar",
  dds_forward_fanwu_car_track: "fanwu_car_radar",
  dds_udp_fanwucar_track: "fanwu_car_radar",
  dds_forward_radar_track1: "radar_wharf",
  dds_forward_radar_track2: "radar_jingzi",
  dds_forward_ais_track: "ais_track",
  dds_forward_uav_pose_track: "uav_pose_track",
  dds_udp_boatself_track: "boat_self_track",
  dds_udp_xpf_track: "xpf_track",
};

const VALID_LAYER_KEYS = new Set<string>(Object.values(DDS_TO_LAYER));

function _readTrackLayerKeyFromRec(rec: Record<string, unknown>): LayerKey | undefined {
  const raw = rec.track_layer_key ?? rec.trackLayerKey;
  if (typeof raw !== "string") return undefined;
  const s = raw.trim().toLowerCase().replace(/-/g, "_");
  return VALID_LAYER_KEYS.has(s) ? (s as LayerKey) : undefined;
}

function _ddsSourceStr(rec: Record<string, unknown>): string | undefined {
  const v = rec.dds_source_id ?? rec.ddsSourceId;
  if (v == null || String(v).trim() === "") return undefined;
  return String(v).trim();
}

function _layerKeyFromDds(dds: string | undefined): LayerKey | undefined {
  if (!dds) return undefined;
  return DDS_TO_LAYER[dds.trim().toLowerCase()];
}

/** 与 `ws-track-normalize.surfaceKindFromDdsOrTrackLayerKey` 一致 */
function _surfaceKindFromDdsOrLayer(rec: Record<string, unknown>): TrackKind | undefined {
  const dds = _ddsSourceStr(rec)?.toLowerCase();
  const lk = _layerKeyFromDds(dds) ?? _readTrackLayerKeyFromRec(rec);
  if (lk === "fuse_air" || lk === "bird_radar" || lk === "fanwu_car_radar" || lk === "uav_pose_track") return "air";
  if (lk === "fuse_sea" || lk === "radar_wharf" || lk === "radar_jingzi" || lk === "ais_track" || lk === "boat_self_track" || lk === "xpf_track") {
    return "sea";
  }
  return undefined;
}

export interface TrackWorkerConfig {
  coordinateTransformEnabled: boolean;
  airIconHeadingOffsetDeg: number;
  airDefaultCourseDeg: number;
}

interface WorkerTrack {
  id: string; showID: string; uniqueID: string;
  trackId?: string; trackAlias?: string; name: string; type: TrackKind; disposition: ForceDisposition;
  lat: number; lng: number; altitude?: number; heading: number; course?: number;
  speed: number; sensor: string; lastUpdate: string; starred: boolean;
  isAirTrack?: true; targetType?: string; azimuth?: number; distance?: number;
  dataSourceId?: string; ddsSourceId?: string; trackLayerKey?: LayerKey;
  isVirtual?: true; isUav?: true;
  trackCategoryId?: number;
  classifiedType?: number;
  realityType?: number;
}

export interface TrackWorkerResult {
  msgType: string;
  tracks: WorkerTrack[];
  timestamp?: string;
}

// ── 运行时配置（由主线程通过 init 消息写入）────────────────────────────────────

let _cfg: TrackWorkerConfig = {
  coordinateTransformEnabled: true, // 国内部署默认 GCJ02
  airIconHeadingOffsetDeg: 45,
  airDefaultCourseDeg: 45,
};

// ── 坐标转换（内联自 coordinate-transform.ts，纯数学，无外部依赖）──────────────

const _PI = Math.PI;
const _A  = 6378245.0;
const _EE = 0.00669342162296594323;

function _tLat(x: number, y: number): number {
  let r = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
  r += ((20*Math.sin(6*x*_PI) + 20*Math.sin(2*x*_PI)) * 2) / 3;
  r += ((20*Math.sin(y*_PI)  + 40*Math.sin((y/3)*_PI)) * 2) / 3;
  r += ((160*Math.sin((y/12)*_PI) + 320*Math.sin((y*_PI)/30)) * 2) / 3;
  return r;
}
function _tLng(x: number, y: number): number {
  let r = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
  r += ((20*Math.sin(6*x*_PI) + 20*Math.sin(2*x*_PI)) * 2) / 3;
  r += ((20*Math.sin(x*_PI)  + 40*Math.sin((x/3)*_PI)) * 2) / 3;
  r += ((150*Math.sin((x/12)*_PI) + 300*Math.sin((x/30)*_PI)) * 2) / 3;
  return r;
}
function _outOfChina(lng: number, lat: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function _wgs84ToGcj02(lng: number, lat: number): [number, number] {
  if (_outOfChina(lng, lat)) return [lng, lat];
  let dLat = _tLat(lng - 105, lat - 35);
  let dLng = _tLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * _PI;
  let magic = Math.sin(radLat);
  magic = 1 - _EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((_A * (1 - _EE)) / (magic * sqrtMagic)) * _PI);
  dLng = (dLng * 180) / ((_A / sqrtMagic) * Math.cos(radLat) * _PI);
  return [lng + dLng, lat + dLat];
}
function _coord(lng: number, lat: number): [number, number] {
  return _cfg.coordinateTransformEnabled ? _wgs84ToGcj02(lng, lat) : [lng, lat];
}

// ── 内联工具函数 ──────────────────────────────────────────────────────────────

function _rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function _parseDisp(raw: unknown, fb: ForceDisposition = "hostile"): ForceDisposition {
  if (typeof raw !== "string") return fb;
  const s = raw.trim().toLowerCase();
  if (s === "hostile" || s === "enemy"   || s === "敌方" || s === "敌") return "hostile";
  if (s === "friendly"|| s === "ally"    || s === "友方" || s === "我方") return "friendly";
  if (s === "neutral" || s === "中立") return "neutral";
  return fb;
}

function _isVirtual(p: Record<string, unknown> | null | undefined): boolean {
  if (!p) return false;
  if (p.virtualTroop === true || p.virtual_troop === true) return true;
  const r = p.is_virtual ?? p.virtual ?? p.isVirtual;
  if (typeof r === "boolean") return r;
  if (typeof r === "number") return r !== 0;
  if (typeof r === "string") { const s = r.trim().toLowerCase(); return s === "true" || s === "1" || s === "yes" || s === "virtual"; }
  return false;
}

function _isAir(rec: Record<string, unknown>): boolean | undefined {
  const v = rec.isAirTrack ?? rec.is_air_track;
  if (v === true  || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === "string") { const s = v.trim().toLowerCase(); if (s === "1"||s==="true"||s==="yes") return true; if (s==="0"||s==="false"||s==="no") return false; }
  return undefined;
}

function _inferKind(rec: Record<string, unknown>): TrackKind {
  const fromDds = _surfaceKindFromDdsOrLayer(rec);
  if (fromDds !== undefined) return fromDds;
  const air = _isAir(rec);
  if (air === true)  return "air";
  if (air === false) return "sea";
  const t = rec.type;
  if (t === "air" || t === "sea" || t === "underwater") return t as TrackKind;
  if (typeof t === "string") { const u = t.toLowerCase(); if (u === "air"||u === "sea"||u === "underwater") return u as TrackKind; }
  return "sea";
}

function _toFiniteAngle(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string" && raw.trim() === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function _firstCourseAngle(rec: Record<string, unknown>): number | undefined {
  const keys = ["course", "cog", "COG", "bearing", "heading_deg", "azimuth", "heading"];
  const bags = [rec, _rec(rec.properties)];
  for (let bi = 0; bi < bags.length; bi++) {
    const bag = bags[bi];
    if (!bag) continue;
    for (let ki = 0; ki < keys.length; ki++) {
      const v = _toFiniteAngle(bag[keys[ki]]);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

function _course(rec: Record<string, unknown>, kind: TrackKind): number {
  const v = _firstCourseAngle(rec);
  if (v !== undefined) return v;
  return kind === "air" ? _cfg.airDefaultCourseDeg : 0;
}

function _heading(kind: TrackKind, course: number): number {
  return kind === "air" ? course + _cfg.airIconHeadingOffsetDeg : 0;
}

function _uid(rec: Record<string, unknown>): string {
  const u = rec.uniqueID ?? rec.uniqueId ?? rec.unique_id;
  return u != null && String(u).trim() ? String(u).trim() : "";
}

function _disp(rec: Record<string, unknown>): ForceDisposition {
  const top = rec.disposition ?? rec.affiliation ?? rec.forceDisposition ?? rec["敌我"];
  if (typeof top === "string") return _parseDisp(top, "hostile");
  const p = _rec(rec.properties);
  if (p) return _parseDisp(p.disposition ?? p.affiliation ?? p.forceDisposition, "hostile");
  return "hostile";
}

// ── 单条航迹规范化（逻辑与 ws-track-normalize.normalizeIncomingTrack 完全对齐）─

function _normalize(raw: unknown): WorkerTrack | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;

  const uniqueID = _uid(rec);
  const showID = uniqueID || String(rec.id ?? "");
  if (!showID) return null;

  const rawLat = Number(rec.lat ?? rec.latitude);
  const rawLng = Number(rec.lng ?? rec.longitude);
  if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return null;

  const [lng, lat] = _coord(rawLng, rawLat);
  const kind    = _inferKind(rec);
  const course  = _course(rec, kind);
  const heading = _heading(kind, course);
  const disp    = _disp(rec);
  const speed   = Number(rec.speed ?? rec.speed_ms ?? 0);

  const altRaw  = rec.altitude ?? rec.alt ?? rec.height;
  const altitude = altRaw != null && Number.isFinite(Number(altRaw)) ? Number(altRaw) : undefined;

  const propBag: Record<string, unknown> = { ...(_rec(rec.properties) ?? {}) };
  if (rec.virtualTroop   !== undefined) propBag.virtualTroop   = rec.virtualTroop;
  if (rec.virtual_troop  !== undefined) propBag.virtual_troop  = rec.virtual_troop;

  const rawUav = rec.is_uav ?? rec.isUav ?? rec.uav;
  let isUav = rawUav === true || rawUav === 1
    || (typeof rawUav === "string" && /^(1|true|yes|uav)$/i.test(rawUav.trim()));

  const trackCategoryId = readTrackCategoryFromRecord(rec);
  const classifiedType = readClassifiedTypeFromRecord(rec);
  if (kind === "air") {
    isUav = resolveAirTrackIsUav(classifiedType, trackCategoryId, isUav);
  }

  const trackId    = rec.trackId ?? rec.track_id ?? rec.tracnID;
  const trackIdStr = trackId != null && String(trackId).trim() ? String(trackId).trim() : undefined;

  const aliasRaw     = rec.trackAlias ?? rec.track_alias;
  const trackAliasStr =
    aliasRaw != null && String(aliasRaw).trim() ? String(aliasRaw).trim() : undefined;

  const targetType    = rec.target_type ?? rec.targetType ?? rec.name ?? rec.label;
  const targetTypeStr = targetType != null ? String(targetType) : undefined;

  const azimuthRaw = rec.azimuth ?? rec.azimuth_deg;
  const azimuth    = azimuthRaw != null && Number.isFinite(Number(azimuthRaw)) ? Number(azimuthRaw) : undefined;

  const distRaw  = rec.range ?? rec.distance;
  const distance = distRaw != null && Number.isFinite(Number(distRaw)) ? Number(distRaw) : undefined;

  const fusions  = Array.isArray(rec.fusionSources) ? rec.fusionSources : null;
  const fusionSourcesParsed = _parseFusionSourcesFromRec(rec);
  let sensor: string;
  if (fusions && fusions.length > 0) {
    sensor = fusions.map((src: unknown) => {
      const s = src as Record<string, unknown>;
      const sn  = String(s.sourceName ?? s.source_name ?? "").trim();
      const tid = s.trackId ?? s.track_id;
      const ts  = tid != null ? String(tid) : "";
      return sn && ts ? `${sn}(${ts})` : sn || ts;
    }).filter(Boolean).join(", ");
  } else {
    sensor = String(rec.sensor ?? rec.source ?? "");
  }

  const dsId    = rec.dataSourceId ?? rec.data_source_id;
  const dsIdStr = dsId != null ? String(dsId) : undefined;

  const ddsStr = _ddsSourceStr(rec);
  const tlkPayload = _readTrackLayerKeyFromRec(rec);
  const tlkFromDds = _layerKeyFromDds(ddsStr);
  const resolvedLayerKey = tlkFromDds ?? tlkPayload;

  return {
    id: showID, showID, uniqueID,
    ...(trackIdStr  ? { trackId: trackIdStr }   : {}),
    ...(trackAliasStr ? { trackAlias: trackAliasStr } : {}),
    name: String(rec.name ?? rec.label ?? showID),
    type: kind, disposition: disp, lat, lng,
    ...(altitude !== undefined ? { altitude } : {}),
    heading, speed: Number.isFinite(speed) ? speed : 0, sensor,
    lastUpdate: resolveTrackLastUpdateString(rec),
    starred: Boolean(rec.starred),
    ...(kind === "air" ? { isAirTrack: true as const } : {}),
    ...(targetTypeStr ? { targetType: targetTypeStr } : {}),
    ...(Number.isFinite(course) ? { course } : {}),
    ...(azimuth  != null ? { azimuth }  : {}),
    ...(distance != null ? { distance } : {}),
    ...(dsIdStr  ? { dataSourceId: dsIdStr } : {}),
    ...(ddsStr ? { ddsSourceId: ddsStr } : {}),
    ...(resolvedLayerKey ? { trackLayerKey: resolvedLayerKey } : {}),
    ...(fusionSourcesParsed ? { fusionSources: fusionSourcesParsed } : {}),
    ...((): Record<string, unknown> => {
      const realityType = readRealityTypeFromRecord(rec);
      const rv = rec.is_virtual ?? rec.isVirtual;
      const rootVirtual =
        rv === true || rv === 1
        || (typeof rv === "string" && /^(1|true|yes|virtual)$/i.test(String(rv).trim()));
      const isVirtual = resolveTrackIsVirtual(realityType, propBag, rootVirtual || _isVirtual(propBag));
      return {
        ...(realityType !== undefined ? { realityType } : {}),
        ...(isVirtual ? { isVirtual: true as const } : {}),
      };
    })(),
    ...(isUav ? { isUav: true as const } : {}),
    ...(trackCategoryId !== undefined ? { trackCategoryId } : {}),
    ...(classifiedType !== undefined ? { classifiedType } : {}),
  };
}

// ── 消息处理 ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).onmessage = function (e: MessageEvent<{ type: string; config?: TrackWorkerConfig; raw?: string }>) {
  const msg = e.data;

  if (msg.type === "init") {
    if (msg.config) _cfg = msg.config;
    return;
  }

  if (msg.type !== "parse" || !msg.raw) return;

  try {
    const parsed = JSON.parse(msg.raw) as Record<string, unknown>;
    const msgType  = String((parsed.type as string | undefined) ?? "").toLowerCase();
    const timestamp = parsed.timestamp ? String(parsed.timestamp) : undefined;
    const tracks: WorkerTrack[] = [];

    if (msgType === "trackbatch") {
      const arr = parsed.data;
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (!item || typeof item !== "object") continue;
          const envelope = item as Record<string, unknown>;
          const t = _normalize(envelope.data ?? envelope);
          if (t) tracks.push(t);
        }
      }
    } else if (msgType === "track_update" || msgType === "track_snapshot") {
      const arr = parsed.tracks;
      if (Array.isArray(arr)) {
        for (const item of arr) {
          const t = _normalize(item);
          if (t) tracks.push(t);
        }
      }
    }

    const result: TrackWorkerResult = { msgType, tracks, timestamp };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (self as any).postMessage(result);
  } catch {
    /* 解析失败则静默丢弃 */
  }
};
