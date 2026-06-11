import type { Track } from "@/lib/map-entity-model";
import { getTrackIdModeConfig } from "@/lib/map-app-config";
import type { TaskStatusChatPayload } from "@/lib/task-status-types";
import type { AlertData } from "@/stores/alert-store";
import { useAlertStore } from "@/stores/alert-store";
import { useTrackStore } from "@/stores/track-store";

const NM_PER_METRE = 1 / 1852;

/**
 * 用 HTTP 下发的 `target_id`（或 legacy `trackID`）在内存航迹中查找。
 * 新 DDS：`target_id` 与 `uniqueID` / `showID` 对齐，优先按此匹配。
 */
export function findTrackForTaskStatusVerify(
  targetOrTrackId: number | undefined | null,
  tracks: readonly Track[],
): Track | undefined {
  if (targetOrTrackId == null || !Number.isFinite(Number(targetOrTrackId))) return undefined;
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

/**
 * 查证横幅：HTTP 体已有字段优先；否则用当前 `track-store` / `alert-store` 补齐，
 * 与 Qt 从内存航迹取 `latDegs/longDegs/rangeMetres/...` 一致。
 */
export function enrichTaskStatusPayloadForVerifyUi(base: TaskStatusChatPayload): TaskStatusChatPayload {
  const tracks = useTrackStore.getState().tracks;
  const alerts = useAlertStore.getState().alerts;
  const lookupId = base.verifyTargetId ?? base.uniqueId ?? base.trackID;
  const track = findTrackForTaskStatusVerify(lookupId, tracks);
  const fromAlert = pickShipArchiveFromAlerts(lookupId, alerts);

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
  }
  if (!out.shipArchiveInfo?.trim() && fromAlert?.trim()) {
    out.shipArchiveInfo = fromAlert.trim();
  }
  return out;
}
