import type { Track, TrackFusionSourceItem } from "@/lib/map-entity-model";
import type { EoCameraDdsStatusRow } from "@/stores/eo-camera-dds-status-store";
import type { EoDetectionBox } from "@/lib/eo-video/types";
import { isAirCalcRecordTrack } from "@/lib/eo-calc-record/resolveTargetTrack";
import { parsePositiveTrackId } from "@/lib/eo-video/formatEoDdsTaskOverlay";
import { mergeSingleTrackTelemetry } from "@/lib/eo-video/mergeSingleTrackTelemetry";
import { isSelfReportFusionSourceItem, resolveCamServerSelfPosMapId } from "@/lib/map-gis-camera-task";
import { resolveTrackLayerKey } from "@/lib/track-layer-visibility";
import {
  AIM_TRACK_COLLECT_TRIGGER_END,
  AIM_TRACK_COLLECT_TRIGGER_MAP_DBLCLICK,
  AIM_TRACK_COLLECT_TRIGGER_START,
  type AimTrackCollectRequest,
} from "@/lib/eo-aim-collect/aimTrackCollectTypes";

/** 对海：0=AIS，1=远遥，2=靖子头；对空：0=自报位，1=探鸟，2=KU */
export type AimTrackCollectRadarSourceSlot = {
  radarId: 0 | 1 | 2;
  trackId: number;
};

function isBirdRadarFusionSourceItem(item: TrackFusionSourceItem): boolean {
  const name = String(item.sourceName ?? "").trim();
  if (name.includes("探鸟")) return true;
  const ds = String(item.dataSourceId ?? "").trim().toLowerCase();
  if (ds === "9" || ds === "bird_radar" || ds === "birdradar") return true;
  return ds.includes("bird") && ds.includes("radar");
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
  const blob = `${name} ${ds}`;
  return /jingzi|靖子|radar_track2/.test(blob);
}

function isAisFusionSourceItem(item: TrackFusionSourceItem): boolean {
  const name = String(item.sourceName ?? "").trim().toLowerCase();
  const ds = String(item.dataSourceId ?? "").trim().toLowerCase();
  if (name === "ais" || name.includes("ais")) return true;
  return ds === "ais" || ds.includes("ais_track") || ds.includes("ais");
}

/** 对空三源槽 2：协议称 KU；现场常含反无车/fanwu（与评估侧 secondary 同源） */
function isKuFusionSourceItem(item: TrackFusionSourceItem): boolean {
  const name = String(item.sourceName ?? "").trim().toLowerCase();
  const ds = String(item.dataSourceId ?? "").trim().toLowerCase();
  const blob = `${name} ${ds}`;
  return /\bku\b|ku雷达|ku_radar|ku-radar|ku_lei_da|反无车|fanwu|fanwucar|udp_fanwucar/.test(blob);
}

function fusionTargetNumericIds(fusionTrack: Track): Set<number> {
  const ids = new Set<number>();
  for (const raw of [fusionTrack.uniqueID, fusionTrack.showID, fusionTrack.id]) {
    const n = parsePositiveTrackId(raw);
    if (n != null) ids.add(n);
  }
  return ids;
}

function isFusionTargetNumericId(id: number, fusionTrack: Track): boolean {
  return fusionTargetNumericIds(fusionTrack).has(id);
}

/** 独立远遥码头雷达航迹（非融合） */
export function isWharfRadarStandaloneTrack(track: Track): boolean {
  return resolveTrackLayerKey(track) === "radar_wharf";
}

/** 独立自报位航迹（无人机自报位 / 船自报位，非融合） */
export function isSelfReportStandaloneTrack(track: Track): boolean {
  const lk = resolveTrackLayerKey(track);
  return lk === "uav_pose_track" || lk === "boat_self_track";
}

export function isBoatSelfReportStandaloneTrack(track: Track): boolean {
  return resolveTrackLayerKey(track) === "boat_self_track";
}

/** 独立探鸟航迹（含智能跟踪点迹） */
export function isBirdRadarStandaloneTrack(track: Track): boolean {
  const lk = resolveTrackLayerKey(track);
  return lk === "bird_radar" || lk === "auto_bird_radar";
}

