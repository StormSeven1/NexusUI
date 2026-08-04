/**
 * 告警 ↔ 航迹匹配键（解决对海/对空融合共用同一 trackId 时双蓝问题）。
 *
 * 键格式：
 * - `u:{uniqueID}` — 告警带 unique_id 时精确匹配 showID
 * - `t:0:{trackId}` — 对海融合（AlarmSys track_type=0 / DDS TrackType::FUSE）
 * - `t:1:{trackId}` — 对空融合（track_type>0 / TrackType::BIRD）
 * - `t:*:{trackId}` — 无 fuse 信息时的兜底（仅当场上仅一条该 trackId 时匹配）
 */

import type { AlertData } from "@/stores/alert-store";
import type { Track } from "@/lib/map-entity-model";
import type { AlarmFilterFuseType } from "@/lib/alarm-filter-api";
import { getTrackIdModeConfig } from "@/lib/map-app-config";
import { getRenderCache } from "@/stores/track-store";
import { isSuspiciousAlarmMarker } from "@/lib/suspicious-alarm-marker";

/** 从告警 WS 体解析对海(0)/对空(1)；无法判断时返回 undefined */
export function parseAlarmFuseTypeFromRaw(o: Record<string, unknown>): AlarmFilterFuseType | undefined {
  const top = o.fuseType ?? o.fuse_type ?? o.track_fuse_type ?? o.fuse_type_hint;
  if (top === 0 || top === 1) return top;
  if (top === "0" || top === "1") return Number(top) as AlarmFilterFuseType;

  const nested = o.track;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return undefined;
  const tr = nested as Record<string, unknown>;
  const tt = tr.trackType ?? tr.track_type;
  if (typeof tt === "string") {
    const u = tt.trim().toUpperCase();
    if (u === "BIRD" || u === "FUSE_AIR" || u === "AIR") return 1;
    if (u === "FUSE" || u === "FUSE_SEA" || u === "SEA") return 0;
  }
  if (typeof tt === "number" && Number.isFinite(tt)) {
    const n = Math.trunc(tt);
    if (n === 1) return 1;
    if (n === 0) return 0;
  }
  return undefined;
}

export function fuseTypeFromTrack(track: Track): AlarmFilterFuseType {
  return track.isAirTrack === true ? 1 : 0;
}

/** 告警条目对海(0)/对空(1)；非航迹告警或无法判断时返回 undefined */
export function resolveAlertFuseType(
  alert: Pick<AlertData, "trackId" | "uniqueID" | "fuseType">,
  shadowTracks: ReadonlyMap<string, Track>,
): AlarmFilterFuseType | undefined {
  if (!trimId(alert.trackId) && !trimId(alert.uniqueID)) return undefined;
  if (alert.fuseType === 0 || alert.fuseType === 1) return alert.fuseType;
  const showId = resolveShowIdFromAlarm(alert, shadowTracks);
  if (!showId) return undefined;
  const track = getRenderCache().get(showId) ?? shadowTracks.get(showId);
  if (track) return fuseTypeFromTrack(track);
  return undefined;
}

function trimId(v: string | undefined | null): string {
  return v != null ? String(v).trim() : "";
}

/** 由当前告警列表生成匹配键集合（写入 alert-store.alarmTrackIds） */
export function buildAlarmMatchKeysFromAlerts(alerts: readonly AlertData[]): Set<string> {
  const keys = new Set<string>();
  for (const a of alerts) {
    // 可疑标记不得参与威胁蓝匹配
    if (isSuspiciousAlarmMarker(a as unknown as Record<string, unknown>)) continue;
    const uid = trimId(a.uniqueID);
    if (uid) keys.add(`u:${uid}`);

    const tid = trimId(a.trackId);
    if (!tid) continue;

    if (a.fuseType === 0 || a.fuseType === 1) {
      keys.add(`t:${a.fuseType}:${tid}`);
    } else {
      keys.add(`t:*:${tid}`);
    }
  }
  return keys;
}

