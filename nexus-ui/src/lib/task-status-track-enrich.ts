import type { Track, TrackFusionSourceItem } from "@/lib/map-entity-model";
import { getTrackIdModeConfig } from "@/lib/map-app-config";
import {
  isSelfReportFusionSourceItem,
  resolveCamServerSelfPosMapId,
  trackHasSelfReportSource,
} from "@/lib/map-gis-camera-task";
import type { TaskStatusChatPayload } from "@/lib/task-status-types";
import { STABLE_TARGET_ID_THRESHOLD } from "@/lib/task-status-verify-target-id";
import { resolveTrackLayerKey } from "@/lib/track-layer-visibility";
import type { AlertData } from "@/stores/alert-store";
import { useAlertStore } from "@/stores/alert-store";
import { useTrackStore } from "@/stores/track-store";

const NM_PER_METRE = 1 / 1852;

function normLookupId(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.trunc(n);
}

function isLikelySelfReportLocalId(id: number): boolean {
  return id > 0 && id < STABLE_TARGET_ID_THRESHOLD;
}

function fusionSourceHasSelfReportLocalId(
  item: TrackFusionSourceItem,
  selfPosId: number,
): boolean {
  if (!isSelfReportFusionSourceItem(item)) return false;
  const tid = String(selfPosId);
  for (const raw of [item.trackId, item.externalTrackId]) {
    if (String(raw ?? "").trim() === tid) return true;
  }
  return false;
}

function trackMatchesSelfReportLocalId(track: Track, selfPosId: number): boolean {
  const resolved = resolveCamServerSelfPosMapId(track);
  if (resolved === selfPosId) return true;

  const tid = String(selfPosId);
  for (const raw of [
    track.externalTargetId,
    track.trackId,
    track.uniqueID,
    track.showID,
    track.id,
  ]) {
    if (String(raw ?? "").trim() === tid) return true;
  }

  const sensor = String(track.sensor ?? "");
  if (sensor.includes("自报位") && sensor.includes(`(${tid})`)) return true;

  return (track.fusionSources ?? []).some((s) => fusionSourceHasSelfReportLocalId(s, selfPosId));
}

function findDirectTrackForVerifyId(
  targetOrTrackId: number,
  tracks: readonly Track[],
): Track | undefined {
  const tid = String(targetOrTrackId);

  for (const t of tracks) {
    if (t.uniqueID === tid || t.showID === tid) return t;
  }

  const distinguish = getTrackIdModeConfig().distinguishSeaAir;
  for (const t of tracks) {
    if (distinguish) {
      const isAir = t.isAirTrack === true;
      const key = isAir ? t.trackId : t.uniqueID;
      if (key != null && String(key) === tid) return t;
    } else if (t.trackId === tid) {
      return t;
    }
  }
  for (const t of tracks) {
    if (t.trackId === tid) return t;
  }
  return undefined;
}

/**
 * 自报位本地号（如 4001）：优先独立自报位层，再含该源的融合航迹。
 */
function findTrackBySelfReportLocalId(
  selfPosId: number,
  tracks: readonly Track[],
): Track | undefined {
  for (const t of tracks) {
    const lk = resolveTrackLayerKey(t);
    if (lk !== "uav_pose_track" && lk !== "boat_self_track") continue;
    if (trackMatchesSelfReportLocalId(t, selfPosId)) return t;
  }

  for (const t of tracks) {
    if (resolveCamServerSelfPosMapId(t) === selfPosId) return t;
  }

  let seaHit: Track | undefined;
  let otherHit: Track | undefined;
  for (const t of tracks) {
    if (!(t.fusionSources ?? []).some((s) => fusionSourceHasSelfReportLocalId(s, selfPosId))) {
      continue;
    }
    const lk = resolveTrackLayerKey(t);
    if (lk === "fuse_air") return t;
    if (lk === "fuse_sea") {
      if (!seaHit) seaHit = t;
      continue;
    }
    if (!otherHit) otherHit = t;
  }
  return seaHit ?? otherHit;
}

/**
 * 用 HTTP 下发的 `target_id`（或 legacy `trackID`）在内存航迹中查找。
 * 新 DDS：`target_id` 与 `uniqueID` / `showID` 对齐，优先按此匹配；
 * 若为自报位本地号（&lt;100000），再按自报位层 / fusionSources.zibaowei 匹配。
 */