/** 独立 KU / 反无车航迹（对空三源槽 2） */
export function isKuRadarStandaloneTrack(track: Track): boolean {
  return resolveTrackLayerKey(track) === "fanwu_car_radar";
}

/** 双击允许融合 ID=0 的独立航迹（远遥 / 自报位 / 探鸟 / KU） */
export function isAimTrackCollectStandaloneMapDblClickTrack(track: Track): boolean {
  return (
    isWharfRadarStandaloneTrack(track) ||
    isSelfReportStandaloneTrack(track) ||
    isBirdRadarStandaloneTrack(track) ||
    isKuRadarStandaloneTrack(track)
  );
}

/** 独立雷达/自报位批号：externalTargetId，无则 trackId */
function standaloneRadarBatchId(track: Track): number {
  const id =
    parsePositiveTrackId(track.externalTargetId) ?? parsePositiveTrackId(track.trackId);
  return id != null && id > 0 ? id : 0;
}

/** 自报位批号：优先 camServer selfPosMap 候选，再 externalTargetId/trackId/uniqueID */
function standaloneSelfReportBatchId(track: Track): number {
  const fromMap = resolveCamServerSelfPosMapId(track);
  if (fromMap != null && fromMap > 0) return fromMap;
  const id =
    parsePositiveTrackId(track.externalTargetId) ??
    parsePositiveTrackId(track.trackId) ??
    parsePositiveTrackId(track.uniqueID) ??
    parsePositiveTrackId(track.showID);
  return id != null && id > 0 ? id : 0;
}

function trackIdKeys(track: Track): Set<string> {
  const keys = new Set<string>();
  for (const raw of [track.externalTargetId, track.trackId, track.uniqueID, track.showID, track.id]) {
    const s = String(raw ?? "").trim();
    if (s) keys.add(s);
    const n = parsePositiveTrackId(raw);
    if (n != null) keys.add(String(n));
  }
  return keys;
}

function fusionSourceMatchesTrack(item: TrackFusionSourceItem, track: Track): boolean {
  const keys = trackIdKeys(track);
  const selfPosId = resolveCamServerSelfPosMapId(track);
  if (selfPosId != null) keys.add(String(selfPosId));
  for (const raw of [item.externalTrackId, item.trackId]) {
    const s = String(raw ?? "").trim();
    if (s && keys.has(s)) return true;
    const n = parsePositiveTrackId(raw);
    if (n != null && keys.has(String(n))) return true;
  }
  return false;
}

/** 含该远遥雷达分量的对海融合航迹（用于补 AIS / 融合 ID） */
function findSeaFusionContainingWharfRadar(
  wharfTrack: Track,
  allTracks: readonly Track[],
): Track | null {
  for (const t of allTracks) {
    if (resolveTrackLayerKey(t) !== "fuse_sea") continue;
    const sources = t.fusionSources ?? [];
    if (!sources.some((s) => isWharfRadarFusionSourceItem(s) && fusionSourceMatchesTrack(s, wharfTrack))) {
      continue;
    }
    return t;
  }
  return null;
}

/**
 * 含该自报位分量的融合航迹（对空 fuse_air 或对海 fuse_sea 均可）。
 * 优先对空（探鸟场景），再对海。
 */
function findFusionContainingSelfReport(
  selfTrack: Track,
  allTracks: readonly Track[],
): Track | null {
  let seaHit: Track | null = null;
  for (const t of allTracks) {
    const lk = resolveTrackLayerKey(t);
    if (lk !== "fuse_air" && lk !== "fuse_sea") continue;
    const sources = t.fusionSources ?? [];
    if (!sources.some((s) => isSelfReportFusionSourceItem(s) && fusionSourceMatchesTrack(s, selfTrack))) {
      continue;
    }
    if (lk === "fuse_air") return t;
    if (!seaHit) seaHit = t;
  }
  return seaHit;
}

