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
 *   - `heading` — 图标渲染航向（对海融合=course；对空=course + airIconHeadingOffsetDeg）
 *
 * 【ID 体系】
 *   - uniqueID/showID: 渲染缓存 key，全局唯一
 *   - trackId: 业务 ID，与告警匹配、处置方案关联
 *   - distinguishSeaAir 模式下：对海用 uniqueID，对空用 trackId 做告警匹配
 */

import { isVirtualFromProperties, type Track } from "@/lib/map-entity-model";
import { readRealityTypeFromRecord, resolveTrackIsVirtual } from "@/lib/track-reality-type";
import { parseForceDisposition, type ForceDisposition } from "@/lib/theme-colors";
import { getTrackRenderingConfig } from "@/lib/map-app-config";
import { resolveTrackLayerKey } from "@/lib/track-layer-visibility";
import { transformCoordinate } from "@/lib/coordinate-transform";
import {
  readTrackCategoryFromRecord,
  readClassifiedTypeFromRecord,
  resolveAirTrackIsUav,
} from "@/lib/track-category-id-parse";
import type { TrackLayerKey } from "@/lib/map-entity-model";
import { TRACK_LAYER_KEY_BY_DDS_SOURCE_ID } from "@/lib/track-layer-visibility";
import { resolveTrackLastUpdateString } from "@/lib/track-last-update-resolve";

const TRACK_LAYER_KEYS = new Set<TrackLayerKey>([
  "fuse_sea",
  "fuse_air",
  "bird_radar",
  "fanwu_car_radar",
  "radar_wharf",
  "radar_jingzi",
  "ais_track",
  "uav_pose_track",
]);

function readTrackLayerKey(rec: Record<string, unknown>): TrackLayerKey | undefined {
  const raw = rec.track_layer_key ?? rec.trackLayerKey;
  if (typeof raw !== "string") return undefined;
  const s = raw.trim().toLowerCase().replace(/-/g, "_");
  return TRACK_LAYER_KEYS.has(s as TrackLayerKey) ? (s as TrackLayerKey) : undefined;
}

/** 判断非空对象 */
function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * 读取后端 isAirTrack / is_air_track 字段
 * true→对空(air)，false→对海(sea)；缺省再信 `type`。
 * 数据传递：后端报文 → 此函数 → inferTrackSurfaceKind → Track.type
 */
/** 对空分类见 `readTrackCategoryFromRecord`（3=DDS 无人机 → isUav/图标） */

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
 * 由 DDS 来源 / track_layer_key 推断对空(air)还是对海(sea)，不依赖 `source_name` 里是否含「对空」
 * （Custombackend 对缺省 is_air_track 用 source_name 猜，DDS 常为「DDS数据源」→ 全判对海 → 全画船）。
 */
function surfaceKindFromDdsOrTrackLayerKey(rec: Record<string, unknown>): Track["type"] | undefined {
  const ddsRaw = rec.dds_source_id ?? rec.ddsSourceId;
  if (typeof ddsRaw === "string") {
    const rid = ddsRaw.trim().toLowerCase();
    const lk = TRACK_LAYER_KEY_BY_DDS_SOURCE_ID[rid];
    if (lk === "fuse_air" || lk === "bird_radar" || lk === "fanwu_car_radar" || lk === "uav_pose_track") return "air";
    if (lk === "fuse_sea" || lk === "radar_wharf" || lk === "radar_jingzi") return "sea";
  }
  const tlk = readTrackLayerKey(rec);
  if (tlk === "fuse_air" || tlk === "bird_radar" || tlk === "fanwu_car_radar" || tlk === "uav_pose_track") return "air";
  if (tlk === "fuse_sea" || tlk === "radar_wharf" || tlk === "radar_jingzi") return "sea";
  return undefined;
}

/**
 * 推断航迹类型：对空→air，对海→sea
 * 优先级：**dds_source_id / track_layer_key**（与接收器一致）→ isAirTrack → type 字段 → 默认 sea
 * 传递给 Track.type → 影响图标旋转、告警匹配、ID 截断
 */