function collectTracksWithBusinessId(trackId: string, shadowTracks: ReadonlyMap<string, Track>): Track[] {
  const tid = trackId.trim();
  if (!tid) return [];
  const out: Track[] = [];
  const seen = new Set<string>();
  const push = (t: Track) => {
    if (!t.trackId || String(t.trackId).trim() !== tid) return;
    if (seen.has(t.showID)) return;
    seen.add(t.showID);
    out.push(t);
  };
  for (const t of getRenderCache().values()) push(t);
  for (const t of shadowTracks.values()) push(t);
  return out;
}

function isOnlyTrackWithBusinessId(
  track: Track,
  trackId: string,
  shadowTracks: ReadonlyMap<string, Track>,
): boolean {
  const hits = collectTracksWithBusinessId(trackId, shadowTracks);
  return hits.length === 1 && hits[0]!.showID === track.showID;
}

/**
 * 航迹是否匹配当前告警键集合。
 * @param shadowTracks 可选；用于 `t:*` 单条兜底与 28.9 模式解析
 */
export function isTrackMatchedByAlarmKeys(
  track: Track,
  keys: Set<string>,
  shadowTracks?: ReadonlyMap<string, Track>,
): boolean {
  if (getTrackIdModeConfig().distinguishSeaAir) {
    const isAir = track.isAirTrack === true;
    const matchKey = isAir ? track.trackId : track.uniqueID;
    return matchKey != null && keys.has(String(matchKey));
  }

  const shadow = shadowTracks ?? new Map<string, Track>();

  const uid = trimId(track.uniqueID) || trimId(track.showID);
  if (uid && keys.has(`u:${uid}`)) return true;

  const tid = trimId(track.trackId);
  if (!tid) return false;

  const fuse = fuseTypeFromTrack(track);
  if (keys.has(`t:${fuse}:${tid}`)) return true;

  if (keys.has(`t:*:${tid}`) && isOnlyTrackWithBusinessId(track, tid, shadow)) return true;

  /** 兼容旧 alarmTrackIds 仅存裸 trackId：仅单条同号航迹时匹配 */
  if (keys.has(tid) && isOnlyTrackWithBusinessId(track, tid, shadow)) return true;

  return false;
}

/** 告警 trackId → showID（渲染层优先；多候选时按 fuseType / uniqueID） */
export function resolveShowIdFromAlarm(
  alert: Pick<AlertData, "trackId" | "uniqueID" | "fuseType">,
  shadowTracks: ReadonlyMap<string, Track>,
): string | null {
  const uid = trimId(alert.uniqueID);
  if (uid) {
    if (getRenderCache().has(uid) || shadowTracks.has(uid)) return uid;
  }

  const tid = trimId(alert.trackId);
  if (!tid) return null;

  if (getRenderCache().has(tid) || shadowTracks.has(tid)) return tid;
  for (const t of getRenderCache().values()) {
    if (trimId(t.uniqueID) === tid || trimId(t.showID) === tid) return t.showID;
  }
  for (const t of shadowTracks.values()) {
    if (trimId(t.uniqueID) === tid || trimId(t.showID) === tid) return t.showID;
  }

  if (getTrackIdModeConfig().distinguishSeaAir) {
    for (const t of getRenderCache().values()) {
      if (t.trackId === tid) return t.showID;
    }
    for (const t of shadowTracks.values()) {
      if (t.trackId === tid) return t.showID;
    }
    return null;
  }

  if (alert.fuseType === 0 || alert.fuseType === 1) {
    const wantAir = alert.fuseType === 1;
    for (const t of getRenderCache().values()) {
      if (t.trackId === tid && (t.isAirTrack === true) === wantAir) return t.showID;
    }
    for (const t of shadowTracks.values()) {
      if (t.trackId === tid && (t.isAirTrack === true) === wantAir) return t.showID;
    }
    return null;
  }

  const hits = collectTracksWithBusinessId(tid, shadowTracks);
  if (hits.length === 1) return hits[0]!.showID;
  return null;
}
