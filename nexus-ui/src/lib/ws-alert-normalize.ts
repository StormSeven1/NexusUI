/**
 * 将后端 / V2（AlertWindow、MCP `map_command` alert、V2 `Alarm`）多种字段形态规范为 `AlertData`。
 */

import type { AlertData } from "@/stores/alert-store";
import { parseAlarmFuseTypeFromRaw } from "@/lib/alarm-track-match";

const NM_PER_METRE = 1 / 1852;

function parseFiniteNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : undefined;
}

/** 告警 WS 体中的距离（海里）与方位（度） */
function parseAlarmDistanceBearing(o: Record<string, unknown>): {
  distanceNm?: number;
  bearingDeg?: number;
} {
  const nmKeys = ["distanceNm", "distance_nm", "distanceNauticalMiles", "rangeNm", "range_nm"] as const;
  for (const k of nmKeys) {
    const n = parseFiniteNumber(o[k]);
    if (n != null) return { distanceNm: n, bearingDeg: parseAlarmBearingOnly(o) };
  }

  const metreKeys = ["rangeMetres", "range_metres", "rangeMeters", "distance_m", "distanceM"] as const;
  for (const k of metreKeys) {
    const m = parseFiniteNumber(o[k]);
    if (m != null) return { distanceNm: m * NM_PER_METRE, bearingDeg: parseAlarmBearingOnly(o) };
  }

  const genericDist = parseFiniteNumber(o.distance ?? o.range);
  if (genericDist != null) {
    /** 与航迹 WS 一致：`range`/`distance` 按米 */
    return { distanceNm: genericDist * NM_PER_METRE, bearingDeg: parseAlarmBearingOnly(o) };
  }

  return { bearingDeg: parseAlarmBearingOnly(o) };
}

function parseAlarmBearingOnly(o: Record<string, unknown>): number | undefined {
  const keys = [
    "azimuthDegrees",
    "azimuth_degrees",
    "azimuth",
    "bearing",
    "bearingDeg",
    "bearing_deg",
    "course",
    "cog",
    "COG",
  ] as const;
  for (const k of keys) {
    const n = parseFiniteNumber(o[k]);
    if (n != null) return ((n % 360) + 360) % 360;
  }
  return undefined;
}

function isoNow() {
  return new Date().toISOString();
}