/** 含该探鸟分量的对空融合航迹 */
function findAirFusionContainingBirdRadar(
  birdTrack: Track,
  allTracks: readonly Track[],
): Track | null {
  for (const t of allTracks) {
    if (resolveTrackLayerKey(t) !== "fuse_air") continue;
    const sources = t.fusionSources ?? [];
    if (!sources.some((s) => isBirdRadarFusionSourceItem(s) && fusionSourceMatchesTrack(s, birdTrack))) {
      continue;
    }
    return t;
  }
  return null;
}

/** 含该 KU/反无车分量的对空融合航迹 */
function findAirFusionContainingKuRadar(
  kuTrack: Track,
  allTracks: readonly Track[],
): Track | null {
  for (const t of allTracks) {
    if (resolveTrackLayerKey(t) !== "fuse_air") continue;
    const sources = t.fusionSources ?? [];
    if (!sources.some((s) => isKuFusionSourceItem(s) && fusionSourceMatchesTrack(s, kuTrack))) {
      continue;
    }
    return t;
  }
  return null;
}

/** 对空融合航迹 ID：协议首段 `1_ID` 即对空融合批号（uniqueID/showID 等） */
function resolveAirFusionTrackId(fusionTrack: Track): number | null {
  for (const raw of [
    fusionTrack.externalTargetId,
    fusionTrack.uniqueID,
    fusionTrack.showID,
    fusionTrack.trackId,
    fusionTrack.id,
  ]) {
    const n = parsePositiveTrackId(raw);
    if (n != null && n > 0) return n;
  }
  return null;
}

function aisIdFromFusionTrack(fusion: Track): number {
  return idFromSourceOrSensor(
    fusion.fusionSources ?? [],
    isAisFusionSourceItem,
    String(fusion.sensor ?? ""),
    /\bAIS\b[^,]*?\((\d+)\)/i,
  );
}


/** 与标牌 sensor 括号同一套：externalTrackId（无则 trackId） */
function placardBatchIdFromFusionSourceItem(item: TrackFusionSourceItem): number {
  const id = parsePositiveTrackId(item.externalTrackId ?? item.trackId);
  return id != null && id > 0 ? id : 0;
}


