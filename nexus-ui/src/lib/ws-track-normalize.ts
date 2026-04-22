/**
 * WebSocket 航迹载荷 → 与 `Track` / 地图渲染一致的字段。
 *
 * 核心字段：
 * - `showID` = `uniqueID`（缓存主键，整个工程统一用此做 key）
 * - `uniqueID` — 后端唯一标识（报文 uniqueID / uniqueId）
 * - `trackId` — 业务 trackId（告警匹配用）
 * - `isAirTrack` — 对空 / 对海
 * - `targetType` — 目标类型
 */

import { isVirtualFromProperties, type Track } from "@/lib/map-entity-model";
import { parseForceDisposition, type ForceDisposition } from "@/lib/theme-colors";
import { getTrackRenderingConfig } from "@/lib/map-app-config";
import { transformCoordinate } from "@/lib/coordinate-transform";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * 后端 `isAirTrack` / `is_air_track`：true→对空(air)，false→对海(sea)；缺省再信 `type`。
 */
function readIsAirTrack(rec: Record<string, unknown>): boolean | undefined {
  const v = rec.isAirTrack ?? rec.is_air_track;
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes") return true;
    if (s === "0" || s === "false" || s === "no") return false;
  }
  return undefined;
}

/** 对空→air，对海→sea；优先后端 `isAirTrack`，否则 `type`，默认 sea */
export function inferTrackSurfaceKind(rec: Record<string, unknown>): Track["type"] {
  const air = readIsAirTrack(rec);
  if (air === true) return "air";
  if (air === false) return "sea";

  const t = rec.type;
  if (t === "air" || t === "sea" || t === "underwater") return t;

  if (typeof t === "string") {
    const u = t.toLowerCase();
    if (u === "air" || u === "sea" || u === "underwater") return u as Track["type"];
  }
  return "sea";
}

/** 海面/水下：地理航向=正北顺时针；空中：在服务端航向基础上加配置 `trackRendering.airIconHeadingOffsetDeg`（默认 45） */
export function trackIconHeadingDeg(kind: Track["type"], courseDeg: number): number {
  const c = Number.isFinite(courseDeg) ? courseDeg : 0;
  if (kind === "air") return c + getTrackRenderingConfig().airIconHeadingOffsetDeg;
  return 0;
}

function readCourseDeg(rec: Record<string, unknown>, kind: Track["type"]): number {
  const raw = rec.heading ?? rec.course ?? rec.heading_deg ?? rec.azimuth;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : kindDefaultCourse(kind);
}

/** 空中缺省原始航向读配置 `airDefaultCourseDeg`（默认 45），再叠加 `airIconHeadingOffsetDeg` */
function kindDefaultCourse(kind: Track["type"]): number {
  if (kind === "air") return getTrackRenderingConfig().airDefaultCourseDeg;
  return 0;
}

function readDisposition(rec: Record<string, unknown>): ForceDisposition {
  const top = rec.disposition ?? rec.affiliation ?? rec.forceDisposition ?? rec.敌我;
  if (typeof top === "string") return parseForceDisposition(top, "hostile");
  const p = asRecord(rec.properties);
  if (p) {
    return parseForceDisposition(p.disposition ?? p.affiliation ?? p.forceDisposition, "hostile");
  }
  return "hostile";
}

/**
 * 解析航迹的 uniqueID：必须来自报文 uniqueID / uniqueId，禁止前端拼接。
 * 对齐 V2 `resolveTrackUniqueID`。
 */
function resolveUniqueID(rec: Record<string, unknown>): string {
  const u = rec.uniqueID ?? rec.uniqueId ?? rec.unique_id;
  if (u != null && String(u).trim() !== "") return String(u).trim();
  return "";
}

/**
 * 将单条 WS 航迹（含不完整字段）规范为 `Track`。
 */