function newAlertId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `al_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** V2 `alert_type` / 通用 `severity` / 告警等级 → store 用的三档
 *
 * 注意两套数值语义：
 * - ThreatLevel 枚举（NewTrackStruct）：0=LOW / 1=MEDIUM / 2=HIGH
 * - 威胁分 threatScore（AlarmEvent DDS）：约 0~100
 * 旧逻辑把数字统一按「≥3 严重」，导致枚举 HIGH(2) 变成「警告」，
 * 与 DDS 威胁分（常≥20→严重）交替覆盖同一航迹，界面严重/警告闪烁。
 */
export function wsAlertTypeToSeverity(
  raw: string | number | undefined | null,
): "critical" | "warning" | "info" {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const n = Math.trunc(raw);
    // ThreatLevel 枚举（仅 0/1/2）— NewTrackStruct / gRPC
    if (n === 0) return "info";
    if (n === 1) return "warning";
    if (n === 2) return "critical";
    // 威胁分（AlarmEvent DDS alarmLevel=threatScore）：沿用原阈值，≥3 即严重
    if (n >= 3) return "critical";
    return "info";
  }
  const t = String(raw ?? "info").trim().toLowerCase();
  if (t === "critical" || t === "high" || t === "severe" || t === "fatal") return "critical";
  if (t === "error" || t === "warning" || t === "warn" || t === "medium") return "warning";
  if (t === "low" || t === "info") return "info";
  return "info";
}

/** 从原始告警对象解析严重度：优先显式 severity 字符串，再 threatScore / alarmLevel */
function resolveSeverityFromRaw(o: Record<string, unknown>): "critical" | "warning" | "info" {
  const strRaw =
    (typeof o.severity === "string" && o.severity.trim()) ||
    (typeof o.alert_type === "string" && o.alert_type.trim()) ||
    (typeof o.alertType === "string" && o.alertType.trim()) ||
    "";
  if (strRaw) {
    const mapped = wsAlertTypeToSeverity(strRaw);
    // 显式 critical/warning/info/high/medium/low 直接采用
    const t = strRaw.toLowerCase();
    if (
      t === "critical" || t === "high" || t === "severe" || t === "fatal" ||
      t === "warning" || t === "warn" || t === "medium" || t === "error" ||
      t === "low" || t === "info"
    ) {
      return mapped;
    }
  }

  const threatScoreRaw = o.threatScore ?? o.threat_score;
  const threatScore =
    typeof threatScoreRaw === "number" && Number.isFinite(threatScoreRaw)
      ? threatScoreRaw
      : typeof threatScoreRaw === "string" && threatScoreRaw.trim()
        ? Number(threatScoreRaw.trim())
        : undefined;

  const alarmLevelRaw = o.alarmLevel ?? o.alarm_level ?? o.level;
  const alarmLevel =
    typeof alarmLevelRaw === "number" && Number.isFinite(alarmLevelRaw)
      ? alarmLevelRaw
      : typeof alarmLevelRaw === "string" && /^-?\d+$/.test(alarmLevelRaw.trim())
        ? Number(alarmLevelRaw.trim())
        : undefined;

  // threatScore>2 → AlarmEvent 威胁分（稳定）；勿被每秒重算的 Top5 alarmLevel(0↔5) 覆盖
  if (threatScore != null && Number.isFinite(threatScore) && threatScore > 2) {
    return wsAlertTypeToSeverity(threatScore);
  }
  // alarmLevel 仅在明确是 ThreatLevel 枚举 0/1/2 时使用；≥3 视为威胁分排名残留
  if (alarmLevel != null && Number.isFinite(alarmLevel)) {
    const n = Math.trunc(alarmLevel);
    if (n === 0 || n === 1 || n === 2) {
      return wsAlertTypeToSeverity(n);
    }
    if (n >= 3) {
      return "critical";
    }
  }
  if (threatScore != null && Number.isFinite(threatScore)) {
    return wsAlertTypeToSeverity(threatScore);
  }
  return "info";
}

/** 单条 WS 对象 → `AlertData`；无法解析时返回 null */
export function normalizeWsAlertItem(raw: unknown): AlertData | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const title = typeof o.title === "string" ? o.title.trim() : "";
  const evidenceContent =
    typeof o.content === "string" && o.content.trim() ? o.content.trim() : undefined;
  const body =
    (typeof o.message === "string" && o.message) ||
    (typeof o.alarmContent === "string" && o.alarmContent) ||
    (typeof o.alarmMessage === "string" && o.alarmMessage) ||
    (typeof o.body === "string" && o.body) ||
    (typeof o.text === "string" && o.text) ||
    "";

  const severity = resolveSeverityFromRaw(o);

  const idRaw = o.id ?? o.alarmId ?? o.alert_id ?? o.alertId ?? o.eventId;
  const id =
    typeof idRaw === "string" && idRaw.trim()
      ? idRaw.trim()
      : typeof idRaw === "number" && Number.isFinite(idRaw)
        ? String(idRaw)
        : newAlertId();

  const tsRaw = o.timestamp ?? o.updateTime ?? o.time ?? o.created_at ?? o.createdAt;
  const timestamp =
    typeof tsRaw === "string" && tsRaw.trim()
      ? tsRaw.trim()
      : typeof tsRaw === "number" && Number.isFinite(tsRaw)
        ? new Date(tsRaw).toISOString()
        : isoNow();

  let trackId: string | undefined;
  const trackRawTop =
    o.targetId ??
    o.target_id ??
    o.uniqueID ??
    o.uniqueId ??
    o.unique_id ??
    o.trackId ??
    o.track_id ??
    o.tid ??
    o.trackID;
  if (typeof trackRawTop === "string" && trackRawTop.trim()) {
    trackId = trackRawTop.trim();
  } else if (typeof trackRawTop === "number" && Number.isFinite(trackRawTop) && trackRawTop > 0) {
    trackId = String(trackRawTop);
  }

  const nestedTrack = o.track;
  if (!trackId && nestedTrack && typeof nestedTrack === "object" && !Array.isArray(nestedTrack)) {
    const tr = nestedTrack as Record<string, unknown>;
    const tid =
      tr.targetId ??
      tr.target_id ??
      tr.uniqueID ??
      tr.uniqueId ??
      tr.unique_id ??
      tr.trackId ??
      tr.track_id ??
      tr.id;
    if (typeof tid === "string" && tid.trim()) trackId = tid.trim();
    else if (typeof tid === "number" && Number.isFinite(tid) && tid > 0) trackId = String(tid);
  }

  const message =
    title && body
      ? `${title}: ${body}`
      : title ||
        body ||
        (typeof o.msg === "string" ? o.msg : "") ||
        (trackId ? "航迹告警" : "");
  if (!message && !evidenceContent) return null;

  let lat: number | undefined;
  let lng: number | undefined;

  // V2 嵌套 position: { longitude, latitude }
  const pos = o.position;
  if (pos && typeof pos === "object" && !Array.isArray(pos)) {
    const P = pos as Record<string, unknown>;
    const pLa = P.latitude ?? P.lat;
    const pLn = P.longitude ?? P.lng ?? P.lon;
    if (pLa != null && pLn != null) {
      lat = Number(pLa);
      lng = Number(pLn);
    }
  }

  // 通用 location
  const loc = o.location;
  if (Array.isArray(loc) && loc.length >= 2) {
    lng = Number(loc[0]);
    lat = Number(loc[1]);
  } else if (loc && typeof loc === "object") {
    const L = loc as Record<string, unknown>;
    const la = L.lat ?? L.latitude;
    const ln = L.lng ?? L.longitude ?? L.lon;
    if (la != null && ln != null) {
      lat = Number(la);
      lng = Number(ln);
    }
  }
  if (o.lat != null && o.lng != null) {
    lat = Number(o.lat);
    lng = Number(o.lng);
  }

  if (
    nestedTrack &&
    typeof nestedTrack === "object" &&
    !Array.isArray(nestedTrack) &&
    (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng))
  ) {
    const tr = nestedTrack as Record<string, unknown>;
    const pLa = tr.latitude ?? tr.lat;
    const pLn = tr.longitude ?? tr.lng ?? tr.lon;
    if (pLa != null && pLn != null) {
      lat = Number(pLa);
      lng = Number(pLn);
    }
  }

  const type =
    typeof o.type === "string" && o.type !== "map_command" && o.type !== "alert_batch" && o.type !== "Alarm"
      ? o.type
      : undefined;

  /** 勿用通用字符串 `level`（常为 severity），仅取数值型告警等级 */
  const alarmLevelRaw = o.alarmLevel ?? o.alarm_level;
  let alarmLevel: number | undefined;
  if (typeof alarmLevelRaw === "number" && Number.isFinite(alarmLevelRaw)) {
    alarmLevel = alarmLevelRaw;
  } else if (typeof alarmLevelRaw === "string" && /^\d+$/.test(alarmLevelRaw.trim())) {
    alarmLevel = Number(alarmLevelRaw.trim());
  } else if (typeof o.level === "number" && Number.isFinite(o.level)) {
    alarmLevel = o.level;
  }

  const threatScoreRaw =
    o.threatScore ?? o.threat_score ?? o.threatcontent ?? o.threat_content;
  let threatScore: number | undefined;
  if (typeof threatScoreRaw === "number" && Number.isFinite(threatScoreRaw)) {
    threatScore = threatScoreRaw;
  } else if (typeof threatScoreRaw === "string" && threatScoreRaw.trim()) {
    const n = Number(threatScoreRaw.trim());
    if (Number.isFinite(n)) threatScore = n;
  }
  if (threatScore == null && alarmLevel != null && Number.isFinite(alarmLevel) && alarmLevel > 5) {
    // 仅当 alarmLevel 明显是威胁分（非 Top5 排名 0~5）时回填
    threatScore = alarmLevel;
  }

  const source =
    typeof o.source === "string"
      ? o.source
      : typeof o.dataSource === "string"
        ? o.dataSource
        : typeof o.sensor === "string"
          ? o.sensor
          : undefined;

  const areaName =
    typeof o.areaName === "string" && o.areaName.trim()
      ? o.areaName.trim()
      : typeof o.area_name === "string" && o.area_name.trim()
        ? o.area_name.trim()
        : typeof o.zoneName === "string" && o.zoneName.trim()
          ? o.zoneName.trim()
          : undefined;

  const areaJudgeRaw = o.area_judge ?? o.areaJudge ?? o.area_judge_type;
  let areaJudge: string | undefined;
  if (typeof areaJudgeRaw === "string" && areaJudgeRaw.trim()) {
    areaJudge = areaJudgeRaw.trim();
  } else {
    const j = parseFiniteNumber(areaJudgeRaw);
    if (j != null) {
      const judgeMap: Record<number, string> = {
        1: "区域内",
        2: "离开",
        3: "靠近",
        4: "进入",
      };
      areaJudge = judgeMap[Math.trunc(j)];
    }
  }

  const uniqueIDRaw = o.uniqueID ?? o.uniqueId ?? o.unique_id ?? o.targetId ?? o.target_id ?? o.showID;
  let uniqueID: string | undefined;
  if (typeof uniqueIDRaw === "string" && uniqueIDRaw.trim()) {
    uniqueID = uniqueIDRaw.trim();
  } else if (typeof uniqueIDRaw === "number" && Number.isFinite(uniqueIDRaw) && uniqueIDRaw > 0) {
    uniqueID = String(uniqueIDRaw);
  }
  if (!uniqueID && trackId) {
    uniqueID = trackId;
  }

  const fuseTypeRaw = o.fuseType ?? o.fuse_type;
  const fuseType =
    fuseTypeRaw === 0 || fuseTypeRaw === 1
      ? fuseTypeRaw
      : fuseTypeRaw === "0" || fuseTypeRaw === "1"
        ? (Number(fuseTypeRaw) as 0 | 1)
        : parseAlarmFuseTypeFromRaw(o);

  const detail =
    typeof o.detail === "string"
      ? o.detail
      : typeof o.description === "string"
        ? o.description
        : typeof o.extra === "string"
          ? o.extra
          : undefined;

  let { distanceNm, bearingDeg } = parseAlarmDistanceBearing(o);
  const targetDistNm = parseFiniteNumber(o.targetdist ?? o.target_dist ?? o.targetDist);
  if (distanceNm == null && targetDistNm != null) distanceNm = targetDistNm;
  const targetDir = parseFiniteNumber(o.targetdir ?? o.target_dir ?? o.targetDir);
  if (bearingDeg == null && targetDir != null) bearingDeg = ((targetDir % 360) + 360) % 360;

  const out: AlertData = {
    id,
    severity,
    message,
    timestamp,
    ...(title ? { title } : {}),
    ...(trackId ? { trackId } : {}),
    ...(lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {}),
    ...(type ? { type } : {}),
    ...(alarmLevel != null && Number.isFinite(alarmLevel) ? { alarmLevel } : {}),
    ...(threatScore != null && Number.isFinite(threatScore) ? { threatScore } : {}),
    ...(source ? { source } : {}),
    ...(areaName ? { areaName } : {}),
    ...(areaJudge ? { areaJudge } : {}),
    ...(uniqueID ? { uniqueID } : {}),
    ...(fuseType === 0 || fuseType === 1 ? { fuseType } : {}),
    ...(detail ? { detail } : {}),
    ...(evidenceContent ? { content: evidenceContent } : {}),
    ...(distanceNm != null ? { distanceNm } : {}),
    ...(bearingDeg != null ? { bearingDeg } : {}),
  };
  return out;
}

export function normalizeWsAlertList(list: unknown[] | undefined | null): AlertData[] {
  if (!Array.isArray(list)) return [];
  const out: AlertData[] = [];
  for (const item of list) {
    const n = normalizeWsAlertItem(item);
    if (n) out.push(n);
  }
  return out;
}
