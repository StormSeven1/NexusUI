/**
 * WebSocket 航迹载荷 → 与 `Track` / 地图渲染一致的字段（对空对海、敌我默认敌方、空中航向 +45°）。
 */

import { isVirtualFromProperties, type Track } from "@/lib/map-entity-model";
import { parseForceDisposition, type ForceDisposition } from "@/lib/theme-colors";
import { getTrackRenderingConfig } from "@/lib/map-app-config";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function truthyAirSea(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes";
  }
  return false;
}

/** 对空→air，对海→sea；兼容已有 type 与英文域 */
export function inferTrackSurfaceKind(rec: Record<string, unknown>): Track["type"] {
  const t = rec.type;
  if (t === "air" || t === "sea" || t === "underwater") return t;

  if (truthyAirSea(rec.对空) || truthyAirSea(rec["对空目标"])) return "air";
  if (truthyAirSea(rec.对海) || truthyAirSea(rec["对海目标"])) return "sea";

  const domain = String(rec.target_domain ?? rec.track_domain ?? rec.domain ?? rec.surfaceKind ?? "").toLowerCase();
  if (domain.includes("air") || domain === "a" || domain === "空中") return "air";
  if (domain.includes("sea") || domain.includes("surface") || domain === "s" || domain.includes("水面")) return "sea";
  if (domain.includes("sub") || domain.includes("under") || domain.includes("水下")) return "underwater";

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
  return c;
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
 * 将单条 WS 航迹（含不完整字段）规范为 `Track`。
 */
export function normalizeIncomingTrack(raw: unknown): Track | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = String(rec.id ?? "");
  if (!id) return null;
  const lat = Number(rec.lat ?? rec.latitude);
  const lng = Number(rec.lng ?? rec.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

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

  return {
    id,
    name: String(rec.name ?? rec.label ?? id),
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

/** 与 `trackDisplay.maxViewportPoints` 联动：单条航迹在 store 内最多保留的历史点数 */
export function maxStoredTrailPointsPerTrack(): number {
  const max = getTrackRenderingConfig().trackDisplay.maxViewportPoints;
  if (!Number.isFinite(max) || max < 8) return 2;
  return Math.max(2, Math.min(400, Math.floor(max / 3)));
}

/**
 * 全量 WS 航迹列表与上一帧合并（结果仍是一次 `setTracks` 写入 Zustand，**无**独立「WS 缓存表」）：
 * - `incoming`：本帧 WS 解析后的目标列表（当前 `lat/lng` 等）。
 * - 对每条 `id`，若 `prev` 里同 id 存在且本帧相对上一帧**坐标变化**，把**上一帧坐标** `[lng,lat]` 追加进该条的 `historyTrail`（不含本帧当前点）。
 * - 单条 `historyTrail` 长度上限见 `maxStoredTrailPointsPerTrack`（与配置 `maxViewportPoints` 联动，限制的是**存多少**，不是地图删不删）。
 */
export function mergeTrackWsPayloadWithHistory(prev: Track[], incoming: Track[]): Track[] {
  const cap = maxStoredTrailPointsPerTrack();
  const prevMap = new Map(prev.map((t) => [t.id, t]));
  return incoming.map((t) => {
    const old = prevMap.get(t.id);
    if (!old) return { ...t };

    let historyTrail = old.historyTrail ? [...old.historyTrail] : [];
    const moved = old.lat !== t.lat || old.lng !== t.lng;
    if (moved) {
      historyTrail = [...historyTrail, [old.lng, old.lat] as [number, number]];
      if (historyTrail.length > cap) historyTrail = historyTrail.slice(-cap);
    }

    return historyTrail.length ? { ...t, historyTrail } : { ...t };
  });
}