export function findTrackForTaskStatusVerify(
  targetOrTrackId: number | undefined | null,
  tracks: readonly Track[],
): Track | undefined {
  if (targetOrTrackId == null || !Number.isFinite(Number(targetOrTrackId))) return undefined;
  const id = Math.trunc(Number(targetOrTrackId));
  if (id <= 0) return undefined;

  const direct = findDirectTrackForVerifyId(id, tracks);
  if (direct) return direct;

  if (isLikelySelfReportLocalId(id)) {
    return findTrackBySelfReportLocalId(id, tracks);
  }
  return undefined;
}

function pickShipArchiveFromAlerts(trackID: number | undefined | null, alerts: readonly AlertData[]): string | undefined {
  if (trackID == null || !Number.isFinite(Number(trackID))) return undefined;
  const tid = String(trackID);
  for (const a of alerts) {
    const aTid = a.trackId?.trim();
    const uid = a.uniqueID?.trim();
    if (aTid === tid || uid === tid) {
      const d = a.detail?.trim();
      if (d) return d;
      const m = a.message?.trim();
      if (m && m.length > 2) return m;
    }
  }
  return undefined;
}

function collectVerifyLookupIds(base: TaskStatusChatPayload): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of [base.verifyTargetId, base.uniqueId, base.trackID]) {
    const n = normLookupId(raw);
    if (n == null || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function selfReportArchiveLabel(track: Track, lookupId: number): string {
  const name = track.name?.trim() || track.trackAlias?.trim();
  if (name) return name;
  const sensor = String(track.sensor ?? "").trim();
  if (sensor.includes("自报位")) return sensor;
  return `自报位(${lookupId})`;
}

/**
 * 查证横幅：HTTP 体已有字段优先；否则用当前 `track-store` / `alert-store` 补齐，
 * 与 Qt 从内存航迹取 `latDegs/longDegs/rangeMetres/...` 一致。
 * 自报位本地号（4001 等）可匹配独立自报位航迹或融合源中的自报位分量。
 */
export function enrichTaskStatusPayloadForVerifyUi(base: TaskStatusChatPayload): TaskStatusChatPayload {
  const tracks = useTrackStore.getState().tracks;
  const alerts = useAlertStore.getState().alerts;
  const lookupIds = collectVerifyLookupIds(base);

  let track: Track | undefined;
  let matchedLookupId: number | undefined;
  for (const id of lookupIds) {
    track = findTrackForTaskStatusVerify(id, tracks);
    if (track) {
      matchedLookupId = id;
      break;
    }
  }

  const alertLookupId = matchedLookupId ?? lookupIds[0];
  const fromAlert = pickShipArchiveFromAlerts(alertLookupId, alerts);

  const out: TaskStatusChatPayload = { ...base };

  if (track) {
    if (out.longitudeDeg == null && Number.isFinite(track.lng)) out.longitudeDeg = track.lng;
    if (out.latitudeDeg == null && Number.isFinite(track.lat)) out.latitudeDeg = track.lat;
    if (out.azimuthDegrees == null) {
      const a = track.azimuth ?? track.course ?? track.heading;
      if (a != null && Number.isFinite(a)) out.azimuthDegrees = a;
    }
    if (out.speedMps == null && Number.isFinite(track.speed)) out.speedMps = track.speed;
    if (out.distanceNm == null && track.distance != null && Number.isFinite(track.distance)) {
      /** 与 Qt `rangeMetres / 1852`；WS `range`/`distance` 按米与融合后端对齐 */
      out.distanceNm = track.distance * NM_PER_METRE;
    }
    if (!out.shipArchiveInfo?.trim()) {
      const isSelf =
        (matchedLookupId != null && isLikelySelfReportLocalId(matchedLookupId)) ||
        trackHasSelfReportSource(track);
      if (isSelf && matchedLookupId != null) {
        out.shipArchiveInfo = selfReportArchiveLabel(track, matchedLookupId);
      }
    }
  }
  if (!out.shipArchiveInfo?.trim() && fromAlert?.trim()) {
    out.shipArchiveInfo = fromAlert.trim();
  }
  /** 仅有自报位号、态势暂无航迹时，至少标出自报位，避免「船舶档案」全空 */
  if (
    !out.shipArchiveInfo?.trim() &&
    matchedLookupId == null &&
    lookupIds.some(isLikelySelfReportLocalId)
  ) {
    const id = lookupIds.find(isLikelySelfReportLocalId)!;
    out.shipArchiveInfo = `自报位(${id})`;
  }
  return out;
}
