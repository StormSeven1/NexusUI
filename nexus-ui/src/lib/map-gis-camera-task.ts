import type { Track, TrackFusionSourceItem } from "@/lib/map-entity-model";
import type { ImportantTrackTargetCollection } from "@/lib/camera-management-client";
import {
  isRadarTrackLayerKey,
  resolveTrackLayerKey,
  type TrackLayerResolveInput,
} from "@/lib/track-layer-visibility";

/**
 * 双击走「仅 LookAt、不单目标/不左右搜」的航迹：对海/对空融合 + 雷达类（含远遥鹏飞）。
 * 自报位 / AIS 仍走重点关注 IM（可单目标跟踪）。
 */
export function isMapTrackDblClickLookAtOnlyEligible(track: TrackLayerResolveInput): boolean {
  const lk = resolveTrackLayerKey(track);
  return (
    lk === "fuse_sea" ||
    lk === "fuse_air" ||
    isRadarTrackLayerKey(lk) ||
    lk === "xpf_track"
  );
}

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
 * camServer `m_selfPosMap` 主键：UDP/DDS `SelfPoseTrack.id`。
 * 优先 fusionSources 中 zibaowei / 自报位源的 `trackId`；
 * 独立 `uav_pose_track` / `boat_self_track` 再试 externalTargetId → trackId → uniqueID（仅 <100000）。
 */
export function resolveCamServerSelfPosMapId(
  track: TrackLayerResolveInput &
    Pick<Track, "fusionSources" | "trackId" | "uniqueID" | "showID" | "sensor" | "externalTargetId">,
): number | null {
  const fromFusion = extractSelfReportIdFromFusionSources(track.fusionSources);
  if (fromFusion != null) return fromFusion;

  const fromSensor = parseSelfReportIdFromSensor(track.sensor);
  if (fromSensor != null) return fromSensor;

  const layer = resolveTrackLayerKey(track);
  if (layer === "uav_pose_track" || layer === "boat_self_track" || trackHasSelfReportSource(track)) {
    const fromExternal = pickCamServerSelfPosMapCandidateId(
      track.externalTargetId != null ? String(track.externalTargetId) : undefined,
    );
    if (fromExternal != null) return fromExternal;
    const fromTrackId = pickCamServerSelfPosMapCandidateId(track.trackId);
    if (fromTrackId != null) return fromTrackId;
    const fromUnique = pickCamServerSelfPosMapCandidateId(track.uniqueID);
    if (fromUnique != null) return fromUnique;
    const fromShow = pickCamServerSelfPosMapCandidateId(track.showID);
    if (fromShow != null) return fromShow;
  }

  return null;
}

function trackIdKeysForFusionMatch(track: Track): Set<string> {
  const keys = new Set<string>();
  for (const raw of [track.externalTargetId, track.trackId, track.uniqueID, track.showID, track.id]) {
    const s = String(raw ?? "").trim();
    if (s) keys.add(s);
    const n = parsePositiveIntId(String(raw ?? ""));
    if (n > 0) keys.add(String(n));
  }
  return keys;
}

function isWharfRadarFusionSourceItem(item: TrackFusionSourceItem): boolean {
  const name = String(item.sourceName ?? "").trim().toLowerCase();
  if (/远遥|码头|yuanyao|wharf/.test(name)) return true;
  const ds = String(item.dataSourceId ?? "").trim().toLowerCase();
  return /yuanyao|yuan_yao|wharf|码头|远遥|radar_track1/.test(ds);
}

function isJingziRadarFusionSourceItem(item: TrackFusionSourceItem): boolean {
  const name = String(item.sourceName ?? "").trim().toLowerCase();
  const ds = String(item.dataSourceId ?? "").trim().toLowerCase();
  return /jingzi|靖子|radar_track2/.test(`${name} ${ds}`);
}

function fusionSourceMatchesRadarTrack(item: TrackFusionSourceItem, radarTrack: Track): boolean {
  const keys = trackIdKeysForFusionMatch(radarTrack);
  for (const raw of [item.externalTrackId, item.trackId]) {
    const s = String(raw ?? "").trim();
    if (s && keys.has(s)) return true;
    const n = parsePositiveIntId(String(raw ?? ""));
    if (n > 0 && keys.has(String(n))) return true;
  }
  return false;
}

/**
 * 独立远遥/靖子头雷达 → 含该雷达分量的对海融合航迹（用于双击优先发融合 target_id）。
 */
export function findAssociatedSeaFusionForRadarTrack(
  radarTrack: Track,
  allTracks: readonly Track[],
): Track | null {
  const lk = resolveTrackLayerKey(radarTrack);
  const matchSource =
    lk === "radar_wharf"
      ? isWharfRadarFusionSourceItem
      : lk === "radar_jingzi"
        ? isJingziRadarFusionSourceItem
        : null;
  if (!matchSource) return null;
  for (const t of allTracks) {
    if (resolveTrackLayerKey(t) !== "fuse_sea") continue;
    const sources = t.fusionSources ?? [];
    if (!sources.some((s) => matchSource(s) && fusionSourceMatchesRadarTrack(s, radarTrack))) {
      continue;
    }
    return t;
  }
  return null;
}

/**
 * camServer 光电任务用的 shipType + target_id。
 * 雷达层：优先关联对海融合的 `target_id`（shipType=3）；找不到融合再回退雷达 uniqueId（shipType=1）。
 */
/** 地图高频三角无 DDS 航迹时合成的占位 id（不可从 SN 抠数字当 target_id） */
export function isSyntheticDroneHfTrack(
  track: Pick<Track, "id" | "showID">,
): boolean {
  const id = String(track.id ?? "").trim();
  const show = String(track.showID ?? "").trim();
  return id.startsWith("drone-self-report:") || show.startsWith("drone-self-report:");
}

