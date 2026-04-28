/**
 * WebSocket 航迹载荷 → 与 `Track` / 地图渲染一致的字段。
 *
 * 【数据流】
 *   WS 推送（track_batch / map_command track / 单条 track）
 *   → normalizeIncomingTrack / normalizeIncomingTrackList
 *   → Track 对象 → track-store.setTracks
 *   → 地图渲染层（Map2D/Map3D）+ TargetPlacard + TrackListPanel
 *
 * 【核心字段说明】
 *   - `showID` = `uniqueID`（缓存主键，整个工程统一用此做 key）
 *   - `uniqueID` — 后端唯一标识（报文 uniqueID / uniqueId）
 *   - `trackId` — 业务 trackId（告警匹配用，与 alert-store AlertData.trackId 对应）
 *   - `isAirTrack` — 对空标记（影响航迹图标旋转角度、ID 显示截断逻辑）
 *   - `targetType` — 目标类型（如 "对空融合航迹"、"drone"）
 *   - `sensor` — 传感器/来源信息（有 fusionSources 时组装为 "源名(trackId)" 格式）
 *   - `course` — 原始航向（对海=正北顺时针；对空=服务端航向）
 *   - `heading` — 图标渲染航向（对空=course + airIconHeadingOffsetDeg）
 *
 * 【ID 体系】
 *   - uniqueID/showID: 渲染缓存 key，全局唯一
 *   - trackId: 业务 ID，与告警匹配、处置方案关联
 *   - distinguishSeaAir 模式下：对海用 uniqueID，对空用 trackId 做告警匹配
 */

import { isVirtualFromProperties, type Track } from "@/lib/map-entity-model";
import { parseForceDisposition, type ForceDisposition } from "@/lib/theme-colors";
import { getTrackRenderingConfig } from "@/lib/map-app-config";
import { transformCoordinate } from "@/lib/coordinate-transform";

/** 判断非空对象 */
function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * 读取后端 isAirTrack / is_air_track 字段
 * true→对空(air)，false→对海(sea)；缺省再信 `type`。
 * 数据传递：后端报文 → 此函数 → inferTrackSurfaceKind → Track.type
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

/**
 * 推断航迹类型：对空→air，对海→sea
 * 优先级：isAirTrack > type 字段 > 默认 sea
 * 传递给 Track.type → 影响图标旋转、告警匹配、ID 截断
 */
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

/**
 * 计算图标渲染航向
 * - 海面/水下：固定 0（图标不旋转）
 * - 空中：原始航向 + airIconHeadingOffsetDeg（默认 45°，对齐 V2 旋转方向）
 * 数据传递：course(原始) → 此函数 → Track.heading → 地图图标 rotation
 */
export function trackIconHeadingDeg(kind: Track["type"], courseDeg: number): number {
  const c = Number.isFinite(courseDeg) ? courseDeg : 0;
  if (kind === "air") return c + getTrackRenderingConfig().airIconHeadingOffsetDeg;
  return 0;
}

/**
 * 读取原始航向（course）
 * 优先级：heading > course > heading_deg > azimuth
 * 缺省值：对空=airDefaultCourseDeg（默认45），对海=0
 */
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
 * 解析航迹 uniqueID：必须来自报文 uniqueID / uniqueId，禁止前端拼接。
 * 对齐 V2 `resolveTrackUniqueID`。
 * 数据传递：后端报文 uniqueID → 此函数 → Track.showID → 全局缓存 key
 */
function resolveUniqueID(rec: Record<string, unknown>): string {
  const u = rec.uniqueID ?? rec.uniqueId ?? rec.unique_id;
  if (u != null && String(u).trim() !== "") return String(u).trim();
  return "";
}

/**
 * 将单条 WS 航迹（含不完整字段）规范为 `Track`。
 *
 * 数据传递：WS 报文 → 此函数 → Track → track-store → 地图渲染 + UI 组件
 *
 * 关键变量说明：
 *   - uniqueID: 后端唯一标识（报文 uniqueID），作为 showID 的来源
 *   - showID: 渲染缓存主键（= uniqueID），全局唯一
 *   - trackIdStr: 业务 trackId，用于告警匹配和处置方案关联
 *   - kind: 航迹类型（air/sea/underwater），影响图标旋转和 ID 截断
 *   - course: 原始航向角度
 *   - heading: 图标渲染航向（对空=course+offset）
 *   - sensorValue: 传感器信息（有 fusionSources 时为 "源名(trackId)" 格式）
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

  // 解析 fusionSources：融合航迹的多源信息，组装为 "源名(trackId)" 格式
  // 例：[{ sourceName: "探鸟雷达", trackId: 5744 }] → sensor = "探鸟雷达(5744)"
  // 如果有 fusionSources，优先用它组装 sensor；否则回退到 rec.sensor / rec.source
  const fusionSources = Array.isArray(rec.fusionSources) ? rec.fusionSources : null;
  let sensorValue: string;
  if (fusionSources && fusionSources.length > 0) {
    // 从每个融合源提取 sourceName + trackId，组装成 "源名(trackId)" 格式，逗号分隔
    sensorValue = fusionSources
      .map((src: unknown) => {
        const s = src as Record<string, unknown>;
        const sn = String(s.sourceName ?? s.source_name ?? "").trim();
        const tid = s.trackId ?? s.track_id;
        const tidStr = tid != null ? String(tid) : "";
        return sn && tidStr ? `${sn}(${tidStr})` : sn || tidStr;
      })
      .filter(Boolean)
      .join(", ");
  } else {
    sensorValue = String(rec.sensor ?? rec.source ?? "");
  }

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
    sensor: sensorValue,
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

/** 批量规范化：WS 航迹数组 → Track[]，过滤掉无效航迹 */
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