export function normalizeIncomingTrack(raw: unknown): Track | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;

  const uniqueID = resolveUniqueID(rec);
  const fallbackId = String(rec.id ?? "");
  const showID = uniqueID || fallbackId;
  if (!showID) return null;

  const rawLat = Number(rec.lat ?? rec.latitude);
  const rawLng = Number(rec.lng ?? rec.longitude);
  if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return null;

  const [lng, lat] = transformCoordinate(rawLng, rawLat);

  const kind = inferTrackSurfaceKind(rec);
  const course = readCourseDeg(rec, kind);
  const heading = trackIconHeadingDeg(kind, course);
  const disposition = readDisposition(rec);

  const speed = Number(rec.speed ?? rec.speed_ms ?? 0);
  const altRaw = rec.altitude ?? rec.alt ?? rec.height;
  const altitude = altRaw != null && Number.isFinite(Number(altRaw)) ? Number(altRaw) : undefined;

  const propBag: Record<string, unknown> = { ...(asRecord(rec.properties) ?? {}) };
  if (rec.virtualTroop !== undefined) propBag.virtualTroop = rec.virtualTroop;
  if (rec.virtual_troop !== undefined) propBag.virtual_troop = rec.virtual_troop;
  const isVirtual = isVirtualFromProperties(propBag);
  const rawUav = rec.is_uav ?? rec.isUav ?? rec.uav;
  const isUav =
    rawUav === true ||
    rawUav === 1 ||
    (typeof rawUav === "string" && /^(1|true|yes|uav)$/i.test(rawUav.trim()));

  const isAirTrack = kind === "air";

  const trackId = rec.trackId ?? rec.track_id ?? rec.tracnID;
  const trackIdStr = trackId != null && String(trackId).trim() !== "" ? String(trackId).trim() : undefined;

  const targetType = rec.target_type ?? rec.targetType ?? rec.name ?? rec.label;
  const targetTypeStr = targetType != null ? String(targetType) : undefined;

  const azimuthRaw = rec.azimuth ?? rec.azimuth_deg;
  const azimuth = azimuthRaw != null && Number.isFinite(Number(azimuthRaw)) ? Number(azimuthRaw) : undefined;

  const distanceRaw = rec.range ?? rec.distance;
  const distance = distanceRaw != null && Number.isFinite(Number(distanceRaw)) ? Number(distanceRaw) : undefined;

  const dataSourceId = rec.dataSourceId ?? rec.data_source_id;
  const dataSourceIdStr = dataSourceId != null ? String(dataSourceId) : undefined;

  return {
    id: showID,
    showID,
    uniqueID,
    ...(trackIdStr ? { trackId: trackIdStr } : {}),
    name: String(rec.name ?? rec.label ?? showID),
    type: kind,
    disposition,
    lat,
    lng,
    altitude,
    heading,
    speed: Number.isFinite(speed) ? speed : 0,
    sensor: String(rec.sensor ?? rec.source ?? ""),
    lastUpdate: String(rec.lastUpdate ?? rec.last_update ?? rec.updated_at ?? new Date().toISOString()),
    starred: Boolean(rec.starred),
    ...(isAirTrack ? { isAirTrack: true } : {}),
    ...(targetTypeStr ? { targetType: targetTypeStr } : {}),
    ...(Number.isFinite(course) ? { course } : {}),
    ...(azimuth != null ? { azimuth } : {}),
    ...(distance != null ? { distance } : {}),
    ...(dataSourceIdStr ? { dataSourceId: dataSourceIdStr } : {}),
    ...(isVirtual ? { isVirtual: true } : {}),
    ...(isUav ? { isUav: true } : {}),
  };
}

export function normalizeIncomingTrackList(list: unknown): Track[] {
  if (!Array.isArray(list)) return [];
  const out: Track[] = [];
  for (const item of list) {
    const t = normalizeIncomingTrack(item);
    if (t) out.push(t);
  }
  return out;
}

/** 与 `trackRendering.trackDisplay.maxHistoryPointsPerTrack` 对齐：单条航迹在 store 内最多保留的历史点数 */
export function maxStoredTrailPointsPerTrack(): number {
  const max = getTrackRenderingConfig().trackDisplay.maxHistoryPointsPerTrack;
  if (!Number.isFinite(max) || max < 2) return 2;
  return Math.max(2, Math.min(4000, Math.floor(max)));
}

