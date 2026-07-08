/**
 * 航迹质量评估指标（从 mapbox-vue2 MapView.vue 移植，纯数据计算，无 Vue/地图依赖）
 */

import {
  FALLBACK_TRACK_EVAL_RADAR_CHANNELS,
  shortTrackEvalRadarLabel,
} from "@/lib/track-evaluation-radar-config";
import {
  getAirSecondaryRadarId,
  getAirSecondaryRadarSensorId,
  getAirSelfReportId,
  hasAirRadarBesidesSelfReport,
  listAirFusionRadars,
  parseAirFusionSources,
} from "@/lib/air-fusion-source";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalTrackFeature {
  trackId: number | string;
  uniqueId: number | string;
  reid: number | string;
  sensorId: number;
  longitude: number;
  latitude: number;
  speed: number;
  course: number;
  altitude: number;
  record_time: string;
  originalData: Record<string, unknown>;
}

export interface RadarCenter {
  lon: number;
  lat: number;
}

export interface TrackEvalRadarChannel {
  id?: number;
  name?: string;
  center: RadarCenter;
  rotateAngleDeg?: number;
}

export interface TrackEvalRadarChannels {
  radar1?: TrackEvalRadarChannel;
  radar2?: TrackEvalRadarChannel;
  radar5?: TrackEvalRadarChannel;
  radar6?: TrackEvalRadarChannel;
  [key: string]: TrackEvalRadarChannel | undefined;
}

/** 实体列表未就绪时的兜底；运行时请用 `resolveTrackEvalRadarChannelsFromAssets` */
export { FALLBACK_TRACK_EVAL_RADAR_CHANNELS as DEFAULT_TRACK_EVAL_RADAR_CHANNELS } from "@/lib/track-evaluation-radar-config";
export { resolveTrackEvalRadarChannelsFromAssets } from "@/lib/track-evaluation-radar-config";

export interface BirdTrackAccuracyItem {
  id: string;
  accuracy: number;
  fusedCount: number;
  birdCount: number;
  fusionTrackIds: (number | string)[];
  selfReportIds: string[];
}

export interface KuRadarAccuracyItem {
  id: string;
  accuracy: number;
  fusedCount: number;
  kuCount: number;
  fusionTrackIds: (number | string)[];
  selfReportIds: string[];
}

export interface BirdTrackRecallItem {
  id: string;
  recall: number;
  birdCount: number;
  selfReportCount: number;
  totalSelfReportIds: number;
  totalFusionTracks: number;
}

export interface KuRadarRecallItem {
  id: string;
  recall: number;
  kuCount: number;
  selfReportCount: number;
  totalSelfReportIds: number;
  totalFusionTracks: number;
}

export interface BirdTrackFalseAlarmItem {
  id: string;
  falseAlarm: number;
  fusedCount: number;
  birdCount: number;
  fusionTrackIds: (number | string)[];
  selfReportIds: string[];
}

export interface KuRadarFalseAlarmItem {
  id: string;
  falseAlarm: number;
  fusedCount: number;
  kuCount: number;
  fusionTrackIds: (number | string)[];
  selfReportIds: string[];
}

export interface SeaFusionStabilityEntry {
  stability: number;
  radarCount: number;
  aisCount: number;
}

export interface AirFusionStabilityEntry {
  stability: number;
  radarCount: number;
  selfReportCount: number;
}

export interface SeaFusionStabilityByAisItem {
  aisId: string;
  stability: number;
}

export interface AirFusionStabilityBySelfReportItem {
  selfReportId: string;
  stability: number;
}

export interface SeaFusionStabilityDurationEntry {
  stability: number;
  fusionDuration: number;
  aisDuration: number;
}

export interface AirFusionStabilityDurationEntry {
  stability: number;
  fusionDuration: number;
  selfReportDuration: number;
}

export interface SeaMaxTrackingDurationItem {
  aisId: string;
  maxDuration: number;
  longestRadarId: number | string | null;
  longestRadarType: string;
  longestRadarDuration: number;
  aisDuration: number;
  fusionTrackIds: (number | string)[];
}

export interface AirMaxTrackingDurationItem {
  selfReportId: string;
  maxDuration: number;
  longestRadarId: number | string | null;
  longestRadarType: string;
  longestRadarDuration: number;
  selfReportDuration: number;
  fusionTrackIds: (number | string)[];
}

export interface SeaBreakCountItem {
  aisId: string;
  breakCount: number;
}

export interface AirBreakCountItem {
  selfReportId: string;
  breakCount: number;
}

export interface SeaChangeBatchCountItem {
  aisId: string;
  changeBatchCount: number;
}

export interface AirChangeBatchCountItem {
  selfReportId: string;
  changeBatchCount: number;
}

export interface TrackErrorStatsItem {
  id: string;
  fusionAvg: number | null;
  fusionRmse: number | null;
  radar1Avg: number | null;
  radar1Rmse: number | null;
  radar2Avg: number | null;
  radar2Rmse: number | null;
  fusionErrors: number[];
  radar1Errors: number[];
  radar2Errors: number[];
}

export interface TrackEvalMetricsResult {
  birdTrackAccuracy: BirdTrackAccuracyItem[];
  kuRadarAccuracy: KuRadarAccuracyItem[];
  birdTrackRecall: BirdTrackRecallItem[];
  kuRadarRecall: KuRadarRecallItem[];
  birdTrackFalseAlarm: BirdTrackFalseAlarmItem[];
  kuRadarFalseAlarm: KuRadarFalseAlarmItem[];
  seaFusionStability: Map<number | string, SeaFusionStabilityEntry>;
  airFusionStability: Map<number | string, AirFusionStabilityEntry>;
  seaFusionStabilityAvg: number | null;
  airFusionStabilityAvg: number | null;
  seaFusionStabilityByAis: SeaFusionStabilityByAisItem[];
  airFusionStabilityBySelfReport: AirFusionStabilityBySelfReportItem[];
  seaFusionStabilityDuration: Map<number | string, SeaFusionStabilityDurationEntry>;
  airFusionStabilityDuration: Map<number | string, AirFusionStabilityDurationEntry>;
  seaFusionStabilityDurationAvg: number | null;
  airFusionStabilityDurationAvg: number | null;
  seaFusionStabilityDurationByAis: SeaFusionStabilityByAisItem[];
  airFusionStabilityDurationBySelfReport: AirFusionStabilityBySelfReportItem[];
  seaMaxTrackingDuration: SeaMaxTrackingDurationItem[];
  airMaxTrackingDuration: AirMaxTrackingDurationItem[];
  seaMaxTrackingDurationAvg: number | null;
  airMaxTrackingDurationAvg: number | null;
  seaBreakCount: SeaBreakCountItem[];
  airBreakCount: AirBreakCountItem[];
  seaBreakCountAvg: number | null;
  airBreakCountAvg: number | null;
  seaChangeBatchCount: SeaChangeBatchCountItem[];
  airChangeBatchCount: AirChangeBatchCountItem[];
  seaChangeBatchCountAvg: number | null;
  airChangeBatchCountAvg: number | null;
  seaDistanceError: TrackErrorStatsItem[];
  seaHeightError: TrackErrorStatsItem[];
  airDistanceError: TrackErrorStatsItem[];
  airHeightError: TrackErrorStatsItem[];
  seaAzimuthError: TrackErrorStatsItem[];
  airAzimuthError: TrackErrorStatsItem[];
  seaElevationError: TrackErrorStatsItem[];
  airElevationError: TrackErrorStatsItem[];
  seaCourseError: TrackErrorStatsItem[];
  airCourseError: TrackErrorStatsItem[];
  seaSpeedError: TrackErrorStatsItem[];
  airSpeedError: TrackErrorStatsItem[];
}

// ---------------------------------------------------------------------------
// Public API: row → feature, time parse, orchestrator
// ---------------------------------------------------------------------------

export function wsTrackRowToFeature(row: Record<string, unknown>): EvalTrackFeature {
  const sensorId =
    row.sensor_id !== undefined && row.sensor_id !== null ? Number(row.sensor_id) : 0;
  const trackId =
    row.fused_track_id !== undefined && row.fused_track_id !== null
      ? row.fused_track_id
      : row.track_id !== undefined && row.track_id !== null
        ? row.track_id
        : 0;
  const uniqueId = row.unique_id !== undefined && row.unique_id !== null ? row.unique_id : 0;
  const reid =
    row.reid !== undefined && row.reid !== null
      ? row.reid
      : row.re_id !== undefined && row.re_id !== null
        ? row.re_id
        : 0;
  const longitude =
    row.longitude !== undefined && row.longitude !== null ? Number(row.longitude) : 0;
  const latitude =
    row.latitude !== undefined && row.latitude !== null ? Number(row.latitude) : 0;
  const speed = row.speed !== undefined && row.speed !== null ? Number(row.speed) : 0;
  const course = row.course !== undefined && row.course !== null ? Number(row.course) : 0;
  const altitude =
    row.altitude !== undefined && row.altitude !== null ? Number(row.altitude) : 0;
  const record_time = String(
    row.record_time ?? row.time ?? row.timestamp ?? "",
  );

  return {
    trackId: trackId as number | string,
    uniqueId: uniqueId as number | string,
    reid: reid as number | string,
    sensorId,
    longitude,
    latitude,
    speed,
    course,
    altitude,
    record_time,
    originalData: row,
  };
}

export function parseTimeToTimestamp(timeStr: string | number | unknown): number {
  if (timeStr === undefined || timeStr === null || timeStr === "") return 0;
  if (typeof timeStr === "number" && Number.isFinite(timeStr)) {
    return timeStr > 1e12 ? timeStr : timeStr * 1000;
  }
  const s = String(timeStr);
  try {
    const date = new Date(s);
    if (!Number.isNaN(date.getTime())) return date.getTime();
    const isoDate = new Date(s.replace(" ", "T"));
    if (!Number.isNaN(isoDate.getTime())) return isoDate.getTime();
  } catch {
    /* ignore */
  }
  return 0;
}

export function computeAllTrackMetrics(
  features: EvalTrackFeature[],
  radarChannels: TrackEvalRadarChannels = FALLBACK_TRACK_EVAL_RADAR_CHANNELS,
): TrackEvalMetricsResult {
  if (!features || features.length === 0) {
    return emptyTrackEvalMetricsResult();
  }

  const accuracy = calculateAccuracy(features);
  const recall = calculateRecall(features);
  const falseAlarm = calculateFalseAlarm(features);
  const stability = calculateTrackingStability(features, radarChannels);
  const errors = calculateErrors(features, radarChannels);

  return {
    ...accuracy,
    ...recall,
    ...falseAlarm,
    ...stability,
    ...errors,
  };
}