export function inferTrackSurfaceKind(rec: Record<string, unknown>): Track["type"] {
  const fromDds = surfaceKindFromDdsOrTrackLayerKey(rec);
  if (fromDds !== undefined) return fromDds;

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
 * - 对海融合（`fuse_sea`）：真航向，正北 0° 顺时针（与 `course` 一致）
 * - 其余海面/水下：固定 0（非融合军标不旋转）
 * - 空中：原始航向 + airIconHeadingOffsetDeg（默认 45°，对齐 V2 旋转方向）
 * 数据传递：course(原始) → 此函数 → Track.heading → 地图图标 rotation
 */
export function trackIconHeadingDeg(
  kind: Track["type"],
  courseDeg: number,
  trackLayerKey?: string | null,
): number {
  const c = Number.isFinite(courseDeg) ? courseDeg : 0;
  if (kind === "air") return c + getTrackRenderingConfig().airIconHeadingOffsetDeg;
  if (kind === "sea" && trackLayerKey === "fuse_sea") return c;
  return 0;
}

/**
 * WebSocket 航迹常先发带 `trackCategoryId` 的首包，后续高频包仅更新坐标/速度。
 * 若整对象覆盖且不合并，会丢失 DDS 分类 → 无人机被误判为鸟。
 * 仅当**当前包未解析出** `trackCategoryId` 时，沿用缓存中的分类并重算 `isUav`。
 */
export function mergeIncomingTrackWithStickyAirClassification(incoming: Track, prev: Track | undefined): Track {
  let out: Track = incoming;
  if (incoming.type === "air" && prev != null && incoming.trackCategoryId === undefined && prev.trackCategoryId !== undefined) {
    out = { ...incoming, trackCategoryId: prev.trackCategoryId };
  }
  if (prev != null && out.classifiedType === undefined && prev.classifiedType !== undefined) {
    out = { ...out, classifiedType: prev.classifiedType };
  }
  if (prev != null && out.trackLayerKey === undefined && prev.trackLayerKey !== undefined) {
    out = { ...out, trackLayerKey: prev.trackLayerKey };
  }
  if (prev != null && out.ddsSourceId === undefined && prev.ddsSourceId !== undefined) {
    out = { ...out, ddsSourceId: prev.ddsSourceId };
  }
  if (prev != null && out.realityType === undefined && prev.realityType !== undefined) {
    out = { ...out, realityType: prev.realityType };
  }
  if (prev != null && out.isVirtual === undefined && prev.isVirtual === true) {
    out = { ...out, isVirtual: true };
  }
  if (out.realityType === 2) {
    out = { ...out, isVirtual: true };
  } else if (out.realityType === 1 && out.isVirtual === true) {
    const { isVirtual: _drop, ...rest } = out;
    out = rest as Track;
  }
  /** 有 dds 时以接收器为准写回 layer key（覆盖 prev 上可能错误的粘性 fuse_*） */
  if (out.ddsSourceId) {
    const lk = TRACK_LAYER_KEY_BY_DDS_SOURCE_ID[out.ddsSourceId.trim().toLowerCase()];
    if (lk) out = { ...out, trackLayerKey: lk };
  }
  /** 高频包常不带 course/heading，沿用上一帧真航向 */
  if (prev != null) {
    const oc = out.course;
    const hasCourse = typeof oc === "number" && Number.isFinite(oc);
    const pc = prev.course;
    const prevCourse = typeof pc === "number" && Number.isFinite(pc) ? pc : undefined;
    if (!hasCourse && prevCourse !== undefined) {
      out = { ...out, course: prevCourse };
    }
  }
  /**
   * 高频包常丢 `dds_source_id` / `track_layer_key`，仅靠首包里的 `is_air_track` 又易被后端填成 false
   * → 合并后按 dds/track_layer 再算一次对空/对海，与 {@link inferTrackSurfaceKind} 一致。
   */
  if (out.type !== "underwater") {
    const rec: Record<string, unknown> = {
      dds_source_id: out.ddsSourceId,
      track_layer_key: out.trackLayerKey,
      is_air_track: out.isAirTrack === true ? true : out.isAirTrack === false ? false : undefined,
      type: out.type,
    };
    const kind = inferTrackSurfaceKind(rec);
    const course = out.course ?? (kind === "air" ? getTrackRenderingConfig().airDefaultCourseDeg : 0);
    const lk = resolveTrackLayerKey(out);
    out = { ...out, type: kind, heading: trackIconHeadingDeg(kind, course, lk) };
    if (kind === "air") {
      out = { ...out, isAirTrack: true };
    } else if ("isAirTrack" in out) {
      const { isAirTrack: _drop, ...rest } = out;
      out = rest as Track;
    }
  }
  if (out.type === "air") {
    const drone = resolveAirTrackIsUav(out.classifiedType, out.trackCategoryId, out.isUav);
    if (drone) {
      out = { ...out, isUav: true };
    } else if (out.isUav && (out.classifiedType !== undefined || out.trackCategoryId !== undefined)) {
      const { isUav: _drop, ...rest } = out;
      out = rest as Track;
    }
  }
  return out;
}

/** 报文里的角度字段：排除 null/空串，避免 `Number(null)===0` 误判为有效航向 */
function toFiniteAngleDeg(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string" && raw.trim() === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 读取原始航向（course，度）。
 * 顺序：**course → cog/COG/bearing → heading_deg → azimuth → heading**（根对象与 `properties` 均扫）；
 * `heading` 置后，避免 DDS 占位 0 盖住真 `cog`。
 */
function readCourseDeg(rec: Record<string, unknown>, kind: Track["type"]): number {
  const keys = ["course", "cog", "COG", "bearing", "heading_deg", "azimuth", "heading"] as const;
  const bags: Array<Record<string, unknown> | null | undefined> = [rec, asRecord(rec.properties)];
  for (const bag of bags) {
    if (!bag) continue;
    for (const k of keys) {
      const v = toFiniteAngleDeg(bag[k]);
      if (v !== undefined) return v;
    }
  }
  return kindDefaultCourse(kind);
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
  const u =
    rec.uniqueID ??
    rec.uniqueId ??
    rec.unique_id ??
    rec.target_id ??
    rec.targetId;
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
 *   - trackIdStr: 业务 track_id（external_target_id），无人机任务等；告警/相机用 uniqueID(target_id)
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
  const disposition = readDisposition(rec);

  const speed = Number(rec.speed ?? rec.speed_ms ?? 0);
  const altRaw = rec.altitude ?? rec.alt ?? rec.height;
  const altitude = altRaw != null && Number.isFinite(Number(altRaw)) ? Number(altRaw) : undefined;

  const propBag: Record<string, unknown> = { ...(asRecord(rec.properties) ?? {}) };
  if (rec.virtualTroop !== undefined) propBag.virtualTroop = rec.virtualTroop;
  if (rec.virtual_troop !== undefined) propBag.virtual_troop = rec.virtual_troop;
  const realityType = readRealityTypeFromRecord(rec);
  const rootVirtualRaw = rec.is_virtual ?? rec.isVirtual ?? rec.virtual_troop ?? rec.virtualTroop;
  const rootVirtual =
    rootVirtualRaw === true ||
    rootVirtualRaw === 1 ||
    (typeof rootVirtualRaw === "string" && /^(1|true|yes|virtual)$/i.test(String(rootVirtualRaw).trim()));
  const isVirtual = resolveTrackIsVirtual(realityType, propBag, rootVirtual);
  const rawUav = rec.is_uav ?? rec.isUav ?? rec.uav;
  let isUav =
    rawUav === true ||
    rawUav === 1 ||
    (typeof rawUav === "string" && /^(1|true|yes|uav)$/i.test(rawUav.trim()));

  const trackCategoryId = readTrackCategoryFromRecord(rec);
  const classifiedType = readClassifiedTypeFromRecord(rec);
  if (kind === "air") {
    isUav = resolveAirTrackIsUav(
      classifiedType,
      trackCategoryId,
      isUav,
    );
  }

  const isAirTrack = kind === "air";

  const trackId = rec.trackId ?? rec.track_id ?? rec.tracnID;
  const trackIdStr = trackId != null && String(trackId).trim() !== "" ? String(trackId).trim() : undefined;

  const aliasRaw = rec.trackAlias ?? rec.track_alias;
  const trackAliasStr =
    aliasRaw != null && String(aliasRaw).trim() !== "" ? String(aliasRaw).trim() : undefined;

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

  const ddsSrcRaw = rec.dds_source_id ?? rec.ddsSourceId;
  const ddsSourceIdStr =
    ddsSrcRaw != null && String(ddsSrcRaw).trim() !== "" ? String(ddsSrcRaw).trim() : undefined;

  const tlkPayload = readTrackLayerKey(rec);
  const ddsLower = ddsSourceIdStr?.trim().toLowerCase();
  const tlkFromDds = ddsLower && TRACK_LAYER_KEY_BY_DDS_SOURCE_ID[ddsLower] ? TRACK_LAYER_KEY_BY_DDS_SOURCE_ID[ddsLower] : undefined;
  const resolvedTrackLayerKey = tlkFromDds ?? tlkPayload;

  const heading = trackIconHeadingDeg(
    kind,
    course,
    resolvedTrackLayerKey ??
      (kind === "air"
        ? "fuse_air"
        : kind === "sea"
          ? "fuse_sea"
          : undefined),
  );

  return {
    id: showID,
    showID,
    uniqueID,
    ...(trackIdStr ? { trackId: trackIdStr } : {}),
    ...(trackAliasStr ? { trackAlias: trackAliasStr } : {}),
    name: String(rec.name ?? rec.label ?? showID),
    type: kind,
    disposition,
    lat,
    lng,
    altitude,
    heading,
    speed: Number.isFinite(speed) ? speed : 0,
    sensor: sensorValue,
    lastUpdate: resolveTrackLastUpdateString(rec),
    starred: Boolean(rec.starred),
    ...(isAirTrack ? { isAirTrack: true } : {}),
    ...(targetTypeStr ? { targetType: targetTypeStr } : {}),
    ...(Number.isFinite(course) ? { course } : {}),
    ...(azimuth != null ? { azimuth } : {}),
    ...(distance != null ? { distance } : {}),
    ...(dataSourceIdStr ? { dataSourceId: dataSourceIdStr } : {}),
    ...(ddsSourceIdStr ? { ddsSourceId: ddsSourceIdStr } : {}),
    ...(resolvedTrackLayerKey ? { trackLayerKey: resolvedTrackLayerKey } : {}),
    ...(realityType !== undefined ? { realityType } : {}),
    ...(isVirtual ? { isVirtual: true } : {}),
    ...(isUav ? { isUav: true } : {}),
    ...(trackCategoryId !== undefined ? { trackCategoryId } : {}),
    ...(classifiedType !== undefined ? { classifiedType } : {}),
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

