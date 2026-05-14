import type { Track } from "@/lib/map-entity-model";
import type { ImportantTrackTargetCollection } from "@/lib/camera-management-client";

/** 相机元任务 `targetcollection.trackID`：约定为航迹 `uniqueID` 对应的整型（与 Qt `alarmTrackID` / 后端一致） */
export function numericTrackIdForCameraTask(track: Track): number {
  const s = String(track.trackId ?? "").trim();
  if (!s) return 0;
  const n = Number(s);
  if (Number.isFinite(n)) return Math.trunc(n);
  const digits = s.replace(/\D/g, "");
  if (digits) {
    const n2 = parseInt(digits, 10);
    if (Number.isFinite(n2)) return n2;
  }
  return 0;
}

/** 与 Qt 远程 `CAMERA_IMPORTANT_TRACK` / 地图双击航迹一致的重点关注采集体 */
export function buildImportantTrackTargetFromTrack(track: Track): ImportantTrackTargetCollection {
  const isSea = track.type === "sea" || track.type === "underwater";
  return {
    latitude: 0,
    longitude: 0,
    type: isSea ? 0 : 1,
    trackID: numericTrackIdForCameraTask(track),
    shipType: isSea ? 3 : 0,
  };
}

/** 第三方 UDP `0x3004` POS：`ThirdPartyCamPosTask`，来自当前航迹位置与运动学（态势双击下发） */
export type ThirdPartyPosFieldsFromTrack = {
  targetId: number;
  targetLon: number;
  targetLat: number;
  targetAlt: number;
  tarSpeed: number;
  tarCourse: number;
};

export function buildThirdPartyPosFieldsFromTrack(track: Track): ThirdPartyPosFieldsFromTrack {
  const targetId = numericTrackIdForCameraTask(track);
  const courseCandidate =
    track.course !== undefined && Number.isFinite(track.course) ? track.course : track.heading;
  const tarCourse = Number.isFinite(courseCandidate) ? courseCandidate : 0;
  return {
    targetId,
    targetLon: track.lng,
    targetLat: track.lat,
    targetAlt: track.altitude !== undefined && Number.isFinite(track.altitude) ? track.altitude : 0,
    tarSpeed: Number.isFinite(track.speed) ? track.speed : 0,
    tarCourse,
  };
}
