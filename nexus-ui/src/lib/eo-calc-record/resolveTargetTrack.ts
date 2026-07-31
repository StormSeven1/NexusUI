import type { Track } from "@/lib/map-entity-model";
import { numericTargetIdForCamServerTrackTask } from "@/lib/map-gis-camera-task";

/** 按 DDS / 融合航迹号在 store 中查找目标（对齐 Qt `m_nCurFuseID`） */
export function resolveTrackByDdsId(tracks: readonly Track[], ddsTrackId: number | null): Track | null {
  if (ddsTrackId == null || !Number.isFinite(ddsTrackId) || ddsTrackId <= 0) return null;
  const tid = String(Math.trunc(ddsTrackId));
  for (const t of tracks) {
    if (t.showID === tid || t.uniqueID === tid || t.trackId === tid) return t;
  }
  return null;
}

/**
 * 跟踪采集「基准目标」展示：对齐 Qt `SetTargetName(QString::number(m_nCurFuseID))` / camServer `target_id`。
 * 只显示数字 ID，不用航迹名称（如 buoy）。
 */
export function resolveCalcRecordBaselineTargetId(
  ddsTrackId: number | null,
  targetTrack: Track | null,
): string {
  if (ddsTrackId != null && ddsTrackId > 0) return String(Math.trunc(ddsTrackId));
  if (targetTrack) {
    const id = numericTargetIdForCamServerTrackTask(targetTrack);
    if (id > 0) return String(id);
    const uid = String(targetTrack.uniqueID ?? "").trim() || String(targetTrack.showID ?? "").trim();
    if (uid) return uid;
  }
  return "—";
}

export function isAirCalcRecordTrack(track: Track): boolean {
  if (track.isAirTrack === true || track.type === "air") return true;
  const lk = track.trackLayerKey;
  return lk === "fuse_air" || lk === "bird_radar" || lk === "auto_bird_radar" || lk === "fanwu_car_radar" || lk === "uav_pose_track";
}