function emptyTrackEvalMetricsResult(): TrackEvalMetricsResult {
  return {
    birdTrackAccuracy: [],
    kuRadarAccuracy: [],
    birdTrackRecall: [],
    kuRadarRecall: [],
    birdTrackFalseAlarm: [],
    kuRadarFalseAlarm: [],
    seaFusionStability: new Map(),
    airFusionStability: new Map(),
    seaFusionStabilityAvg: null,
    airFusionStabilityAvg: null,
    seaFusionStabilityByAis: [],
    airFusionStabilityBySelfReport: [],
    seaFusionStabilityDuration: new Map(),
    airFusionStabilityDuration: new Map(),
    seaFusionStabilityDurationAvg: null,
    airFusionStabilityDurationAvg: null,
    seaFusionStabilityDurationByAis: [],
    airFusionStabilityDurationBySelfReport: [],
    seaMaxTrackingDuration: [],
    airMaxTrackingDuration: [],
    seaMaxTrackingDurationAvg: null,
    airMaxTrackingDurationAvg: null,
    seaBreakCount: [],
    airBreakCount: [],
    seaBreakCountAvg: null,
    airBreakCountAvg: null,
    seaChangeBatchCount: [],
    airChangeBatchCount: [],
    seaChangeBatchCountAvg: null,
    airChangeBatchCountAvg: null,
    seaDistanceError: [],
    seaHeightError: [],
    airDistanceError: [],
    airHeightError: [],
    seaAzimuthError: [],
    airAzimuthError: [],
    seaElevationError: [],
    airElevationError: [],
    seaCourseError: [],
    airCourseError: [],
    seaSpeedError: [],
    airSpeedError: [],
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const ONE_HOUR_MS = 60 * 60 * 1000;
const timeCache = new WeakMap<EvalTrackFeature, number>();

function isValidOriginalId(id: unknown): boolean {
  return id !== undefined && id !== null && id !== "" && id !== 0;
}

function getRecordTimeStr(f: EvalTrackFeature): string {
  const od = f.originalData;
  return String(
    f.record_time ||
      od.record_time ||
      od.time ||
      od.timestamp ||
      "",
  );
}

function getFeatureTimestamp(f: EvalTrackFeature): number {
  if (timeCache.has(f)) return timeCache.get(f)!;
  const ts = parseTimeToTimestamp(getRecordTimeStr(f));
  if (ts > 0) timeCache.set(f, ts);
  return ts;
}

function calculateGeoDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateAzimuth(
  radarLat: number,
  radarLon: number,
  targetLat: number,
  targetLon: number,
): number {
  const φ1 = (radarLat * Math.PI) / 180;
  const φ2 = (targetLat * Math.PI) / 180;
  const Δλ = ((targetLon - radarLon) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  let θ = Math.atan2(y, x);
  θ = ((θ * 180) / Math.PI + 360) % 360;
  return θ;
}

function calculateElevation(
  radarLat: number,
  radarLon: number,
  radarHeight: number,
  targetLat: number,
  targetLon: number,
  targetHeight: number,
): number {
  const horizontalDist = calculateGeoDistance(radarLat, radarLon, targetLat, targetLon);
  const heightDiff = targetHeight - radarHeight;
  return (Math.atan2(heightDiff, horizontalDist) * 180) / Math.PI;
}

function calculateAngleDifference(angle1: number, angle2: number): number {
  let diff = angle1 - angle2;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return diff;
}

function calculateAvgAndRmse(values: number[]): { avg: number | null; rmse: number | null } {
  if (!values || values.length === 0) return { avg: null, rmse: null };
  const sum = values.reduce((acc, val) => acc + val, 0);
  const avg = sum / values.length;
  const squaredDiffs = values.map((val) => Math.pow(val - avg, 2));
  const meanSquaredDiff = squaredDiffs.reduce((acc, val) => acc + val, 0) / values.length;
  const rmse = Math.sqrt(meanSquaredDiff);
  return { avg, rmse };
}

interface IdCountStat {
  count: number;
  timeRange: { min: number; max: number };
  fusionTrackIds: Set<number | string>;
  selfReportIds: Set<string>;
}

// ---------------------------------------------------------------------------
// Accuracy / Recall / False alarm
// ---------------------------------------------------------------------------

function accumulateAirRadarIdCount(
  counts: Map<string, IdCountStat>,
  radarId: number | string | undefined,
  fusionTrackId: number | string,
  selfReportId: unknown,
  timestamp: number,
): void {
  if (!isValidOriginalId(radarId)) return;
  const idStr = String(radarId);
  if (!counts.has(idStr)) {
    counts.set(idStr, {
      count: 0,
      timeRange: { min: timestamp, max: timestamp },
      fusionTrackIds: new Set(),
      selfReportIds: new Set(),
    });
  }
  const stat = counts.get(idStr)!;
  stat.count++;
  stat.fusionTrackIds.add(fusionTrackId);
  if (isValidOriginalId(selfReportId)) stat.selfReportIds.add(String(selfReportId));
  if (timestamp > 0) {
    stat.timeRange.min = Math.min(stat.timeRange.min, timestamp);
    stat.timeRange.max = Math.max(stat.timeRange.max, timestamp);
  }
}

function calculateAccuracy(features: EvalTrackFeature[]): Pick<
  TrackEvalMetricsResult,
  "birdTrackAccuracy" | "kuRadarAccuracy"
> {
  const airFusionTracks = features.filter((f) => {
    if (f.sensorId !== 6) return false;
    return getAirSelfReportId(f.originalData) !== undefined;
  });

  if (airFusionTracks.length === 0) {
    return { birdTrackAccuracy: [], kuRadarAccuracy: [] };
  }

  const birdTrackIdCounts = new Map<string, IdCountStat>();
  const kuRadarIdCounts = new Map<string, IdCountStat>();

  airFusionTracks.forEach((f) => {
    const originalData = f.originalData;
    const sources = parseAirFusionSources(originalData);
    const timestamp = getFeatureTimestamp(f);
    const fusionTrackId = f.trackId;
    const selfReportId = sources.selfReport;

    accumulateAirRadarIdCount(
      birdTrackIdCounts,
      sources.bird,
      fusionTrackId,
      selfReportId,
      timestamp,
    );
    accumulateAirRadarIdCount(
      kuRadarIdCounts,
      getAirSecondaryRadarId(sources),
      fusionTrackId,
      selfReportId,
      timestamp,
    );
  });

  const birdTracks = features.filter((f) => f.sensorId === 5);
  const birdAccuracyData: BirdTrackAccuracyItem[] = [];
  birdTrackIdCounts.forEach((stat, birdId) => {
    const timeMin = stat.timeRange.min - ONE_HOUR_MS;
    const timeMax = stat.timeRange.max + ONE_HOUR_MS;
    const birdTracksInRange = birdTracks.filter((f) => {
      if (String(f.trackId) !== String(birdId)) return false;
      const timestamp = getFeatureTimestamp(f);
      return timestamp > 0 && timestamp >= timeMin && timestamp <= timeMax;
    });
    const birdCount = birdTracksInRange.length;
    const fusedCount = stat.count;
    const accuracy = birdCount > 0 ? fusedCount / birdCount : 0;
    birdAccuracyData.push({
      id: birdId,
      accuracy: Math.min(accuracy, 1),
      fusedCount,
      birdCount,
      fusionTrackIds: Array.from(stat.fusionTrackIds),
      selfReportIds: Array.from(stat.selfReportIds),
    });
  });
  birdAccuracyData.sort((a, b) => b.accuracy - a.accuracy);

  const secondaryRadarTracks = features.filter((f) => f.sensorId === 7 || f.sensorId === 203);
  const kuAccuracyData: KuRadarAccuracyItem[] = [];
  kuRadarIdCounts.forEach((stat, kuId) => {
    const timeMin = stat.timeRange.min - ONE_HOUR_MS;
    const timeMax = stat.timeRange.max + ONE_HOUR_MS;
    const kuTracksInRange = secondaryRadarTracks.filter((f) => {
      if (String(f.trackId) !== String(kuId)) return false;
      const timestamp = getFeatureTimestamp(f);
      return timestamp > 0 && timestamp >= timeMin && timestamp <= timeMax;
    });
    const kuCount = kuTracksInRange.length;
    const fusedCount = stat.count;
    const accuracy = kuCount > 0 ? fusedCount / kuCount : 0;
    kuAccuracyData.push({
      id: kuId,
      accuracy: Math.min(accuracy, 1),
      fusedCount,
      kuCount,
      fusionTrackIds: Array.from(stat.fusionTrackIds),
      selfReportIds: Array.from(stat.selfReportIds),
    });
  });
  kuAccuracyData.sort((a, b) => b.accuracy - a.accuracy);

  return { birdTrackAccuracy: birdAccuracyData, kuRadarAccuracy: kuAccuracyData };
}

function calculateRecall(features: EvalTrackFeature[]): Pick<
  TrackEvalMetricsResult,
  "birdTrackRecall" | "kuRadarRecall"
> {
  const airFusionTracksWithSelfReport = features.filter((f) => {
    if (f.sensorId !== 6) return false;
    return getAirSelfReportId(f.originalData) !== undefined;
  });

  if (airFusionTracksWithSelfReport.length === 0) {
    return { birdTrackRecall: [], kuRadarRecall: [] };
  }

  const selfReportIdStats = new Map<
    string,
    { selfReportCount: number; birdCount: number; kuCount: number }
  >();

  airFusionTracksWithSelfReport.forEach((f) => {
    const sources = parseAirFusionSources(f.originalData);
    const selfReportId = sources.selfReport;
    if (selfReportId === undefined) return;
    const selfReportIdStr = String(selfReportId);
    if (!selfReportIdStats.has(selfReportIdStr)) {
      selfReportIdStats.set(selfReportIdStr, {
        selfReportCount: 0,
        birdCount: 0,
        kuCount: 0,
      });
    }
    const stat = selfReportIdStats.get(selfReportIdStr)!;
    stat.selfReportCount++;
    if (sources.bird !== undefined) stat.birdCount++;
    if (getAirSecondaryRadarId(sources) !== undefined) stat.kuCount++;
  });

  const birdRecallData: BirdTrackRecallItem[] = [];
  const kuRecallData: KuRadarRecallItem[] = [];
  const totalSelfReportIds = selfReportIdStats.size;
  const totalFusionTracks = airFusionTracksWithSelfReport.length;

  selfReportIdStats.forEach((stat, selfReportId) => {
    const selfReportCount = Number(stat.selfReportCount) || 0;
    const birdCount = Number(stat.birdCount) || 0;
    const kuCount = Number(stat.kuCount) || 0;
    const birdRecall = selfReportCount > 0 ? birdCount / selfReportCount : 0;
    birdRecallData.push({
      id: selfReportId,
      recall: Number.isNaN(birdRecall) ? 0 : Math.min(birdRecall, 1),
      birdCount,
      selfReportCount,
      totalSelfReportIds,
      totalFusionTracks,
    });
    const kuRecall = selfReportCount > 0 ? kuCount / selfReportCount : 0;
    kuRecallData.push({
      id: selfReportId,
      recall: Number.isNaN(kuRecall) ? 0 : Math.min(kuRecall, 1),
      kuCount,
      selfReportCount,
      totalSelfReportIds,
      totalFusionTracks,
    });
  });

  birdRecallData.sort((a, b) => b.recall - a.recall);
  kuRecallData.sort((a, b) => b.recall - a.recall);
  return { birdTrackRecall: birdRecallData, kuRadarRecall: kuRecallData };
}

function calculateFalseAlarm(features: EvalTrackFeature[]): Pick<
  TrackEvalMetricsResult,
  "birdTrackFalseAlarm" | "kuRadarFalseAlarm"
> {
  const airFusionTracks = features.filter((f) => {
    if (f.sensorId !== 6) return false;
    return getAirSelfReportId(f.originalData) !== undefined;
  });

  if (airFusionTracks.length === 0) {
    return { birdTrackFalseAlarm: [], kuRadarFalseAlarm: [] };
  }

  const birdTrackIdCounts = new Map<string, IdCountStat>();
  const kuRadarIdCounts = new Map<string, IdCountStat>();

  airFusionTracks.forEach((f) => {
    const originalData = f.originalData;
    const sources = parseAirFusionSources(originalData);
    const timestamp = getFeatureTimestamp(f);
    const fusionTrackId = f.trackId;
    const selfReportId = sources.selfReport;

    accumulateAirRadarIdCount(
      birdTrackIdCounts,
      sources.bird,
      fusionTrackId,
      selfReportId,
      timestamp,
    );
    accumulateAirRadarIdCount(
      kuRadarIdCounts,
      getAirSecondaryRadarId(sources),
      fusionTrackId,
      selfReportId,
      timestamp,
    );
  });

  const birdTracks = features.filter((f) => f.sensorId === 5);
  const birdFalseAlarmData: BirdTrackFalseAlarmItem[] = [];
  birdTrackIdCounts.forEach((stat, birdId) => {
    const timeMin = stat.timeRange.min - ONE_HOUR_MS;
    const timeMax = stat.timeRange.max + ONE_HOUR_MS;
    const birdTracksInRange = birdTracks.filter((f) => {
      if (String(f.trackId) !== String(birdId)) return false;
      const timestamp = getFeatureTimestamp(f);
      return timestamp > 0 && timestamp >= timeMin && timestamp <= timeMax;
    });
    const birdCount = birdTracksInRange.length;
    const fusedCount = stat.count;
    const falseAlarm = birdCount > 0 ? (birdCount - fusedCount) / birdCount : 0;
    const falseAlarmValue = Number.isNaN(falseAlarm)
      ? 0
      : Math.max(0, Math.min(falseAlarm, 1));
    birdFalseAlarmData.push({
      id: birdId,
      falseAlarm: falseAlarmValue,
      fusedCount,
      birdCount,
      fusionTrackIds: Array.from(stat.fusionTrackIds),
      selfReportIds: Array.from(stat.selfReportIds),
    });
  });
  birdFalseAlarmData.sort((a, b) => b.falseAlarm - a.falseAlarm);

  const secondaryRadarTracksForFalseAlarm = features.filter(
    (f) => f.sensorId === 7 || f.sensorId === 203,
  );
  const kuFalseAlarmData: KuRadarFalseAlarmItem[] = [];
  kuRadarIdCounts.forEach((stat, kuId) => {
    const timeMin = stat.timeRange.min - ONE_HOUR_MS;
    const timeMax = stat.timeRange.max + ONE_HOUR_MS;
    const kuTracksInRange = secondaryRadarTracksForFalseAlarm.filter((f) => {
      if (String(f.trackId) !== String(kuId)) return false;
      const timestamp = getFeatureTimestamp(f);
      return timestamp > 0 && timestamp >= timeMin && timestamp <= timeMax;
    });
    const kuCount = kuTracksInRange.length;
    const fusedCount = stat.count;
    const falseAlarm = kuCount > 0 ? (kuCount - fusedCount) / kuCount : 0;
    const falseAlarmValue = Number.isNaN(falseAlarm)
      ? 0
      : Math.max(0, Math.min(falseAlarm, 1));
    kuFalseAlarmData.push({
      id: kuId,
      falseAlarm: falseAlarmValue,
      fusedCount,
      kuCount,
      fusionTrackIds: Array.from(stat.fusionTrackIds),
      selfReportIds: Array.from(stat.selfReportIds),
    });
  });
  kuFalseAlarmData.sort((a, b) => b.falseAlarm - a.falseAlarm);

  return { birdTrackFalseAlarm: birdFalseAlarmData, kuRadarFalseAlarm: kuFalseAlarmData };
}

// ---------------------------------------------------------------------------
// Tracking stability (points + duration + max duration + break + change batch)
// ---------------------------------------------------------------------------

function calculateTrackingStability(
  features: EvalTrackFeature[],
  radarChannels: TrackEvalRadarChannels,
): Pick<
  TrackEvalMetricsResult,
  | "seaFusionStability"
  | "airFusionStability"
  | "seaFusionStabilityAvg"
  | "airFusionStabilityAvg"
  | "seaFusionStabilityByAis"
  | "airFusionStabilityBySelfReport"
  | "seaFusionStabilityDuration"
  | "airFusionStabilityDuration"
  | "seaFusionStabilityDurationAvg"
  | "airFusionStabilityDurationAvg"
  | "seaFusionStabilityDurationByAis"
  | "airFusionStabilityDurationBySelfReport"
  | "seaMaxTrackingDuration"
  | "airMaxTrackingDuration"
  | "seaMaxTrackingDurationAvg"
  | "airMaxTrackingDurationAvg"
  | "seaBreakCount"
  | "airBreakCount"
  | "seaBreakCountAvg"
  | "airBreakCountAvg"
  | "seaChangeBatchCount"
  | "airChangeBatchCount"
  | "seaChangeBatchCountAvg"
  | "airChangeBatchCountAvg"
> {
  const pointStability = calculateTrackingStabilityPoints(features);
  const duration = calculateTrackingStabilityDuration(features);
  const maxDuration = calculateMaxTrackingDuration(features, radarChannels);
  const breakCounts = calculateBreakCount(features);
  const changeBatch = calculateChangeBatchCount(features, radarChannels);
  return { ...pointStability, ...duration, ...maxDuration, ...breakCounts, ...changeBatch };
}

function calculateTrackingStabilityPoints(
  features: EvalTrackFeature[],
): Pick<
  TrackEvalMetricsResult,
  | "seaFusionStability"
  | "airFusionStability"
  | "seaFusionStabilityAvg"
  | "airFusionStabilityAvg"
  | "seaFusionStabilityByAis"
  | "airFusionStabilityBySelfReport"
> {
  const seaFusionStability = new Map<number | string, SeaFusionStabilityEntry>();
  const airFusionStability = new Map<number | string, AirFusionStabilityEntry>();

  const seaFusionTracks = features.filter((f) => f.sensorId === 0);
  const aisIdStats = new Map<
    string,
    { fusionTrackIds: Set<number | string>; radarCount: number }
  >();

  seaFusionTracks.forEach((f) => {
    const originalData = f.originalData;
    const aisId = originalData.original_track_id2;
    if (!isValidOriginalId(aisId)) return;
    const aisIdStr = String(aisId);
    const fusionTrackId = f.trackId;
    if (!aisIdStats.has(aisIdStr)) {
      aisIdStats.set(aisIdStr, { fusionTrackIds: new Set(), radarCount: 0 });
    }
    const stat = aisIdStats.get(aisIdStr)!;
    stat.fusionTrackIds.add(fusionTrackId);
    const hasYuanYao = isValidOriginalId(originalData.original_track_id1);
    const hasJingZiTou = isValidOriginalId(originalData.original_track_id3);
    if (hasYuanYao || hasJingZiTou) stat.radarCount++;
  });

  const seaStabilityByAisData: SeaFusionStabilityByAisItem[] = [];
  let seaStabilitySum = 0;
  let seaStabilityCount = 0;
  aisIdStats.forEach((stat, aisId) => {
    const aisCount = stat.fusionTrackIds.size;
    const radarCount = stat.radarCount;
    const stability = aisCount > 0 ? radarCount / aisCount : 0;
    const stabilityValue = Number.isNaN(stability) ? 0 : Math.max(0, Math.min(stability, 1));
    stat.fusionTrackIds.forEach((fusionTrackId) => {
      seaFusionStability.set(fusionTrackId, { stability: stabilityValue, radarCount, aisCount });
    });
    if (aisCount > 0) {
      seaStabilityByAisData.push({ aisId, stability: stabilityValue });
      seaStabilitySum += stabilityValue;
      seaStabilityCount++;
    }
  });
  seaStabilityByAisData.sort((a, b) => b.stability - a.stability);

  const airFusionTracks = features.filter((f) => f.sensorId === 6);
  const selfReportIdStats = new Map<
    string,
    { fusionTrackIds: Set<number | string>; radarCount: number }
  >();

  airFusionTracks.forEach((f) => {
    const sources = parseAirFusionSources(f.originalData);
    const selfReportId = sources.selfReport;
    if (selfReportId === undefined) return;
    const selfReportIdStr = String(selfReportId);
    const fusionTrackId = f.trackId;
    if (!selfReportIdStats.has(selfReportIdStr)) {
      selfReportIdStats.set(selfReportIdStr, { fusionTrackIds: new Set(), radarCount: 0 });
    }
    const stat = selfReportIdStats.get(selfReportIdStr)!;
    stat.fusionTrackIds.add(fusionTrackId);
    if (hasAirRadarBesidesSelfReport(sources)) stat.radarCount++;
  });

  const airStabilityBySelfReportData: AirFusionStabilityBySelfReportItem[] = [];
  let airStabilitySum = 0;
  let airStabilityCount = 0;
  selfReportIdStats.forEach((stat, selfReportId) => {
    const selfReportCount = stat.fusionTrackIds.size;
    const radarCount = stat.radarCount;
    const stability = selfReportCount > 0 ? radarCount / selfReportCount : 0;
    const stabilityValue = Number.isNaN(stability) ? 0 : Math.max(0, Math.min(stability, 1));
    stat.fusionTrackIds.forEach((fusionTrackId) => {
      airFusionStability.set(fusionTrackId, {
        stability: stabilityValue,
        radarCount,
        selfReportCount,
      });
    });
    if (selfReportCount > 0) {
      airStabilityBySelfReportData.push({ selfReportId, stability: stabilityValue });
      airStabilitySum += stabilityValue;
      airStabilityCount++;
    }
  });
  airStabilityBySelfReportData.sort((a, b) => b.stability - a.stability);

  return {
    seaFusionStability,
    airFusionStability,
    seaFusionStabilityAvg: seaStabilityCount > 0 ? seaStabilitySum / seaStabilityCount : null,
    airFusionStabilityAvg: airStabilityCount > 0 ? airStabilitySum / airStabilityCount : null,
    seaFusionStabilityByAis: seaStabilityByAisData,
    airFusionStabilityBySelfReport: airStabilityBySelfReportData,
  };
}

function calculateTrackingStabilityDuration(
  features: EvalTrackFeature[],
): Pick<
  TrackEvalMetricsResult,
  | "seaFusionStabilityDuration"
  | "airFusionStabilityDuration"
  | "seaFusionStabilityDurationAvg"
  | "airFusionStabilityDurationAvg"
  | "seaFusionStabilityDurationByAis"
  | "airFusionStabilityDurationBySelfReport"
> {
  const seaFusionStabilityDuration = new Map<number | string, SeaFusionStabilityDurationEntry>();
  const airFusionStabilityDuration = new Map<number | string, AirFusionStabilityDurationEntry>();

  const seaFusionTracks = features.filter((f) => f.sensorId === 0);
  const seaAisTimeRanges = new Map<string, { min: number; max: number }>();
  const seaAisRadarTimeRanges = new Map<string, { min: number; max: number }>();
  const seaAisToFusionTrackIds = new Map<string, Set<number | string>>();

  seaFusionTracks.forEach((f) => {
    const originalData = f.originalData;
    const aisId = originalData.original_track_id2;
    if (!isValidOriginalId(aisId)) return;
    const fusionTrackId = f.trackId;
    const aisIdStr = String(aisId);
    const timestamp = getFeatureTimestamp(f);
    if (timestamp === 0) return;

    if (!seaAisTimeRanges.has(aisIdStr)) {
      seaAisTimeRanges.set(aisIdStr, { min: timestamp, max: timestamp });
    } else {
      const range = seaAisTimeRanges.get(aisIdStr)!;
      range.min = Math.min(range.min, timestamp);
      range.max = Math.max(range.max, timestamp);
    }
    if (!seaAisToFusionTrackIds.has(aisIdStr)) {
      seaAisToFusionTrackIds.set(aisIdStr, new Set());
    }
    seaAisToFusionTrackIds.get(aisIdStr)!.add(fusionTrackId);

    const hasYuanYao = isValidOriginalId(originalData.original_track_id1);
    const hasJingZiTou = isValidOriginalId(originalData.original_track_id3);
    if (hasYuanYao || hasJingZiTou) {
      if (!seaAisRadarTimeRanges.has(aisIdStr)) {
        seaAisRadarTimeRanges.set(aisIdStr, { min: timestamp, max: timestamp });
      } else {
        const range = seaAisRadarTimeRanges.get(aisIdStr)!;
        range.min = Math.min(range.min, timestamp);
        range.max = Math.max(range.max, timestamp);
      }
    }
  });

  const seaDurationStabilityByAisData: SeaFusionStabilityByAisItem[] = [];
  let seaDurationStabilitySum = 0;
  let seaDurationStabilityCount = 0;
  seaAisTimeRanges.forEach((aisRange, aisIdStr) => {
    const aisDuration = aisRange.max - aisRange.min;
    const radarRange = seaAisRadarTimeRanges.get(aisIdStr);
    if (radarRange && aisDuration > 0) {
      const radarDuration = radarRange.max - radarRange.min;
      const stability = aisDuration > 0 ? radarDuration / aisDuration : 0;
      const stabilityValue = Number.isNaN(stability) ? 0 : Math.max(0, Math.min(stability, 1));
      const fusionTrackIds = seaAisToFusionTrackIds.get(aisIdStr);
      fusionTrackIds?.forEach((fusionTrackId) => {
        seaFusionStabilityDuration.set(fusionTrackId, {
          stability: stabilityValue,
          fusionDuration: radarDuration,
          aisDuration,
        });
      });
      seaDurationStabilityByAisData.push({ aisId: aisIdStr, stability: stabilityValue });
      seaDurationStabilitySum += stabilityValue;
      seaDurationStabilityCount++;
    }
  });
  seaDurationStabilityByAisData.sort((a, b) => b.stability - a.stability);

  const airFusionTracks = features.filter((f) => f.sensorId === 6);
  const airSelfReportTimeRanges = new Map<string, { min: number; max: number }>();
  const airSelfReportRadarTimeRanges = new Map<string, { min: number; max: number }>();
  const airSelfReportToFusionTrackIds = new Map<string, Set<number | string>>();

  airFusionTracks.forEach((f) => {
    const sources = parseAirFusionSources(f.originalData);
    const selfReportId = sources.selfReport;
    if (selfReportId === undefined) return;
    const fusionTrackId = f.trackId;
    const selfReportIdStr = String(selfReportId);
    const timestamp = getFeatureTimestamp(f);
    if (timestamp === 0) return;

    if (!airSelfReportTimeRanges.has(selfReportIdStr)) {
      airSelfReportTimeRanges.set(selfReportIdStr, { min: timestamp, max: timestamp });
    } else {
      const range = airSelfReportTimeRanges.get(selfReportIdStr)!;
      range.min = Math.min(range.min, timestamp);
      range.max = Math.max(range.max, timestamp);
    }
    if (!airSelfReportToFusionTrackIds.has(selfReportIdStr)) {
      airSelfReportToFusionTrackIds.set(selfReportIdStr, new Set());
    }
    airSelfReportToFusionTrackIds.get(selfReportIdStr)!.add(fusionTrackId);

    if (hasAirRadarBesidesSelfReport(sources)) {
      if (!airSelfReportRadarTimeRanges.has(selfReportIdStr)) {
        airSelfReportRadarTimeRanges.set(selfReportIdStr, { min: timestamp, max: timestamp });
      } else {
        const range = airSelfReportRadarTimeRanges.get(selfReportIdStr)!;
        range.min = Math.min(range.min, timestamp);
        range.max = Math.max(range.max, timestamp);
      }
    }
  });

  const airDurationStabilityBySelfReportData: AirFusionStabilityBySelfReportItem[] = [];
  let airDurationStabilitySum = 0;
  let airDurationStabilityCount = 0;
  airSelfReportTimeRanges.forEach((selfReportRange, selfReportIdStr) => {
    const selfReportDuration = selfReportRange.max - selfReportRange.min;
    const radarRange = airSelfReportRadarTimeRanges.get(selfReportIdStr);
    if (radarRange && selfReportDuration > 0) {
      const radarDuration = radarRange.max - radarRange.min;
      const stability = selfReportDuration > 0 ? radarDuration / selfReportDuration : 0;
      const stabilityValue = Number.isNaN(stability) ? 0 : Math.max(0, Math.min(stability, 1));
      const fusionTrackIds = airSelfReportToFusionTrackIds.get(selfReportIdStr);
      fusionTrackIds?.forEach((fusionTrackId) => {
        airFusionStabilityDuration.set(fusionTrackId, {
          stability: stabilityValue,
          fusionDuration: radarDuration,
          selfReportDuration,
        });
      });
      airDurationStabilityBySelfReportData.push({
        selfReportId: selfReportIdStr,
        stability: stabilityValue,
      });
      airDurationStabilitySum += stabilityValue;
      airDurationStabilityCount++;
    }
  });
  airDurationStabilityBySelfReportData.sort((a, b) => b.stability - a.stability);

  return {
    seaFusionStabilityDuration,
    airFusionStabilityDuration,
    seaFusionStabilityDurationAvg:
      seaDurationStabilityCount > 0 ? seaDurationStabilitySum / seaDurationStabilityCount : null,
    airFusionStabilityDurationAvg:
      airDurationStabilityCount > 0 ? airDurationStabilitySum / airDurationStabilityCount : null,
    seaFusionStabilityDurationByAis: seaDurationStabilityByAisData,
    airFusionStabilityDurationBySelfReport: airDurationStabilityBySelfReportData,
  };
}

function calculateMaxTrackingDuration(
  features: EvalTrackFeature[],
  radarChannels: TrackEvalRadarChannels,
): Pick<
  TrackEvalMetricsResult,
  | "seaMaxTrackingDuration"
  | "airMaxTrackingDuration"
  | "seaMaxTrackingDurationAvg"
  | "airMaxTrackingDurationAvg"
> {
  const seaRadar1Label = shortTrackEvalRadarLabel(radarChannels.radar1?.name, "码头");
  const seaRadar2Label = shortTrackEvalRadarLabel(radarChannels.radar2?.name, "靖子头");
  const airRadar1Label = shortTrackEvalRadarLabel(radarChannels.radar5?.name, "探鸟");
  const airRadar2Label = shortTrackEvalRadarLabel(radarChannels.radar6?.name, "反无车");

  const seaFusionTracks = features.filter((f) => f.sensorId === 0);
  const seaAisRadarStats = new Map<
    string,
    {
      aisTimeRange: { min: number; max: number };
      radarTimeRanges: Map<
        string,
        {
          min: number;
          max: number;
          radarId: number | string;
          radarType: string;
          fusionTrackIds: Set<number | string>;
        }
      >;
    }
  >();

  seaFusionTracks.forEach((f) => {
    const originalData = f.originalData;
    const aisId = originalData.original_track_id2;
    if (!isValidOriginalId(aisId)) return;
    const fusionTrackId = f.trackId;
    const timestamp = getFeatureTimestamp(f);
    if (timestamp === 0) return;
    const aisIdStr = String(aisId);
    if (!seaAisRadarStats.has(aisIdStr)) {
      seaAisRadarStats.set(aisIdStr, {
        aisTimeRange: { min: timestamp, max: timestamp },
        radarTimeRanges: new Map(),
      });
    }
    const stat = seaAisRadarStats.get(aisIdStr)!;
    stat.aisTimeRange.min = Math.min(stat.aisTimeRange.min, timestamp);
    stat.aisTimeRange.max = Math.max(stat.aisTimeRange.max, timestamp);

    const yuanYaoId = originalData.original_track_id1;
    const jingZiTouId = originalData.original_track_id3;
    if (isValidOriginalId(yuanYaoId)) {
      const radarIdStr = `${seaRadar1Label}_${yuanYaoId}`;
      if (!stat.radarTimeRanges.has(radarIdStr)) {
        stat.radarTimeRanges.set(radarIdStr, {
          min: timestamp,
          max: timestamp,
          radarId: yuanYaoId as number | string,
          radarType: seaRadar1Label,
          fusionTrackIds: new Set([fusionTrackId]),
        });
      } else {
        const radarRange = stat.radarTimeRanges.get(radarIdStr)!;
        radarRange.min = Math.min(radarRange.min, timestamp);
        radarRange.max = Math.max(radarRange.max, timestamp);
        radarRange.fusionTrackIds.add(fusionTrackId);
      }
    }
    if (isValidOriginalId(jingZiTouId)) {
      const radarIdStr = `${seaRadar2Label}_${jingZiTouId}`;
      if (!stat.radarTimeRanges.has(radarIdStr)) {
        stat.radarTimeRanges.set(radarIdStr, {
          min: timestamp,
          max: timestamp,
          radarId: jingZiTouId as number | string,
          radarType: seaRadar2Label,
          fusionTrackIds: new Set([fusionTrackId]),
        });
      } else {
        const radarRange = stat.radarTimeRanges.get(radarIdStr)!;
        radarRange.min = Math.min(radarRange.min, timestamp);
        radarRange.max = Math.max(radarRange.max, timestamp);
        radarRange.fusionTrackIds.add(fusionTrackId);
      }
    }
  });

  const seaMaxDurationData: SeaMaxTrackingDurationItem[] = [];
  let seaMaxDurationSum = 0;
  let seaMaxDurationCount = 0;
  seaAisRadarStats.forEach((stat, aisIdStr) => {
    const aisDuration = stat.aisTimeRange.max - stat.aisTimeRange.min;
    if (aisDuration <= 0 || stat.radarTimeRanges.size === 0) return;
    let longestRadarId: number | string | null = null;
    let longestRadarDuration = 0;
    let longestRadarType = "";
    let longestRadarFusionTrackIds: (number | string)[] = [];
    stat.radarTimeRanges.forEach((radarRange) => {
      const radarDuration = radarRange.max - radarRange.min;
      if (radarDuration > longestRadarDuration) {
        longestRadarDuration = radarDuration;
        longestRadarId = radarRange.radarId;
        longestRadarType = radarRange.radarType;
        longestRadarFusionTrackIds = Array.from(radarRange.fusionTrackIds);
      }
    });
    if (longestRadarId !== null && longestRadarDuration > 0) {
      const maxDuration = aisDuration > 0 ? longestRadarDuration / aisDuration : 0;
      const maxDurationValue = Number.isNaN(maxDuration)
        ? 0
        : Math.max(0, Math.min(maxDuration, 1));
      seaMaxDurationData.push({
        aisId: aisIdStr,
        maxDuration: maxDurationValue,
        longestRadarId,
        longestRadarType,
        longestRadarDuration,
        aisDuration,
        fusionTrackIds: longestRadarFusionTrackIds,
      });
      seaMaxDurationSum += maxDurationValue;
      seaMaxDurationCount++;
    }
  });
  seaMaxDurationData.sort((a, b) => b.maxDuration - a.maxDuration);

  const airFusionTracks = features.filter((f) => f.sensorId === 6);
  const airSelfReportRadarStats = new Map<
    string,
    {
      selfReportTimeRange: { min: number; max: number };
      radarTimeRanges: Map<
        string,
        {
          min: number;
          max: number;
          radarId: number | string;
          radarType: string;
          fusionTrackIds: Set<number | string>;
        }
      >;
    }
  >();

  airFusionTracks.forEach((f) => {
    const sources = parseAirFusionSources(f.originalData);
    const selfReportId = sources.selfReport;
    if (selfReportId === undefined) return;
    const fusionTrackId = f.trackId;
    const timestamp = getFeatureTimestamp(f);
    if (timestamp === 0) return;
    const selfReportIdStr = String(selfReportId);
    if (!airSelfReportRadarStats.has(selfReportIdStr)) {
      airSelfReportRadarStats.set(selfReportIdStr, {
        selfReportTimeRange: { min: timestamp, max: timestamp },
        radarTimeRanges: new Map(),
      });
    }
    const stat = airSelfReportRadarStats.get(selfReportIdStr)!;
    stat.selfReportTimeRange.min = Math.min(stat.selfReportTimeRange.min, timestamp);
    stat.selfReportTimeRange.max = Math.max(stat.selfReportTimeRange.max, timestamp);

    for (const radar of listAirFusionRadars(sources, {
      bird: airRadar1Label,
      secondary: airRadar2Label,
    })) {
      const radarIdStr = `${radar.label}_${radar.id}`;
      if (!stat.radarTimeRanges.has(radarIdStr)) {
        stat.radarTimeRanges.set(radarIdStr, {
          min: timestamp,
          max: timestamp,
          radarId: radar.id,
          radarType: radar.label,
          fusionTrackIds: new Set([fusionTrackId]),
        });
      } else {
        const radarRange = stat.radarTimeRanges.get(radarIdStr)!;
        radarRange.min = Math.min(radarRange.min, timestamp);
        radarRange.max = Math.max(radarRange.max, timestamp);
        radarRange.fusionTrackIds.add(fusionTrackId);
      }
    }
  });

  const airMaxDurationData: AirMaxTrackingDurationItem[] = [];
  let airMaxDurationSum = 0;
  let airMaxDurationCount = 0;
  airSelfReportRadarStats.forEach((stat, selfReportIdStr) => {
    const selfReportDuration = stat.selfReportTimeRange.max - stat.selfReportTimeRange.min;
    if (selfReportDuration <= 0 || stat.radarTimeRanges.size === 0) return;
    let longestRadarId: number | string | null = null;
    let longestRadarDuration = 0;
    let longestRadarType = "";
    let longestRadarFusionTrackIds: (number | string)[] = [];
    stat.radarTimeRanges.forEach((radarRange) => {
      const radarDuration = radarRange.max - radarRange.min;
      if (radarDuration > longestRadarDuration) {
        longestRadarDuration = radarDuration;
        longestRadarId = radarRange.radarId;
        longestRadarType = radarRange.radarType;
        longestRadarFusionTrackIds = Array.from(radarRange.fusionTrackIds);
      }
    });
    if (longestRadarId !== null && longestRadarDuration > 0) {
      const maxDuration =
        selfReportDuration > 0 ? longestRadarDuration / selfReportDuration : 0;
      const maxDurationValue = Number.isNaN(maxDuration)
        ? 0
        : Math.max(0, Math.min(maxDuration, 1));
      airMaxDurationData.push({
        selfReportId: selfReportIdStr,
        maxDuration: maxDurationValue,
        longestRadarId,
        longestRadarType,
        longestRadarDuration,
        selfReportDuration,
        fusionTrackIds: longestRadarFusionTrackIds,
      });
      airMaxDurationSum += maxDurationValue;
      airMaxDurationCount++;
    }
  });
  airMaxDurationData.sort((a, b) => b.maxDuration - a.maxDuration);

  return {
    seaMaxTrackingDuration: seaMaxDurationData,
    airMaxTrackingDuration: airMaxDurationData,
    seaMaxTrackingDurationAvg:
      seaMaxDurationCount > 0 ? seaMaxDurationSum / seaMaxDurationCount : null,
    airMaxTrackingDurationAvg:
      airMaxDurationCount > 0 ? airMaxDurationSum / airMaxDurationCount : null,
  };
}

function calculateBreakCount(
  features: EvalTrackFeature[],
): Pick<
  TrackEvalMetricsResult,
  "seaBreakCount" | "airBreakCount" | "seaBreakCountAvg" | "airBreakCountAvg"
> {
  const seaFusionTracks = features.filter((f) => f.sensorId === 0);
  const seaAisTracks = new Map<string, Array<{ timestamp: number; hasRadar: boolean }>>();

  seaFusionTracks.forEach((f) => {
    const originalData = f.originalData;
    const aisId = originalData.original_track_id2;
    if (!isValidOriginalId(aisId)) return;
    const timestamp = getFeatureTimestamp(f);
    if (timestamp === 0) return;
    const hasRadar =
      isValidOriginalId(originalData.original_track_id1) ||
      isValidOriginalId(originalData.original_track_id3);
    const aisIdStr = String(aisId);
    if (!seaAisTracks.has(aisIdStr)) seaAisTracks.set(aisIdStr, []);
    seaAisTracks.get(aisIdStr)!.push({ timestamp, hasRadar });
  });

  const seaBreakCountData: SeaBreakCountItem[] = [];
  let seaBreakCountSum = 0;
  let seaBreakCountCount = 0;
  seaAisTracks.forEach((tracks, aisIdStr) => {
    tracks.sort((a, b) => a.timestamp - b.timestamp);
    let breakCount = 0;
    let consecutiveNoRadar = 0;
    tracks.forEach((track) => {
      if (!track.hasRadar) {
        consecutiveNoRadar++;
        if (consecutiveNoRadar === 5) {
          breakCount++;
          consecutiveNoRadar = 0;
        }
      } else {
        consecutiveNoRadar = 0;
      }
    });
    seaBreakCountData.push({ aisId: aisIdStr, breakCount });
    seaBreakCountSum += breakCount;
    seaBreakCountCount++;
  });
  seaBreakCountData.sort((a, b) => b.breakCount - a.breakCount);

  const airFusionTracks = features.filter((f) => f.sensorId === 6);
  const airSelfReportTracks = new Map<string, Array<{ timestamp: number; hasRadar: boolean }>>();

  airFusionTracks.forEach((f) => {
    const sources = parseAirFusionSources(f.originalData);
    const selfReportId = sources.selfReport;
    if (selfReportId === undefined) return;
    const timestamp = getFeatureTimestamp(f);
    if (timestamp === 0) return;
    const hasRadar = hasAirRadarBesidesSelfReport(sources);
    const selfReportIdStr = String(selfReportId);
    if (!airSelfReportTracks.has(selfReportIdStr)) airSelfReportTracks.set(selfReportIdStr, []);
    airSelfReportTracks.get(selfReportIdStr)!.push({ timestamp, hasRadar });
  });

  const airBreakCountData: AirBreakCountItem[] = [];
  let airBreakCountSum = 0;
  let airBreakCountCount = 0;
  airSelfReportTracks.forEach((tracks, selfReportIdStr) => {
    tracks.sort((a, b) => a.timestamp - b.timestamp);
    let breakCount = 0;
    let consecutiveNoRadar = 0;
    tracks.forEach((track) => {
      if (!track.hasRadar) {
        consecutiveNoRadar++;
        if (consecutiveNoRadar === 5) {
          breakCount++;
          consecutiveNoRadar = 0;
        }
      } else {
        consecutiveNoRadar = 0;
      }
    });
    airBreakCountData.push({ selfReportId: selfReportIdStr, breakCount });
    airBreakCountSum += breakCount;
    airBreakCountCount++;
  });
  airBreakCountData.sort((a, b) => b.breakCount - a.breakCount);

  return {
    seaBreakCount: seaBreakCountData,
    airBreakCount: airBreakCountData,
    seaBreakCountAvg: seaBreakCountCount > 0 ? seaBreakCountSum / seaBreakCountCount : null,
    airBreakCountAvg: airBreakCountCount > 0 ? airBreakCountSum / airBreakCountCount : null,
  };
}

function calculateChangeBatchCount(
  features: EvalTrackFeature[],
  radarChannels: TrackEvalRadarChannels,
): Pick<
  TrackEvalMetricsResult,
  | "seaChangeBatchCount"
  | "airChangeBatchCount"
  | "seaChangeBatchCountAvg"
  | "airChangeBatchCountAvg"
> {
  const seaRadar1Label = shortTrackEvalRadarLabel(radarChannels.radar1?.name, "码头");
  const seaRadar2Label = shortTrackEvalRadarLabel(radarChannels.radar2?.name, "靖子头");
  const airRadar1Label = shortTrackEvalRadarLabel(radarChannels.radar5?.name, "探鸟");
  const airRadar2Label = shortTrackEvalRadarLabel(radarChannels.radar6?.name, "反无车");

  const seaFusionTracks = features.filter((f) => f.sensorId === 0);
  const seaAisTracks = new Map<string, Array<{ timestamp: number; radarId: string | null }>>();

  seaFusionTracks.forEach((f) => {
    const originalData = f.originalData;
    const aisId = originalData.original_track_id2;
    if (!isValidOriginalId(aisId)) return;
    const timestamp = getFeatureTimestamp(f);
    if (timestamp === 0) return;
    const yuanYaoId = originalData.original_track_id1;
    const jingZiTouId = originalData.original_track_id3;
    const parts: string[] = [];
    if (isValidOriginalId(yuanYaoId)) parts.push(`${seaRadar1Label}_${yuanYaoId}`);
    if (isValidOriginalId(jingZiTouId)) parts.push(`${seaRadar2Label}_${jingZiTouId}`);
    const radarIdKey = parts.length > 0 ? parts.sort().join(",") : null;
    const aisIdStr = String(aisId);
    if (!seaAisTracks.has(aisIdStr)) seaAisTracks.set(aisIdStr, []);
    seaAisTracks.get(aisIdStr)!.push({ timestamp, radarId: radarIdKey });
  });

  const seaChangeBatchData: SeaChangeBatchCountItem[] = [];
  let seaChangeBatchSum = 0;
  let seaChangeBatchCountNum = 0;
  seaAisTracks.forEach((tracks, aisIdStr) => {
    tracks.sort((a, b) => a.timestamp - b.timestamp);
    let changeBatchCount = 0;
    let prevRadarId: string | null = null;
    tracks.forEach((track) => {
      const currentRadarId = track.radarId;
      if (
        prevRadarId !== null &&
        currentRadarId !== null &&
        prevRadarId !== currentRadarId
      ) {
        changeBatchCount++;
      }
      if (currentRadarId !== null) prevRadarId = currentRadarId;
    });
    seaChangeBatchData.push({ aisId: aisIdStr, changeBatchCount });
    seaChangeBatchSum += changeBatchCount;
    seaChangeBatchCountNum++;
  });
  seaChangeBatchData.sort((a, b) => b.changeBatchCount - a.changeBatchCount);

  const airFusionTracks = features.filter((f) => f.sensorId === 6);
  const airSelfReportTracks = new Map<string, Array<{ timestamp: number; radarId: string | null }>>();

  airFusionTracks.forEach((f) => {
    const sources = parseAirFusionSources(f.originalData);
    const selfReportId = sources.selfReport;
    if (selfReportId === undefined) return;
    const timestamp = getFeatureTimestamp(f);
    if (timestamp === 0) return;
    const parts = listAirFusionRadars(sources, {
      bird: airRadar1Label,
      secondary: airRadar2Label,
    }).map((radar) => `${radar.label}_${radar.id}`);
    const radarIdKey = parts.length > 0 ? parts.sort().join(",") : null;
    const selfReportIdStr = String(selfReportId);
    if (!airSelfReportTracks.has(selfReportIdStr)) airSelfReportTracks.set(selfReportIdStr, []);
    airSelfReportTracks.get(selfReportIdStr)!.push({ timestamp, radarId: radarIdKey });
  });

  const airChangeBatchData: AirChangeBatchCountItem[] = [];
  let airChangeBatchSum = 0;
  let airChangeBatchCountNum = 0;
  airSelfReportTracks.forEach((tracks, selfReportIdStr) => {
    tracks.sort((a, b) => a.timestamp - b.timestamp);
    let changeBatchCount = 0;
    let prevRadarId: string | null = null;
    tracks.forEach((track) => {
      const currentRadarId = track.radarId;
      if (
        prevRadarId !== null &&
        currentRadarId !== null &&
        prevRadarId !== currentRadarId
      ) {
        changeBatchCount++;
      }
      if (currentRadarId !== null) prevRadarId = currentRadarId;
    });
    airChangeBatchData.push({ selfReportId: selfReportIdStr, changeBatchCount });
    airChangeBatchSum += changeBatchCount;
    airChangeBatchCountNum++;
  });
  airChangeBatchData.sort((a, b) => b.changeBatchCount - a.changeBatchCount);

  return {
    seaChangeBatchCount: seaChangeBatchData,
    airChangeBatchCount: airChangeBatchData,
    seaChangeBatchCountAvg:
      seaChangeBatchCountNum > 0 ? seaChangeBatchSum / seaChangeBatchCountNum : null,
    airChangeBatchCountAvg:
      airChangeBatchCountNum > 0 ? airChangeBatchSum / airChangeBatchCountNum : null,
  };
}

// ---------------------------------------------------------------------------
// Error metrics (distance / height / azimuth / elevation / course / speed)
// ---------------------------------------------------------------------------

type IndexedTrackPoint = { track: EvalTrackFeature; timestamp: number };
type TrackIndex = Map<string, IndexedTrackPoint[]>;

interface InterpolatedPosition {
  lat: number;
  lon: number;
  height: number;
  course?: number;
  speed?: number;
}

interface PerPointErrorSample {
  fusionError: number;
  radar1Error: number | null;
  radar2Error: number | null;
  timestamp: number;
}

function buildTrackIndex(tracks: EvalTrackFeature[]): TrackIndex {
  const idMap = new Map<string, EvalTrackFeature[]>();
  tracks.forEach((track) => {
    const trackId = String(track.trackId ?? "");
    const originalId1 = String(track.originalData?.original_track_id1 ?? "");
    const originalId2 = String(track.originalData?.original_track_id2 ?? "");
    const ids = [trackId, originalId1, originalId2].filter(
      (id) => id && id !== "undefined" && id !== "null",
    );
    ids.forEach((id) => {
      if (!idMap.has(id)) idMap.set(id, []);
      idMap.get(id)!.push(track);
    });
  });

  const index: TrackIndex = new Map();
  idMap.forEach((trackList, id) => {
    const tracksWithTime = trackList
      .map((track) => {
        const timestamp = getFeatureTimestamp(track);
        return timestamp ? { track, timestamp } : null;
      })
      .filter((item): item is IndexedTrackPoint => item !== null)
      .sort((a, b) => a.timestamp - b.timestamp);
    if (tracksWithTime.length > 0) index.set(id, tracksWithTime);
  });
  return index;
}

function binarySearchClosest(
  sortedTracks: IndexedTrackPoint[],
  targetTime: number,
  maxTimeDiff = 1000,
): EvalTrackFeature | null {
  if (!sortedTracks.length) return null;
  let left = 0;
  let right = sortedTracks.length - 1;
  let closest: EvalTrackFeature | null = null;
  let minTimeDiff = maxTimeDiff;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const midTime = sortedTracks[mid].timestamp;
    const timeDiff = Math.abs(midTime - targetTime);
    if (timeDiff < minTimeDiff) {
      minTimeDiff = timeDiff;
      closest = sortedTracks[mid].track;
    }
    if (midTime < targetTime) left = mid + 1;
    else right = mid - 1;
  }
  return closest;
}

function binarySearchTwoClosest(
  sortedTracks: IndexedTrackPoint[],
  targetTime: number,
  maxTimeDiff = 120000,
): { before: EvalTrackFeature | null; after: EvalTrackFeature | null } | null {
  if (!sortedTracks.length) return null;
  let left = 0;
  let right = sortedTracks.length - 1;
  let before: EvalTrackFeature | null = null;
  let after: EvalTrackFeature | null = null;
  let minBeforeDiff = maxTimeDiff;
  let minAfterDiff = maxTimeDiff;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const midTime = sortedTracks[mid].timestamp;
    const timeDiff = midTime - targetTime;
    if (timeDiff <= 0 && Math.abs(timeDiff) < minBeforeDiff) {
      minBeforeDiff = Math.abs(timeDiff);
      before = sortedTracks[mid].track;
    }
    if (timeDiff >= 0 && timeDiff < minAfterDiff) {
      minAfterDiff = timeDiff;
      after = sortedTracks[mid].track;
    }
    if (midTime < targetTime) left = mid + 1;
    else right = mid - 1;
  }
  if (before || after) return { before, after };
  return null;
}

function interpolatePosition(
  beforeTrack: EvalTrackFeature | null,
  afterTrack: EvalTrackFeature | null,
  targetTime: number,
): InterpolatedPosition | null {
  if (!beforeTrack && !afterTrack) return null;
  const fromFeature = (t: EvalTrackFeature): InterpolatedPosition => ({
    lat: t.latitude,
    lon: t.longitude,
    height: t.altitude ?? 0,
    course: t.course,
    speed: t.speed,
  });
  if (!beforeTrack) return fromFeature(afterTrack!);
  if (!afterTrack) return fromFeature(beforeTrack);
  const beforeTime = getFeatureTimestamp(beforeTrack);
  const afterTime = getFeatureTimestamp(afterTrack);
  if (!beforeTime || !afterTime) return null;
  if (beforeTime === afterTime) return fromFeature(beforeTrack);
  const ratio = (targetTime - beforeTime) / (afterTime - beforeTime);
  const lat = beforeTrack.latitude + (afterTrack.latitude - beforeTrack.latitude) * ratio;
  const lon = beforeTrack.longitude + (afterTrack.longitude - beforeTrack.longitude) * ratio;
  const height = (beforeTrack.altitude ?? 0) + ((afterTrack.altitude ?? 0) - (beforeTrack.altitude ?? 0)) * ratio;
  let course: number | undefined;
  if (beforeTrack.course !== undefined && afterTrack.course !== undefined) {
    let courseDiff = afterTrack.course - beforeTrack.course;
    if (courseDiff > 180) courseDiff -= 360;
    if (courseDiff < -180) courseDiff += 360;
    course = beforeTrack.course + courseDiff * ratio;
    if (course < 0) course += 360;
    if (course >= 360) course -= 360;
  } else {
    course = beforeTrack.course ?? afterTrack.course;
  }
  const speed =
    beforeTrack.speed !== undefined && afterTrack.speed !== undefined
      ? beforeTrack.speed + (afterTrack.speed - beforeTrack.speed) * ratio
      : beforeTrack.speed ?? afterTrack.speed;
  return { lat, lon, height, course, speed };
}

function findClosestTrackByTimeIndexed(
  trackIndex: TrackIndex,
  targetId: string | number | unknown,
  targetTime: number,
): EvalTrackFeature | null {
  const sortedTracks = trackIndex.get(String(targetId));
  if (!sortedTracks?.length) return null;
  return binarySearchClosest(sortedTracks, targetTime, 1000);
}

function findTwoClosestTracksByTimeIndexed(
  trackIndex: TrackIndex,
  targetId: string | number | unknown,
  targetTime: number,
  maxTimeDiff = 120000,
): { before: EvalTrackFeature | null; after: EvalTrackFeature | null } | null {
  const sortedTracks = trackIndex.get(String(targetId));
  if (!sortedTracks?.length) return null;
  return binarySearchTwoClosest(sortedTracks, targetTime, maxTimeDiff);
}

function processDistanceErrorData(
  errorMap: Map<string, PerPointErrorSample[]>,
): TrackErrorStatsItem[] {
  const result: TrackErrorStatsItem[] = [];
  errorMap.forEach((errors, id) => {
    const fusionErrors = errors.map((e) => e.fusionError).filter((e) => e != null);
    const radar1Errors = errors
      .filter((e) => e.radar1Error != null)
      .map((e) => e.radar1Error as number);
    const radar2Errors = errors
      .filter((e) => e.radar2Error != null)
      .map((e) => e.radar2Error as number);
    const fusionStats = calculateAvgAndRmse(fusionErrors);
    const radar1Stats = calculateAvgAndRmse(radar1Errors);
    const radar2Stats = calculateAvgAndRmse(radar2Errors);
    result.push({
      id,
      fusionAvg: fusionStats.avg,
      fusionRmse: fusionStats.rmse,
      radar1Avg: radar1Stats.avg,
      radar1Rmse: radar1Stats.rmse,
      radar2Avg: radar2Stats.avg,
      radar2Rmse: radar2Stats.rmse,
      fusionErrors,
      radar1Errors,
      radar2Errors,
    });
  });
  result.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return result;
}

function processHeightErrorData(
  errorMap: Map<string, PerPointErrorSample[]>,
): TrackErrorStatsItem[] {
  return processDistanceErrorData(errorMap);
}

function processErrorData(errorMap: Map<string, PerPointErrorSample[]>): TrackErrorStatsItem[] {
  return processDistanceErrorData(errorMap);
}

function calculateSeaFusionErrors(
  fusionTracks: EvalTrackFeature[],
  yuanYaoRadar: TrackEvalRadarChannel,
  jingZiTouRadar: TrackEvalRadarChannel,
  aisIndex: TrackIndex,
  yuanYaoIndex: TrackIndex,
  jingZiTouIndex: TrackIndex,
): Pick<
  TrackEvalMetricsResult,
  | "seaDistanceError"
  | "seaHeightError"
  | "seaAzimuthError"
  | "seaElevationError"
  | "seaCourseError"
  | "seaSpeedError"
> {
  const distanceErrorMap = new Map<string, PerPointErrorSample[]>();
  const azimuthErrorMap = new Map<string, PerPointErrorSample[]>();
  const elevationErrorMap = new Map<string, PerPointErrorSample[]>();
  const courseErrorMap = new Map<string, PerPointErrorSample[]>();
  const speedErrorMap = new Map<string, PerPointErrorSample[]>();

  fusionTracks.forEach((fusionTrack) => {
    const aisId = fusionTrack.originalData?.original_track_id2;
    if (!isValidOriginalId(aisId)) return;
    const aisIdStr = String(aisId);
    const fusionTime = getFeatureTimestamp(fusionTrack);
    if (!fusionTime) return;

    const fusionLat = fusionTrack.latitude;
    const fusionLon = fusionTrack.longitude;
    const fusionHeight = fusionTrack.altitude ?? 0;
    const fusionCourse = fusionTrack.course;
    const fusionSpeed = fusionTrack.speed;

    const twoClosest = findTwoClosestTracksByTimeIndexed(aisIndex, aisIdStr, fusionTime, 120000);
    const aisInfo =
      twoClosest && (twoClosest.before || twoClosest.after)
        ? interpolatePosition(twoClosest.before, twoClosest.after, fusionTime)
        : null;
    if (!aisInfo || aisInfo.lat === undefined || aisInfo.lon === undefined) return;

    const aisLat = aisInfo.lat;
    const aisLon = aisInfo.lon;
    const aisHeight = aisInfo.height ?? 0;
    const aisCourse = aisInfo.course;
    const aisSpeed = aisInfo.speed;

    const yuanYaoId = fusionTrack.originalData?.original_track_id1;
    const jingZiTouId = fusionTrack.originalData?.original_track_id3;

    const fusionError = calculateGeoDistance(fusionLat, fusionLon, aisLat, aisLon);
    let radar1Error: number | null = null;
    let radar2Error: number | null = null;

    if (isValidOriginalId(yuanYaoId)) {
      const yuanYaoTrack = findClosestTrackByTimeIndexed(yuanYaoIndex, yuanYaoId, fusionTime);
      if (yuanYaoTrack) {
        radar1Error = calculateGeoDistance(
          yuanYaoTrack.latitude,
          yuanYaoTrack.longitude,
          aisLat,
          aisLon,
        );
      }
    }
    if (isValidOriginalId(jingZiTouId)) {
      const jingZiTouTrack = findClosestTrackByTimeIndexed(jingZiTouIndex, jingZiTouId, fusionTime);
      if (jingZiTouTrack) {
        radar2Error = calculateGeoDistance(
          jingZiTouTrack.latitude,
          jingZiTouTrack.longitude,
          aisLat,
          aisLon,
        );
      }
    }

    if (!distanceErrorMap.has(aisIdStr)) distanceErrorMap.set(aisIdStr, []);
    distanceErrorMap.get(aisIdStr)!.push({
      fusionError,
      radar1Error,
      radar2Error,
      timestamp: fusionTime,
    });

    const aisAzimuthFromYuanYao = calculateAzimuth(
      yuanYaoRadar.center.lat,
      yuanYaoRadar.center.lon,
      aisLat,
      aisLon,
    );
    const fusionAzimuthFromYuanYao = calculateAzimuth(
      yuanYaoRadar.center.lat,
      yuanYaoRadar.center.lon,
      fusionLat,
      fusionLon,
    );
    const fusionAzimuthError = calculateAngleDifference(
      fusionAzimuthFromYuanYao,
      aisAzimuthFromYuanYao,
    );
    let radar1AzimuthError: number | null = null;
    let radar2AzimuthError: number | null = null;

    if (isValidOriginalId(yuanYaoId)) {
      const yuanYaoTrack = findClosestTrackByTimeIndexed(yuanYaoIndex, yuanYaoId, fusionTime);
      if (yuanYaoTrack) {
        const radarAzimuthFromYuanYao = calculateAzimuth(
          yuanYaoRadar.center.lat,
          yuanYaoRadar.center.lon,
          yuanYaoTrack.latitude,
          yuanYaoTrack.longitude,
        );
        radar1AzimuthError = calculateAngleDifference(radarAzimuthFromYuanYao, aisAzimuthFromYuanYao);
      }
    }
    if (isValidOriginalId(jingZiTouId)) {
      const jingZiTouTrack = findClosestTrackByTimeIndexed(jingZiTouIndex, jingZiTouId, fusionTime);
      if (jingZiTouTrack) {
        const radarAzimuthFromJingZiTou = calculateAzimuth(
          jingZiTouRadar.center.lat,
          jingZiTouRadar.center.lon,
          jingZiTouTrack.latitude,
          jingZiTouTrack.longitude,
        );
        const aisAzimuthFromJingZiTou = calculateAzimuth(
          jingZiTouRadar.center.lat,
          jingZiTouRadar.center.lon,
          aisLat,
          aisLon,
        );
        radar2AzimuthError = calculateAngleDifference(
          radarAzimuthFromJingZiTou,
          aisAzimuthFromJingZiTou,
        );
      }
    }
    if (!azimuthErrorMap.has(aisIdStr)) azimuthErrorMap.set(aisIdStr, []);
    azimuthErrorMap.get(aisIdStr)!.push({
      fusionError: fusionAzimuthError,
      radar1Error: radar1AzimuthError,
      radar2Error: radar2AzimuthError,
      timestamp: fusionTime,
    });

    const aisElevationFromYuanYao = calculateElevation(
      yuanYaoRadar.center.lat,
      yuanYaoRadar.center.lon,
      0,
      aisLat,
      aisLon,
      aisHeight,
    );
    const fusionElevationFromYuanYao = calculateElevation(
      yuanYaoRadar.center.lat,
      yuanYaoRadar.center.lon,
      0,
      fusionLat,
      fusionLon,
      fusionHeight,
    );
    const fusionElevationError = calculateAngleDifference(
      fusionElevationFromYuanYao,
      aisElevationFromYuanYao,
    );
    let radar1ElevationError: number | null = null;
    let radar2ElevationError: number | null = null;

    if (isValidOriginalId(yuanYaoId)) {
      const yuanYaoTrack = findClosestTrackByTimeIndexed(yuanYaoIndex, yuanYaoId, fusionTime);
      if (yuanYaoTrack) {
        const radarElevationFromYuanYao = calculateElevation(
          yuanYaoRadar.center.lat,
          yuanYaoRadar.center.lon,
          0,
          yuanYaoTrack.latitude,
          yuanYaoTrack.longitude,
          yuanYaoTrack.altitude ?? 0,
        );
        radar1ElevationError = calculateAngleDifference(
          radarElevationFromYuanYao,
          aisElevationFromYuanYao,
        );
      }
    }
    if (isValidOriginalId(jingZiTouId)) {
      const jingZiTouTrack = findClosestTrackByTimeIndexed(jingZiTouIndex, jingZiTouId, fusionTime);
      if (jingZiTouTrack) {
        const aisElevationFromJingZiTou = calculateElevation(
          jingZiTouRadar.center.lat,
          jingZiTouRadar.center.lon,
          0,
          aisLat,
          aisLon,
          aisHeight,
        );
        const radarElevationFromJingZiTou = calculateElevation(
          jingZiTouRadar.center.lat,
          jingZiTouRadar.center.lon,
          0,
          jingZiTouTrack.latitude,
          jingZiTouTrack.longitude,
          jingZiTouTrack.altitude ?? 0,
        );
        radar2ElevationError = calculateAngleDifference(
          radarElevationFromJingZiTou,
          aisElevationFromJingZiTou,
        );
      }
    }
    if (!elevationErrorMap.has(aisIdStr)) elevationErrorMap.set(aisIdStr, []);
    elevationErrorMap.get(aisIdStr)!.push({
      fusionError: fusionElevationError,
      radar1Error: radar1ElevationError,
      radar2Error: radar2ElevationError,
      timestamp: fusionTime,
    });

    if (fusionCourse !== undefined && aisCourse !== undefined) {
      const fusionCourseError = calculateAngleDifference(fusionCourse, aisCourse);
      let radar1CourseError: number | null = null;
      let radar2CourseError: number | null = null;
      if (isValidOriginalId(yuanYaoId)) {
        const yuanYaoTrack = findClosestTrackByTimeIndexed(yuanYaoIndex, yuanYaoId, fusionTime);
        if (yuanYaoTrack?.course !== undefined) {
          radar1CourseError = calculateAngleDifference(yuanYaoTrack.course, aisCourse);
        }
      }
      if (isValidOriginalId(jingZiTouId)) {
        const jingZiTouTrack = findClosestTrackByTimeIndexed(jingZiTouIndex, jingZiTouId, fusionTime);
        if (jingZiTouTrack?.course !== undefined) {
          radar2CourseError = calculateAngleDifference(jingZiTouTrack.course, aisCourse);
        }
      }
      if (!courseErrorMap.has(aisIdStr)) courseErrorMap.set(aisIdStr, []);
      courseErrorMap.get(aisIdStr)!.push({
        fusionError: fusionCourseError,
        radar1Error: radar1CourseError,
        radar2Error: radar2CourseError,
        timestamp: fusionTime,
      });
    }

    if (fusionSpeed !== undefined && aisSpeed !== undefined) {
      const fusionSpeedError = fusionSpeed - aisSpeed;
      let radar1SpeedError: number | null = null;
      let radar2SpeedError: number | null = null;
      if (isValidOriginalId(yuanYaoId)) {
        const yuanYaoTrack = findClosestTrackByTimeIndexed(yuanYaoIndex, yuanYaoId, fusionTime);
        if (yuanYaoTrack?.speed !== undefined) {
          radar1SpeedError = yuanYaoTrack.speed - aisSpeed;
        }
      }
      if (isValidOriginalId(jingZiTouId)) {
        const jingZiTouTrack = findClosestTrackByTimeIndexed(jingZiTouIndex, jingZiTouId, fusionTime);
        if (jingZiTouTrack?.speed !== undefined) {
          radar2SpeedError = jingZiTouTrack.speed - aisSpeed;
        }
      }
      if (!speedErrorMap.has(aisIdStr)) speedErrorMap.set(aisIdStr, []);
      speedErrorMap.get(aisIdStr)!.push({
        fusionError: fusionSpeedError,
        radar1Error: radar1SpeedError,
        radar2Error: radar2SpeedError,
        timestamp: fusionTime,
      });
    }

    const courseErr =
      fusionCourse !== undefined && aisCourse !== undefined
        ? calculateAngleDifference(fusionCourse, aisCourse)
        : null;
    const speedErr =
      fusionSpeed !== undefined && aisSpeed !== undefined ? fusionSpeed - aisSpeed : null;

    fusionTrack.originalData.errorInfo = {
      distance: { fusion: fusionError, radar1: radar1Error, radar2: radar2Error },
      azimuth: {
        fusion: fusionAzimuthError,
        radar1: radar1AzimuthError,
        radar2: radar2AzimuthError,
      },
      elevation: {
        fusion: fusionElevationError,
        radar1: radar1ElevationError,
        radar2: radar2ElevationError,
      },
      ...(courseErr != null ? { course: { fusion: courseErr } } : {}),
      ...(speedErr != null ? { speed: { fusion: speedErr } } : {}),
    };
  });

  return {
    seaDistanceError: processDistanceErrorData(distanceErrorMap),
    seaHeightError: [],
    seaAzimuthError: processErrorData(azimuthErrorMap),
    seaElevationError: processErrorData(elevationErrorMap),
    seaCourseError: processErrorData(courseErrorMap),
    seaSpeedError: processErrorData(speedErrorMap),
  };
}

function calculateAirFusionErrors(
  fusionTracks: EvalTrackFeature[],
  tanNiaoRadar: TrackEvalRadarChannel,
  kuRadar: TrackEvalRadarChannel | undefined,
  selfReportIndex: TrackIndex,
  tanNiaoIndex: TrackIndex,
  kuIndex: TrackIndex,
): Pick<
  TrackEvalMetricsResult,
  | "airDistanceError"
  | "airHeightError"
  | "airAzimuthError"
  | "airElevationError"
  | "airCourseError"
  | "airSpeedError"
> {
  const distanceErrorMap = new Map<string, PerPointErrorSample[]>();
  const heightErrorMap = new Map<string, PerPointErrorSample[]>();
  const azimuthErrorMap = new Map<string, PerPointErrorSample[]>();
  const elevationErrorMap = new Map<string, PerPointErrorSample[]>();
  const courseErrorMap = new Map<string, PerPointErrorSample[]>();
  const speedErrorMap = new Map<string, PerPointErrorSample[]>();

  fusionTracks.forEach((fusionTrack) => {
    const sources = parseAirFusionSources(fusionTrack.originalData ?? {});
    const selfReportId = sources.selfReport;
    if (!isValidOriginalId(selfReportId)) return;
    const selfReportIdStr = String(selfReportId);
    const fusionTime = getFeatureTimestamp(fusionTrack);
    if (!fusionTime) return;

    const fusionLat = fusionTrack.latitude;
    const fusionLon = fusionTrack.longitude;
    const fusionHeight = fusionTrack.altitude ?? 0;
    const fusionCourse = fusionTrack.course;
    const fusionSpeed = fusionTrack.speed;

    const twoClosest = findTwoClosestTracksByTimeIndexed(
      selfReportIndex,
      selfReportIdStr,
      fusionTime,
      120000,
    );
    const selfReportInfo =
      twoClosest && (twoClosest.before || twoClosest.after)
        ? interpolatePosition(twoClosest.before, twoClosest.after, fusionTime)
        : null;
    if (!selfReportInfo || selfReportInfo.lat === undefined || selfReportInfo.lon === undefined) {
      return;
    }

    const selfReportLat = selfReportInfo.lat;
    const selfReportLon = selfReportInfo.lon;
    const selfReportHeight = selfReportInfo.height ?? 0;
    const selfReportCourse = selfReportInfo.course;
    const selfReportSpeed = selfReportInfo.speed;

    const tanNiaoId = sources.bird;
    const kuRadarId = getAirSecondaryRadarId(sources);

    const fusionDistanceError = calculateGeoDistance(
      fusionLat,
      fusionLon,
      selfReportLat,
      selfReportLon,
    );
    const fusionHeightError = fusionHeight - selfReportHeight;
    let radar1DistanceError: number | null = null;
    let radar2DistanceError: number | null = null;
    let radar1HeightError: number | null = null;
    let radar2HeightError: number | null = null;

    if (isValidOriginalId(tanNiaoId)) {
      const tanNiaoTrack = findClosestTrackByTimeIndexed(tanNiaoIndex, tanNiaoId, fusionTime);
      if (tanNiaoTrack) {
        radar1DistanceError = calculateGeoDistance(
          tanNiaoTrack.latitude,
          tanNiaoTrack.longitude,
          selfReportLat,
          selfReportLon,
        );
        radar1HeightError = (tanNiaoTrack.altitude ?? 0) - selfReportHeight;
      }
    }
    if (isValidOriginalId(kuRadarId)) {
      const kuRadarTrack = findClosestTrackByTimeIndexed(kuIndex, kuRadarId, fusionTime);
      if (kuRadarTrack) {
        radar2DistanceError = calculateGeoDistance(
          kuRadarTrack.latitude,
          kuRadarTrack.longitude,
          selfReportLat,
          selfReportLon,
        );
        radar2HeightError = (kuRadarTrack.altitude ?? 0) - selfReportHeight;
      }
    }

    if (!distanceErrorMap.has(selfReportIdStr)) distanceErrorMap.set(selfReportIdStr, []);
    distanceErrorMap.get(selfReportIdStr)!.push({
      fusionError: fusionDistanceError,
      radar1Error: radar1DistanceError,
      radar2Error: radar2DistanceError,
      timestamp: fusionTime,
    });
    if (!heightErrorMap.has(selfReportIdStr)) heightErrorMap.set(selfReportIdStr, []);
    heightErrorMap.get(selfReportIdStr)!.push({
      fusionError: fusionHeightError,
      radar1Error: radar1HeightError,
      radar2Error: radar2HeightError,
      timestamp: fusionTime,
    });

    const selfReportAzimuthFromTanNiao = calculateAzimuth(
      tanNiaoRadar.center.lat,
      tanNiaoRadar.center.lon,
      selfReportLat,
      selfReportLon,
    );
    const fusionAzimuthFromTanNiao = calculateAzimuth(
      tanNiaoRadar.center.lat,
      tanNiaoRadar.center.lon,
      fusionLat,
      fusionLon,
    );
    const fusionAzimuthError = calculateAngleDifference(
      fusionAzimuthFromTanNiao,
      selfReportAzimuthFromTanNiao,
    );
    let radar1AzimuthError: number | null = null;
    let radar2AzimuthError: number | null = null;

    if (isValidOriginalId(tanNiaoId)) {
      const tanNiaoTrack = findClosestTrackByTimeIndexed(tanNiaoIndex, tanNiaoId, fusionTime);
      if (tanNiaoTrack) {
        const radarAzimuthFromTanNiao = calculateAzimuth(
          tanNiaoRadar.center.lat,
          tanNiaoRadar.center.lon,
          tanNiaoTrack.latitude,
          tanNiaoTrack.longitude,
        );
        radar1AzimuthError = calculateAngleDifference(
          radarAzimuthFromTanNiao,
          selfReportAzimuthFromTanNiao,
        );
      }
    }
    if (isValidOriginalId(kuRadarId) && kuRadar) {
      const kuRadarTrack = findClosestTrackByTimeIndexed(kuIndex, kuRadarId, fusionTime);
      if (kuRadarTrack) {
        const radarAzimuthFromKU = calculateAzimuth(
          kuRadar.center.lat,
          kuRadar.center.lon,
          kuRadarTrack.latitude,
          kuRadarTrack.longitude,
        );
        const selfReportAzimuthFromKU = calculateAzimuth(
          kuRadar.center.lat,
          kuRadar.center.lon,
          selfReportLat,
          selfReportLon,
        );
        radar2AzimuthError = calculateAngleDifference(
          radarAzimuthFromKU,
          selfReportAzimuthFromKU,
        );
      }
    }
    if (!azimuthErrorMap.has(selfReportIdStr)) azimuthErrorMap.set(selfReportIdStr, []);
    azimuthErrorMap.get(selfReportIdStr)!.push({
      fusionError: fusionAzimuthError,
      radar1Error: radar1AzimuthError,
      radar2Error: radar2AzimuthError,
      timestamp: fusionTime,
    });

    const selfReportElevationFromTanNiao = calculateElevation(
      tanNiaoRadar.center.lat,
      tanNiaoRadar.center.lon,
      0,
      selfReportLat,
      selfReportLon,
      selfReportHeight,
    );
    const fusionElevationFromTanNiao = calculateElevation(
      tanNiaoRadar.center.lat,
      tanNiaoRadar.center.lon,
      0,
      fusionLat,
      fusionLon,
      fusionHeight,
    );
    const fusionElevationError = calculateAngleDifference(
      fusionElevationFromTanNiao,
      selfReportElevationFromTanNiao,
    );
    let radar1ElevationError: number | null = null;
    let radar2ElevationError: number | null = null;

    if (isValidOriginalId(tanNiaoId)) {
      const tanNiaoTrack = findClosestTrackByTimeIndexed(tanNiaoIndex, tanNiaoId, fusionTime);
      if (tanNiaoTrack) {
        const radarElevationFromTanNiao = calculateElevation(
          tanNiaoRadar.center.lat,
          tanNiaoRadar.center.lon,
          0,
          tanNiaoTrack.latitude,
          tanNiaoTrack.longitude,
          tanNiaoTrack.altitude ?? 0,
        );
        radar1ElevationError = calculateAngleDifference(
          radarElevationFromTanNiao,
          selfReportElevationFromTanNiao,
        );
      }
    }
    if (isValidOriginalId(kuRadarId) && kuRadar) {
      const kuRadarTrack = findClosestTrackByTimeIndexed(kuIndex, kuRadarId, fusionTime);
      if (kuRadarTrack) {
        const selfReportElevationFromKU = calculateElevation(
          kuRadar.center.lat,
          kuRadar.center.lon,
          0,
          selfReportLat,
          selfReportLon,
          selfReportHeight,
        );
        const radarElevationFromKU = calculateElevation(
          kuRadar.center.lat,
          kuRadar.center.lon,
          0,
          kuRadarTrack.latitude,
          kuRadarTrack.longitude,
          kuRadarTrack.altitude ?? 0,
        );
        radar2ElevationError = calculateAngleDifference(
          radarElevationFromKU,
          selfReportElevationFromKU,
        );
      }
    }
    if (!elevationErrorMap.has(selfReportIdStr)) elevationErrorMap.set(selfReportIdStr, []);
    elevationErrorMap.get(selfReportIdStr)!.push({
      fusionError: fusionElevationError,
      radar1Error: radar1ElevationError,
      radar2Error: radar2ElevationError,
      timestamp: fusionTime,
    });

    if (fusionCourse !== undefined && selfReportCourse !== undefined) {
      const fusionCourseError = calculateAngleDifference(fusionCourse, selfReportCourse);
      let radar1CourseError: number | null = null;
      let radar2CourseError: number | null = null;
      if (isValidOriginalId(tanNiaoId)) {
        const tanNiaoTrack = findClosestTrackByTimeIndexed(tanNiaoIndex, tanNiaoId, fusionTime);
        if (tanNiaoTrack?.course !== undefined) {
          radar1CourseError = calculateAngleDifference(tanNiaoTrack.course, selfReportCourse);
        }
      }
      if (isValidOriginalId(kuRadarId)) {
        const kuRadarTrack = findClosestTrackByTimeIndexed(kuIndex, kuRadarId, fusionTime);
        if (kuRadarTrack?.course !== undefined) {
          radar2CourseError = calculateAngleDifference(kuRadarTrack.course, selfReportCourse);
        }
      }
      if (!courseErrorMap.has(selfReportIdStr)) courseErrorMap.set(selfReportIdStr, []);
      courseErrorMap.get(selfReportIdStr)!.push({
        fusionError: fusionCourseError,
        radar1Error: radar1CourseError,
        radar2Error: radar2CourseError,
        timestamp: fusionTime,
      });
    }

    if (fusionSpeed !== undefined && selfReportSpeed !== undefined) {
      const fusionSpeedError = fusionSpeed - selfReportSpeed;
      let radar1SpeedError: number | null = null;
      let radar2SpeedError: number | null = null;
      if (isValidOriginalId(tanNiaoId)) {
        const tanNiaoTrack = findClosestTrackByTimeIndexed(tanNiaoIndex, tanNiaoId, fusionTime);
        if (tanNiaoTrack?.speed !== undefined) {
          radar1SpeedError = tanNiaoTrack.speed - selfReportSpeed;
        }
      }
      if (isValidOriginalId(kuRadarId)) {
        const kuRadarTrack = findClosestTrackByTimeIndexed(kuIndex, kuRadarId, fusionTime);
        if (kuRadarTrack?.speed !== undefined) {
          radar2SpeedError = kuRadarTrack.speed - selfReportSpeed;
        }
      }
      if (!speedErrorMap.has(selfReportIdStr)) speedErrorMap.set(selfReportIdStr, []);
      speedErrorMap.get(selfReportIdStr)!.push({
        fusionError: fusionSpeedError,
        radar1Error: radar1SpeedError,
        radar2Error: radar2SpeedError,
        timestamp: fusionTime,
      });
    }

    const courseErr =
      fusionCourse !== undefined && selfReportCourse !== undefined
        ? calculateAngleDifference(fusionCourse, selfReportCourse)
        : null;
    const speedErr =
      fusionSpeed !== undefined && selfReportSpeed !== undefined
        ? fusionSpeed - selfReportSpeed
        : null;

    fusionTrack.originalData.errorInfo = {
      distance: {
        fusion: fusionDistanceError,
        radar1: radar1DistanceError,
        radar2: radar2DistanceError,
      },
      height: {
        fusion: fusionHeightError,
        radar1: radar1HeightError,
        radar2: radar2HeightError,
      },
      azimuth: {
        fusion: fusionAzimuthError,
        radar1: radar1AzimuthError,
        radar2: radar2AzimuthError,
      },
      elevation: {
        fusion: fusionElevationError,
        radar1: radar1ElevationError,
        radar2: radar2ElevationError,
      },
      ...(courseErr != null ? { course: { fusion: courseErr } } : {}),
      ...(speedErr != null ? { speed: { fusion: speedErr } } : {}),
    };
  });

  return {
    airDistanceError: processDistanceErrorData(distanceErrorMap),
    airHeightError: processHeightErrorData(heightErrorMap),
    airAzimuthError: processErrorData(azimuthErrorMap),
    airElevationError: processErrorData(elevationErrorMap),
    airCourseError: processErrorData(courseErrorMap),
    airSpeedError: processErrorData(speedErrorMap),
  };
}

function calculateErrors(
  features: EvalTrackFeature[],
  radarChannels: TrackEvalRadarChannels,
): Pick<
  TrackEvalMetricsResult,
  | "seaDistanceError"
  | "seaHeightError"
  | "airDistanceError"
  | "airHeightError"
  | "seaAzimuthError"
  | "airAzimuthError"
  | "seaElevationError"
  | "airElevationError"
  | "seaCourseError"
  | "airCourseError"
  | "seaSpeedError"
  | "airSpeedError"
> {
  const emptyErrors = {
    seaDistanceError: [] as TrackErrorStatsItem[],
    seaHeightError: [] as TrackErrorStatsItem[],
    airDistanceError: [] as TrackErrorStatsItem[],
    airHeightError: [] as TrackErrorStatsItem[],
    seaAzimuthError: [] as TrackErrorStatsItem[],
    airAzimuthError: [] as TrackErrorStatsItem[],
    seaElevationError: [] as TrackErrorStatsItem[],
    airElevationError: [] as TrackErrorStatsItem[],
    seaCourseError: [] as TrackErrorStatsItem[],
    airCourseError: [] as TrackErrorStatsItem[],
    seaSpeedError: [] as TrackErrorStatsItem[],
    airSpeedError: [] as TrackErrorStatsItem[],
  };

  const yuanYaoRadar = radarChannels.radar1;
  const jingZiTouRadar = radarChannels.radar2;
  const tanNiaoRadar = radarChannels.radar5;
  if (!yuanYaoRadar || !jingZiTouRadar || !tanNiaoRadar) {
    return emptyErrors;
  }

  const seaFusionTracks = features.filter((t) => t.sensorId === 0);
  const airFusionTracks = features.filter((t) => t.sensorId === 6);
  const aisTracks = features.filter((t) => t.sensorId === 3);
  const selfReportTracks = features.filter((t) => t.sensorId === 4);
  const yuanYaoTracks = features.filter((t) => t.sensorId === 1);
  const jingZiTouTracks = features.filter((t) => t.sensorId === 2);
  const tanNiaoTracks = features.filter((t) => t.sensorId === 5);
  const secondaryRadarTracks = features.filter((t) => t.sensorId === 7 || t.sensorId === 203);

  const aisIndex = buildTrackIndex(aisTracks);
  const selfReportIndex = buildTrackIndex(selfReportTracks);
  const yuanYaoIndex = buildTrackIndex(yuanYaoTracks);
  const jingZiTouIndex = buildTrackIndex(jingZiTouTracks);
  const tanNiaoIndex = buildTrackIndex(tanNiaoTracks);
  const kuIndex = buildTrackIndex(secondaryRadarTracks);

  const sea = calculateSeaFusionErrors(
    seaFusionTracks,
    yuanYaoRadar,
    jingZiTouRadar,
    aisIndex,
    yuanYaoIndex,
    jingZiTouIndex,
  );
  const air = calculateAirFusionErrors(
    airFusionTracks,
    tanNiaoRadar,
    radarChannels.radar6,
    selfReportIndex,
    tanNiaoIndex,
    kuIndex,
  );
  return { ...sea, ...air };
}