export function resolveCamServerShipTaskIds(
  track: Track,
  allTracks: readonly Track[] = [],
): { shipType: number; targetId: number } {
  // 高频三角合成航迹：无合法 DDS target_id，交给 camServer 用 lon/lat/alt 引导
  if (isSyntheticDroneHfTrack(track)) {
    return { shipType: 0, targetId: 0 };
  }

  const lk = resolveTrackLayerKey(track);

  // 对海/对空融合：始终用融合 target_id（与地图 showID / 查证一致）。
  // 不可因 fusionSources 含 zibaowei 改成自报位本地号，否则光电显示 4011、前端按 5149100 查查证对不上。
  if (lk === "fuse_sea" || lk === "fuse_air") {
    const fusionTargetId = numericTargetIdForCameraTask(track);
    const isSea = lk === "fuse_sea" || track.type === "sea" || track.type === "underwater";
    return {
      shipType: isSea ? 3 : 0,
      targetId: fusionTargetId,
    };
  }

  if (lk === "radar_wharf" || lk === "radar_jingzi" || lk === "xpf_track") {
    const fusion = findAssociatedSeaFusionForRadarTrack(track, allTracks);
    if (fusion) {
      const fusionTargetId = numericTargetIdForCameraTask(fusion);
      if (fusionTargetId > 0) {
        return { shipType: 3, targetId: fusionTargetId };
      }
    }
    // shipType=1：camServer m_mapRadarTrack 主键为 uniqueId/target_id
    const radarId =
      numericTargetIdForCameraTask(track) ||
      parsePositiveIntId(String(track.externalTargetId ?? "")) ||
      parsePositiveIntId(String(track.trackId ?? ""));
    return { shipType: 1, targetId: radarId };
  }

  if (lk === "ais_track") {
    const aisId =
      parsePositiveIntId(String(track.trackId ?? "")) || numericTargetIdForCameraTask(track);
    return { shipType: 2, targetId: aisId };
  }

  // 仅独立自报位层（或未归入融合层但带自报位）才走 selfPosMap 本地号
  if (trackHasSelfReportSource(track)) {
    const selfPosId = resolveCamServerSelfPosMapId(track);
    if (selfPosId != null && selfPosId > 0) {
      const isSea = track.type === "sea" || track.type === "underwater";
      return { shipType: isSea ? 3 : 0, targetId: selfPosId };
    }
  }

  const isSea = track.type === "sea" || track.type === "underwater";
  return {
    shipType: isSea ? 3 : 0,
    targetId: numericTargetIdForCameraTask(track),
  };
}

/**
 * @deprecated 请用 `resolveCamServerShipTaskIds`（雷达需 allTracks 才能优先走融合 target_id）
 * camServer `CameraFocusOnShip` 的 `ShipType`：无 allTracks 时雷达直接按 1。
 */
export function resolveCamServerShipType(
  track: TrackLayerResolveInput,
  allTracks: readonly Track[] = [],
): number {
  return resolveCamServerShipTaskIds(track as Track, allTracks).shipType;
}

/**
 * 下发 camServer 光电 IM / LookAt 用的 `target_id`。
 * 雷达层在传入 allTracks 时优先关联融合 target_id。
 */
export function numericTargetIdForCamServerTrackTask(
  track: Track,
  allTracks: readonly Track[] = [],
): number {
  return resolveCamServerShipTaskIds(track, allTracks).targetId;
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
export function buildImportantTrackTargetFromTrack(
  track: Track,
  allTracks: readonly Track[] = [],
): ImportantTrackTargetCollection {
  const isSea = track.type === "sea" || track.type === "underwater";
  const lat = Number.isFinite(track.lat) ? track.lat : 0;
  const lng = Number.isFinite(track.lng) ? track.lng : 0;
  const { shipType, targetId } = resolveCamServerShipTaskIds(track, allTracks);
  let altitude =
    !isSea && track.altitude !== undefined && Number.isFinite(track.altitude) && track.altitude > 0
      ? track.altitude
      : undefined;
  // 高频三角常无 DDS id：仍下发高度，便于 camServer CameraFocusOnSky；缺高度时用保守默认，避免只落到对地 CalcPTZ
  if (!isSea && altitude === undefined && isSyntheticDroneHfTrack(track)) {
    altitude = 80;
  }
  return {
    latitude: lat,
    longitude: lng,
    type: isSea ? 0 : 1,
    target_id: targetId,
    ...(altitude !== undefined ? { altitude } : {}),
    shipType,
  };
}

/** 融合来源项是否为自报位（依据 WS `fusionSources` 的 sourceName / dataSourceId，不写死现场 entity 编号） */
export function isSelfReportFusionSourceItem(item: TrackFusionSourceItem): boolean {
  const name = String(item.sourceName ?? "").trim();
  if (name.includes("自报位")) return true;
  const ds = String(item.dataSourceId ?? "").trim().toLowerCase();
  if (ds === "zibaowei") return true;
  if (ds.includes("uav_pose") || ds.includes("boatself") || ds.includes("boat_self") || ds.includes("self_report") || ds.includes("selfreport")) return true;
  return false;
}

/** 航迹是否含自报位来源（独立自报位层或融合源中含自报位） */
export function trackHasSelfReportSource(
  track: TrackLayerResolveInput & Pick<Track, "fusionSources">,
): boolean {
  const layer = resolveTrackLayerKey(track);
  if (layer === "uav_pose_track" || layer === "boat_self_track") return true;
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
