import type { Track, TrackFusionSourceItem } from "@/lib/map-entity-model";
import type { EoCameraDdsStatusRow } from "@/stores/eo-camera-dds-status-store";
import type { EoDetectionBox } from "@/lib/eo-video/types";
import { isAirCalcRecordTrack } from "@/lib/eo-calc-record/resolveTargetTrack";
import { parsePositiveTrackId } from "@/lib/eo-video/formatEoDdsTaskOverlay";
import { mergeSingleTrackTelemetry } from "@/lib/eo-video/mergeSingleTrackTelemetry";
import { isSelfReportFusionSourceItem } from "@/lib/map-gis-camera-task";
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

function isKuFusionSourceItem(item: TrackFusionSourceItem): boolean {
  const name = String(item.sourceName ?? "").trim().toLowerCase();
  const ds = String(item.dataSourceId ?? "").trim().toLowerCase();
  const blob = `${name} ${ds}`;
  return /\bku\b|ku雷达|ku_radar|ku-radar/.test(blob);
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

  const aimType = isAirCalcRecordTrack(input.targetTrack) ? 1 : 0;
  const domainType: 0 | 1 = aimType === 1 ? 1 : 0;

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
 * 融合航迹 external_target_id（WS `externalTargetId` 或 `trackId`，须不同于融合 target_id）。
 */
export function resolveAimTrackCollectFusionExternalTargetId(fusionTrack: Track): number | null {
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
 * 解析三源航迹 ID（缺源为 0）。
 * 对海：0=AIS，1=远遥，2=靖子头；对空：0=自报位，1=探鸟，2=KU（当前常无数据）。
 * ID 与标牌「来源」括号一致（externalTrackId，无则 trackId）。
 */
export function resolveAimTrackCollectRadarSourceSlots(
  targetTrack: Track,
  _allTracks?: readonly Track[],
): AimTrackCollectRadarSourceSlot[] {
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
        trackId: idFromSourceOrSensor(sources, isKuFusionSourceItem, sensor, /(?:\bKU\b|KU雷达)[^,]*?\((\d+)\)/i),
      },
    ];
  }

  return [
    {
      radarId: 0,
      trackId: idFromSourceOrSensor(sources, isAisFusionSourceItem, sensor, /\bAIS\b[^,]*?\((\d+)\)/i),
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