/** 从标牌「来源」字符串取括号内批号，例：`远遥码头-雷达(1454)` */
function parseIdFromPlacardSensor(sensor: string, namePattern: RegExp): number {
  const text = String(sensor ?? "").trim();
  if (!text) return 0;
  const m = text.match(namePattern);
  if (!m?.[1]) return 0;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function idFromSourceOrSensor(
  sources: readonly TrackFusionSourceItem[],
  match: (item: TrackFusionSourceItem) => boolean,
  sensor: string,
  sensorNamePattern: RegExp,
): number {
  const item = sources.find(match);
  if (item) {
    const fromItem = placardBatchIdFromFusionSourceItem(item);
    if (fromItem > 0) return fromItem;
  }
  return parseIdFromPlacardSensor(sensor, sensorNamePattern);
}

function fmtNum(n: number, digits = 6): string {
  if (!Number.isFinite(n)) return "0";
  const s = n.toFixed(digits);
  return s.replace(/\.?0+$/, "");
}

/** camera_001 → 1，camera_004 → 4 */
export function parseEoCameraIndex(entityId: string): number | null {
  const m = entityId.trim().match(/^camera_(\d+)$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * 末段三源：`雷达id_ID_雷达id_ID_雷达id_ID`（缺源填 0）。
 * 例：`0_0_1_1234_2_2345`
 */
export function formatAimTrackCollectRadarSourcesSuffix(
  slots: readonly AimTrackCollectRadarSourceSlot[],
): string {
  const byId = new Map<number, number>();
  for (const s of slots) {
    byId.set(s.radarId, s.trackId > 0 ? Math.trunc(s.trackId) : 0);
  }
  return [0, 1, 2]
    .map((radarId) => `${radarId}_${byId.get(radarId) ?? 0}`)
    .join("_");
}

/**
 * 航迹点：`海域类型_融合ID:经度:纬度:方位:距离:高度:时间戳毫秒:0_ID_1_ID_2_ID`
 * 海域类型：对海融合=0，对空融合=1。
 */
export function formatAimTrackPoint(opts: {
  /** 0=对海，1=对空 */
  domainType: 0 | 1;
  fusionExternalTargetId: number;
  lon: number;
  lat: number;
  azimuthDeg: number;
  distanceM: number;
  altitudeM: number;
  tsMs: number;
  radarSourcesSuffix: string;
}): string {
  return [
    `${opts.domainType}_${Math.trunc(opts.fusionExternalTargetId)}`,
    fmtNum(opts.lon, 6),
    fmtNum(opts.lat, 6),
    fmtNum(opts.azimuthDeg, 3),
    fmtNum(opts.distanceM, 2),
    fmtNum(opts.altitudeM, 2),
    String(Math.trunc(opts.tsMs)),
    opts.radarSourcesSuffix,
  ].join(":");
}

export function buildAimTrackCollectPayload(input: {
  entityId: string;
  aimPath: string;
  ddsRow: EoCameraDdsStatusRow | undefined;
  detectionBoxes: readonly EoDetectionBox[];
  targetTrack: Track;
  fusionExternalTargetId: number;
  radarSourcesSuffix: string;
  triggerType?: number;
  /** 覆盖海域类型；缺省按 targetTrack 推断（写在 trackPoints 首段） */
  domainType?: 0 | 1;
  /** 覆盖 aimType；缺省与 domainType 相同；自报位双击为 2 */
  aimType?: number;
}): AimTrackCollectRequest {
  const cameraIndex = parseEoCameraIndex(input.entityId);
  if (cameraIndex == null) {
    throw new Error("invalid_camera");
  }

  const singleBox = input.detectionBoxes.find((b) => b.variant === "singleTrack");
  const tele = singleBox
    ? mergeSingleTrackTelemetry(singleBox, input.ddsRow, [input.targetTrack])
    : {};

  const azimuthDeg =
    tele.azimuthDeg ??
    (input.targetTrack.azimuth != null && Number.isFinite(input.targetTrack.azimuth)
      ? input.targetTrack.azimuth
      : Number(input.ddsRow?.azimuth ?? 0));

  const distanceM =
    tele.distanceM ??
    (input.targetTrack.distance != null && Number.isFinite(input.targetTrack.distance)
      ? input.targetTrack.distance
      : Number(input.ddsRow?.distance ?? 0));

  const altitudeM = input.targetTrack.altitude ?? 0;
  const tsMs = (() => {
    const parsed = Date.parse(input.targetTrack.lastUpdate);
    return Number.isFinite(parsed) ? parsed : Date.now();
  })();

  const domainType: 0 | 1 =
    input.domainType ?? (isAirCalcRecordTrack(input.targetTrack) ? 1 : 0);
  const aimType =
    input.aimType != null && Number.isFinite(input.aimType) ? Math.trunc(input.aimType) : domainType;

  return {
    cameraIndex,
    aimType,
    aimPath: input.aimPath,
    triggerType: input.triggerType ?? AIM_TRACK_COLLECT_TRIGGER_START,
    trackStatus: 1,
    trackPoints: [
      formatAimTrackPoint({
        domainType,
        fusionExternalTargetId: input.fusionExternalTargetId,
        lon: input.targetTrack.lng,
        lat: input.targetTrack.lat,
        azimuthDeg,
        distanceM,
        altitudeM,
        tsMs,
        radarSourcesSuffix: input.radarSourcesSuffix,
      }),
    ],
    interventionStatus: "1",
    backupField: "",
  };
}

/** 结束采集：复用开始时的航迹字段，仅改 triggerType */
export function buildAimTrackCollectEndPayload(
  startPayload: AimTrackCollectRequest,
): AimTrackCollectRequest {
  return {
    ...startPayload,
    triggerType: AIM_TRACK_COLLECT_TRIGGER_END,
  };
}

/** 态势双击：triggerType=3；融合/雷达多源须已由调用方按 check 同源解析好 */
export function buildAimTrackCollectMapDblClickPayload(input: {
  entityId: string;
  targetTrack: Track;
  fusionExternalTargetId: number;
  radarSourcesSuffix: string;
  aimPath?: string;
  domainType?: 0 | 1;
  /** 自报位双击传 2；缺省与 domainType 相同 */
  aimType?: number;
}): AimTrackCollectRequest {
  return buildAimTrackCollectPayload({
    entityId: input.entityId,
    aimPath: input.aimPath ?? "",
    ddsRow: undefined,
    detectionBoxes: [],
    targetTrack: input.targetTrack,
    fusionExternalTargetId: input.fusionExternalTargetId,
    radarSourcesSuffix: input.radarSourcesSuffix,
    triggerType: AIM_TRACK_COLLECT_TRIGGER_MAP_DBLCLICK,
    domainType: input.domainType,
    aimType: input.aimType,
  });
}

export function resolveAimTrackCollectDdsTrackId(
  ddsRow: EoCameraDdsStatusRow | undefined,
  detectionBoxes: readonly EoDetectionBox[],
): number | null {
  const fromDds =
    parsePositiveTrackId(ddsRow?.trackID) ?? parsePositiveTrackId(ddsRow?.targetID);
  if (fromDds != null) return fromDds;

  const single = detectionBoxes.find((b) => b.variant === "singleTrack");
  if (!single) return null;
  if (single.ddsTrackId != null && single.ddsTrackId > 0) return Math.trunc(single.ddsTrackId);
  if (single.trackId != null && single.trackId > 0) return Math.trunc(single.trackId);
  return null;
}

/**
 * 融合航迹 ID（写入 trackPoints 首段 `海域_ID`）。
 * - 对海：优先 externalTargetId / trackId，且须不同于融合 target_id（uniqueID/showID）。
 * - 对空融合：协议 ID 即为对空融合航迹批号（可用 uniqueID/showID）。
 */
export function resolveAimTrackCollectFusionExternalTargetId(fusionTrack: Track): number | null {
  if (resolveTrackLayerKey(fusionTrack) === "fuse_air") {
    return resolveAirFusionTrackId(fusionTrack);
  }

  const explicit = parsePositiveTrackId(fusionTrack.externalTargetId);
  if (explicit != null && explicit > 0 && !isFusionTargetNumericId(explicit, fusionTrack)) {
    return explicit;
  }
  const fromTrackId = parsePositiveTrackId(fusionTrack.trackId);
  if (fromTrackId == null || fromTrackId <= 0) return null;
  if (isFusionTargetNumericId(fromTrackId, fusionTrack)) return null;
  return fromTrackId;
}

/**
 * 双击用融合 ID：
 * - 普通融合：同 resolveAimTrackCollectFusionExternalTargetId
 * - 独立远遥雷达：默认 0；若关联对海融合含 AIS，则填该融合 ID
 * - 独立自报位 / 探鸟 / KU：默认 0；若关联对空融合，则填该融合 ID
 */
export function resolveAimTrackCollectMapDblClickFusionId(
  track: Track,
  allTracks: readonly Track[] = [],
): number | null {
  if (isWharfRadarStandaloneTrack(track)) {
    const parentFusion = findSeaFusionContainingWharfRadar(track, allTracks);
    if (parentFusion && aisIdFromFusionTrack(parentFusion) > 0) {
      return resolveAimTrackCollectFusionExternalTargetId(parentFusion) ?? 0;
    }
    return 0;
  }
  if (isSelfReportStandaloneTrack(track)) {
    const parentFusion = findFusionContainingSelfReport(track, allTracks);
    if (parentFusion) {
      return resolveAimTrackCollectFusionExternalTargetId(parentFusion) ?? 0;
    }
    return 0;
  }
  if (isBirdRadarStandaloneTrack(track)) {
    const parentFusion = findAirFusionContainingBirdRadar(track, allTracks);
    if (parentFusion) {
      return resolveAimTrackCollectFusionExternalTargetId(parentFusion) ?? 0;
    }
    return 0;
  }
  if (isKuRadarStandaloneTrack(track)) {
    const parentFusion = findAirFusionContainingKuRadar(track, allTracks);
    if (parentFusion) {
      return resolveAimTrackCollectFusionExternalTargetId(parentFusion) ?? 0;
    }
    return 0;
  }
  return resolveAimTrackCollectFusionExternalTargetId(track);
}

/** 双击海域类型：船自报位=对海；无人机自报位默认对空，挂在对海融合上则为对海 */
export function resolveAimTrackCollectMapDblClickDomainType(
  track: Track,
  allTracks: readonly Track[] = [],
): 0 | 1 {
  if (isBoatSelfReportStandaloneTrack(track)) return 0;
  if (isSelfReportStandaloneTrack(track)) {
    const parentFusion = findFusionContainingSelfReport(track, allTracks);
    if (parentFusion && resolveTrackLayerKey(parentFusion) === "fuse_sea") return 0;
    return 1;
  }
  if (isWharfRadarStandaloneTrack(track)) return 0;
  if (isBirdRadarStandaloneTrack(track) || isKuRadarStandaloneTrack(track)) return 1;
  return isAirCalcRecordTrack(track) ? 1 : 0;
}

/**
 * 解析三源航迹 ID（缺源为 0）。
 * 对海：0=AIS，1=远遥，2=靖子头；对空：0=自报位，1=探鸟，2=KU（反无车计入槽 2）。
 * ID 与标牌「来源」括号一致（externalTrackId，无则 trackId）。
 * 独立远遥码头雷达：默认仅填槽位 1；若关联对海融合含 AIS，则按该融合填三源。
 * 独立自报位 / 探鸟 / KU：默认仅填对应槽；若关联融合，则按该融合填三源。
 */
export function resolveAimTrackCollectRadarSourceSlots(
  targetTrack: Track,
  allTracks: readonly Track[] = [],
): AimTrackCollectRadarSourceSlot[] {
  if (isWharfRadarStandaloneTrack(targetTrack)) {
    const parentFusion = findSeaFusionContainingWharfRadar(targetTrack, allTracks);
    if (parentFusion && aisIdFromFusionTrack(parentFusion) > 0) {
      return resolveAimTrackCollectRadarSourceSlots(parentFusion, allTracks);
    }
    return [
      { radarId: 0, trackId: 0 },
      { radarId: 1, trackId: standaloneRadarBatchId(targetTrack) },
      { radarId: 2, trackId: 0 },
    ];
  }

  if (isSelfReportStandaloneTrack(targetTrack)) {
    const parentFusion = findFusionContainingSelfReport(targetTrack, allTracks);
    if (parentFusion) {
      const parentSlots = resolveAimTrackCollectRadarSourceSlots(parentFusion, allTracks);
      // 对海融合：槽位 0 协议为 AIS；无 AIS 时用船/自报位 ID 填槽 0，避免 0_0_1_0_2_0
      if (resolveTrackLayerKey(parentFusion) === "fuse_sea") {
        const selfId = standaloneSelfReportBatchId(targetTrack);
        const aisSlot = parentSlots.find((s) => s.radarId === 0);
        if (selfId > 0 && (!aisSlot || aisSlot.trackId <= 0)) {
          return parentSlots.map((s) => (s.radarId === 0 ? { ...s, trackId: selfId } : s));
        }
      }
      // 对空：确保槽 0 至少带上当前自报位批号
      if (resolveTrackLayerKey(parentFusion) === "fuse_air") {
        const selfId = standaloneSelfReportBatchId(targetTrack);
        const selfSlot = parentSlots.find((s) => s.radarId === 0);
        if (selfId > 0 && (!selfSlot || selfSlot.trackId <= 0)) {
          return parentSlots.map((s) => (s.radarId === 0 ? { ...s, trackId: selfId } : s));
        }
      }
      return parentSlots;
    }
    return [
      { radarId: 0, trackId: standaloneSelfReportBatchId(targetTrack) },
      { radarId: 1, trackId: 0 },
      { radarId: 2, trackId: 0 },
    ];
  }

  if (isBirdRadarStandaloneTrack(targetTrack)) {
    const parentFusion = findAirFusionContainingBirdRadar(targetTrack, allTracks);
    if (parentFusion) {
      const parentSlots = resolveAimTrackCollectRadarSourceSlots(parentFusion, allTracks);
      const birdId = standaloneRadarBatchId(targetTrack);
      const birdSlot = parentSlots.find((s) => s.radarId === 1);
      if (birdId > 0 && (!birdSlot || birdSlot.trackId <= 0)) {
        return parentSlots.map((s) => (s.radarId === 1 ? { ...s, trackId: birdId } : s));
      }
      return parentSlots;
    }
    return [
      { radarId: 0, trackId: 0 },
      { radarId: 1, trackId: standaloneRadarBatchId(targetTrack) },
      { radarId: 2, trackId: 0 },
    ];
  }

  if (isKuRadarStandaloneTrack(targetTrack)) {
    const parentFusion = findAirFusionContainingKuRadar(targetTrack, allTracks);
    if (parentFusion) {
      const parentSlots = resolveAimTrackCollectRadarSourceSlots(parentFusion, allTracks);
      const kuId = standaloneRadarBatchId(targetTrack);
      const kuSlot = parentSlots.find((s) => s.radarId === 2);
      if (kuId > 0 && (!kuSlot || kuSlot.trackId <= 0)) {
        return parentSlots.map((s) => (s.radarId === 2 ? { ...s, trackId: kuId } : s));
      }
      return parentSlots;
    }
    return [
      { radarId: 0, trackId: 0 },
      { radarId: 1, trackId: 0 },
      { radarId: 2, trackId: standaloneRadarBatchId(targetTrack) },
    ];
  }

  const isAir = isAirCalcRecordTrack(targetTrack);
  const sources = targetTrack.fusionSources ?? [];
  const sensor = String(targetTrack.sensor ?? "");

  if (isAir) {
    return [
      {
        radarId: 0,
        trackId: idFromSourceOrSensor(
          sources,
          isSelfReportFusionSourceItem,
          sensor,
          /自报位[^,]*?\((\d+)\)/,
        ),
      },
      {
        radarId: 1,
        trackId: idFromSourceOrSensor(
          sources,
          isBirdRadarFusionSourceItem,
          sensor,
          /探鸟[^,]*?\((\d+)\)/,
        ),
      },
      {
        radarId: 2,
        trackId: idFromSourceOrSensor(
          sources,
          isKuFusionSourceItem,
          sensor,
          /(?:\bKU\b|KU雷达|反无车)[^,]*?\((\d+)\)/i,
        ),
      },
    ];
  }

  return [
    {
      radarId: 0,
      trackId: (() => {
        const ais = idFromSourceOrSensor(
          sources,
          isAisFusionSourceItem,
          sensor,
          /\bAIS\b[^,]*?\((\d+)\)/i,
        );
        if (ais > 0) return ais;
        // 对海融合可含船自报位：无 AIS 时用自报位填槽 0
        return idFromSourceOrSensor(
          sources,
          isSelfReportFusionSourceItem,
          sensor,
          /自报位[^,]*?\((\d+)\)/,
        );
      })(),
    },
    {
      radarId: 1,
      trackId: idFromSourceOrSensor(
        sources,
        isWharfRadarFusionSourceItem,
        sensor,
        /(?:远遥|码头|yuanyao|wharf)[^,]*?\((\d+)\)/i,
      ),
    },
    {
      radarId: 2,
      trackId: idFromSourceOrSensor(
        sources,
        isJingziRadarFusionSourceItem,
        sensor,
        /(?:靖子|jingzi)[^,]*?\((\d+)\)/i,
      ),
    },
  ];
}

/** 末段字符串：`0_ID_1_ID_2_ID` */
export function resolveAimTrackCollectRadarSourcesSuffix(
  targetTrack: Track,
  allTracks?: readonly Track[],
): string {
  return formatAimTrackCollectRadarSourcesSuffix(
    resolveAimTrackCollectRadarSourceSlots(targetTrack, allTracks),
  );
}

/**
 * @deprecated 新协议为三源后缀；保留仅兼容旧调用，返回远遥/探鸟槽位 ID（无则为 null）。
 */
export function resolveAimTrackCollectRadarExternalTargetId(
  targetTrack: Track,
  allTracks?: readonly Track[],
): number | null {
  const slots = resolveAimTrackCollectRadarSourceSlots(targetTrack, allTracks);
  const primary = slots.find((s) => s.radarId === 1);
  return primary && primary.trackId > 0 ? primary.trackId : null;
}
