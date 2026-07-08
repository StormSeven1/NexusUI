import type { Track, TrackFusionSourceItem } from "@/lib/map-entity-model";
import type { ImportantTrackTargetCollection } from "@/lib/camera-management-client";
import { resolveTrackLayerKey, type TrackLayerResolveInput } from "@/lib/track-layer-visibility";

/** 与 camServer `NewTrackStructConvert::kStableUniqueIdThreshold` 一致：<100000 多为自报位 / 融合显示号 */
const CAM_SERVER_STABLE_UNIQUE_ID_THRESHOLD = 100_000;

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

/** 纯数字且 <100000，才视为 camServer `m_selfPosMap` / `SelfPoseTrack.id` 候选 */
function pickCamServerSelfPosMapCandidateId(raw: string | undefined): number | null {
  const s = String(raw ?? "").trim();
  if (!s || !/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0 || n >= CAM_SERVER_STABLE_UNIQUE_ID_THRESHOLD) return null;
  return n;
}

/** 从航迹解析新 DDS `target_id`（前端 `uniqueID` / `showID`）；告警、无人机跟机任务等 */
export function numericTargetIdForCameraTask(track: Pick<Track, "uniqueID" | "showID">): number {
  const s = String(track.uniqueID ?? "").trim() || String(track.showID ?? "").trim();
  return parsePositiveIntId(s);
}

/**
 * camServer `m_selfPosMap` 主键：UDP `SelfPoseTrack.id`。
 * 优先 fusionSources 中 zibaowei / 自报位源的 `trackId`；独立 `uav_pose_track` 再试小号 `trackId` / `uniqueID`。
 */
export function resolveCamServerSelfPosMapId(
  track: TrackLayerResolveInput &
    Pick<Track, "fusionSources" | "trackId" | "uniqueID" | "showID" | "sensor">,
): number | null {
  const fromFusion = extractSelfReportIdFromFusionSources(track.fusionSources);
  if (fromFusion != null) return fromFusion;

  const fromSensor = parseSelfReportIdFromSensor(track.sensor);
  if (fromSensor != null) return fromSensor;

  if (
    resolveTrackLayerKey(track) === "uav_pose_track" ||
    trackHasSelfReportSource(track)
  ) {
    const fromTrackId = pickCamServerSelfPosMapCandidateId(track.trackId);
    if (fromTrackId != null) return fromTrackId;
    const fromUnique = pickCamServerSelfPosMapCandidateId(track.uniqueID);
    if (fromUnique != null) return fromUnique;
    const fromShow = pickCamServerSelfPosMapCandidateId(track.showID);
    if (fromShow != null) return fromShow;
  }

  return null;
}

/**
 * 下发 camServer 光电 IM / 第三方 POS 用的 `target_id`：
 * 自报位航迹对齐 `m_selfPosMap`；其余仍用 DDS `uniqueID` / `showID`。
 */
export function numericTargetIdForCamServerTrackTask(track: Track): number {
  if (trackHasSelfReportSource(track)) {
    const selfPosId = resolveCamServerSelfPosMapId(track);
    if (selfPosId != null && selfPosId > 0) return selfPosId;
  }
  return numericTargetIdForCameraTask(track);
}

export function extractSelfReportIdFromFusionSources(
  sources: TrackFusionSourceItem[] | undefined,
): number | null {
  if (!sources?.length) return null;
  for (const item of sources) {
    if (!isSelfReportFusionSourceItem(item)) continue;
    const n = pickCamServerSelfPosMapCandidateId(
      item.trackId != null ? String(item.trackId) : undefined,
    );
    if (n != null) return n;
  }
  return null;
}

function parseSelfReportIdFromSensor(sensor: string | undefined): number | null {
  const text = String(sensor ?? "").trim();
  if (!text.includes("自报位")) return null;
  const m = text.match(/自报位\s*\((\d+)\)/);
  if (!m) return null;
  return pickCamServerSelfPosMapCandidateId(m[1]);
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
  const targetId = numericTargetIdForCamServerTrackTask(track);
  const altitude =
    !isSea && track.altitude !== undefined && Number.isFinite(track.altitude) && track.altitude > 0
      ? track.altitude
      : undefined;
  return {
    latitude: lat,
    longitude: lng,
    type: isSea ? 0 : 1,
    target_id: targetId,
    ...(altitude !== undefined ? { altitude } : {}),
    shipType: isSea ? 3 : 0,
  };
}

/** 融合来源项是否为自报位（依据 WS `fusionSources` 的 sourceName / dataSourceId，不写死现场 entity 编号） */
export function isSelfReportFusionSourceItem(item: TrackFusionSourceItem): boolean {
  const name = String(item.sourceName ?? "").trim();
  if (name.includes("自报位")) return true;
  const ds = String(item.dataSourceId ?? "").trim().toLowerCase();
  if (ds === "zibaowei") return true;
  if (ds.includes("uav_pose") || ds.includes("self_report") || ds.includes("selfreport")) return true;
  return false;
}

/** 航迹是否含自报位来源（独立自报位层或融合源中含自报位） */
export function trackHasSelfReportSource(
  track: TrackLayerResolveInput & Pick<Track, "fusionSources">,
): boolean {
  if (resolveTrackLayerKey(track) === "uav_pose_track") return true;
  if (track.fusionSources?.some(isSelfReportFusionSourceItem)) return true;
  if (String(track.sensor ?? "").includes("自报位")) return true;
  return false;
}

/**
 * 第三方 POS `trackType`：0=雷达航迹，1=自报位。
 * 默认 0；独立自报位层或融合航迹含自报位源时为 1。
 */
export function resolveThirdPartyPosTrackType(
  track: TrackLayerResolveInput & Pick<Track, "fusionSources">,
): 0 | 1 {
  return trackHasSelfReportSource(track) ? 1 : 0;
}

/** 第三方 UDP `0x3004` POS：`ThirdPartyCamPosTask`，来自当前航迹（态势双击下发） */
export type ThirdPartyPosFieldsFromTrack = {
  /** 与报文 `uniqueID` / 库表 `unique_id` / 新 DDS `target_id` 对齐 */
  targetId: number;
  /** 0=雷达航迹，1=自报位 */
  trackType: 0 | 1;
  targetLon: number;
  targetLat: number;
  targetAlt: number;
  tarSpeed: number;
  tarCourse: number;
};

/** 将航迹 `uniqueID`（纯数字）解析为 POS 的 `targetId` */
export function parseTrackUniqueIdForThirdPartyPos(
  track: Track,
): number | null {
  const n = numericTargetIdForCamServerTrackTask(track);
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
    trackType: resolveThirdPartyPosTrackType(track),
    targetLon: track.lng,
    targetLat: track.lat,
    targetAlt: track.altitude !== undefined && Number.isFinite(track.altitude) ? track.altitude : 0,
    tarSpeed: Number.isFinite(track.speed) ? track.speed : 0,
    tarCourse,
  };
}
