import type { Track } from "@/lib/map-entity-model";
import type { ImportantTrackTargetCollection } from "@/lib/camera-management-client";

function parsePositiveIntId(raw: string): number {
  const s = raw.trim();
  if (!s) return 0;
  if (!/^\d+$/.test(s)) {
    const digits = s.replace(/\D/g, "");
    if (!digits) return 0;
    const n2 = parseInt(digits, 10);
    return Number.isFinite(n2) ? n2 : 0;
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** 从航迹解析新 DDS `target_id`（前端 `uniqueID` / `showID`）；告警、相机 POS、重点关注采集 */
export function numericTargetIdForCameraTask(track: Pick<Track, "uniqueID" | "showID">): number {
  const s = String(track.uniqueID ?? "").trim() || String(track.showID ?? "").trim();
  return parsePositiveIntId(s);
}

/**
 * 无人机跟踪任务 `MultiDroneTracking.trackID_List` 用新 DDS `target_id`（前端 `uniqueID` / `showID`）。
 * @deprecated 请用 `numericTargetIdForCameraTask`；保留别名避免遗漏引用。
 */
export function numericTrackIdForDroneTask(track: Pick<Track, "uniqueID" | "showID">): number {
  return numericTargetIdForCameraTask(track);
}

/** @deprecated 请用 `numericTargetIdForCameraTask`；保留别名避免遗漏引用 */
export function numericTrackIdForCameraTask(track: Track): number {
  return numericTargetIdForCameraTask(track);
}

/** 与 Qt 远程 `CAMERA_IMPORTANT_TRACK` / 地图双击航迹一致的重点关注采集体 */
export function buildImportantTrackTargetFromTrack(track: Track): ImportantTrackTargetCollection {
  const isSea = track.type === "sea" || track.type === "underwater";
  const lat = Number.isFinite(track.lat) ? track.lat : 0;
  const lng = Number.isFinite(track.lng) ? track.lng : 0;
  const targetId = numericTargetIdForCameraTask(track);
  return {
    latitude: lat,
    longitude: lng,
    type: isSea ? 0 : 1,
    target_id: targetId,
    shipType: isSea ? 3 : 0,
  };
}

/** 第三方 UDP `0x3004` POS：`ThirdPartyCamPosTask`，来自当前航迹（态势双击下发） */
export type ThirdPartyPosFieldsFromTrack = {
  /** 与报文 `uniqueID` / 库表 `unique_id` / 新 DDS `target_id` 对齐 */
  targetId: number;
  targetLon: number;
  targetLat: number;
  targetAlt: number;
  tarSpeed: number;
  tarCourse: number;
};

/** 将航迹 `uniqueID`（纯数字）解析为 POS 的 `targetId` */
export function parseTrackUniqueIdForThirdPartyPos(
  track: Pick<Track, "uniqueID" | "showID">,
): number | null {
  const n = numericTargetIdForCameraTask(track);
  return n > 0 ? n : null;
}

/**
 * 构造 POS 必填字段；`uniqueID` 非纯数字或缺少经纬度时返回 `null`（跳过下发）。
 * 不含 `platformLon/Lat/Alt`。
 */
export function buildThirdPartyPosFieldsFromTrack(track: Track): ThirdPartyPosFieldsFromTrack | null {
  const targetId = parseTrackUniqueIdForThirdPartyPos(track);
  if (targetId == null) return null;
  if (!Number.isFinite(track.lng) || !Number.isFinite(track.lat)) return null;

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
