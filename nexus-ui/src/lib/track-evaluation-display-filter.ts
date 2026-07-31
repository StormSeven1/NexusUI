/**
 * 航迹评估「显示筛选」（对齐 mapbox-vue2 TrackFilterPanel.applyFilter / handleApplyFilter）
 *
 * 航迹 ID 分四类：
 * - fusionUniqueId：融合航迹 target_id / unique_id（不是 fused_track_id）
 * - radarTrackId：雷达批号（鹏飞/码头/探鸟等）
 * - aisId：对海 AIS / MMSI
 * - selfReportId：自报位（对海船自报 / 对空自报）
 */

import type { EvalTrackFeature, TrackEvalMetricsResult, TrackErrorStatsItem } from "@/lib/track-evaluation-metrics";
import {
  isAisFusionSource,
  parseFusionSourcesFromTrackOriginal,
} from "@/lib/fusion-source-catalog";
import { parseAirFusionSources } from "@/lib/air-fusion-source";

export type SeaFusionFilterMode = "all" | "with-ais" | "without-ais";
export type AirFusionFilterMode = "all" | "with-selfreport" | "without-selfreport";

export interface TrackEvalDisplayFilterState {
  displaySensorIds: number[];
  seaFusionFilter: SeaFusionFilterMode;
  airFusionFilter: AirFusionFilterMode;
  /** 融合航迹 ID = target_id / unique_id（界面批号，不是库表 fused_track_id） */
  fusionUniqueId: string;
  /** 雷达航迹 ID */
  radarTrackId: string;
  /** AIS ID（仅对海） */
  aisId: string;
  /** 自报位 ID（对海船自报 / 对空自报） */
  selfReportId: string;
  minAzimuth: number | null;
  maxAzimuth: number | null;
  minDistance: number | null;
  maxDistance: number | null;
  minSpeed: number | null;
  maxSpeed: number | null;
  minCourse: number | null;
  maxCourse: number | null;
  minSize: number | null;
  maxSize: number | null;
  minDistanceError: number | null;
  maxDistanceError: number | null;
  minHeightError: number | null;
  maxHeightError: number | null;
  minAzimuthError: number | null;
  maxAzimuthError: number | null;
  minElevationError: number | null;
  maxElevationError: number | null;
  minCourseError: number | null;
  maxCourseError: number | null;
  minSpeedError: number | null;
  maxSpeedError: number | null;
}

export const DEFAULT_DISPLAY_SENSOR_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 203, 204] as const;

export function defaultTrackEvalDisplayFilter(): TrackEvalDisplayFilterState {
  return {
    displaySensorIds: [...DEFAULT_DISPLAY_SENSOR_IDS],
    seaFusionFilter: "all",
    airFusionFilter: "all",
    fusionUniqueId: "",
    radarTrackId: "",
    aisId: "",
    selfReportId: "",
    minAzimuth: null,
    maxAzimuth: null,
    minDistance: null,
    maxDistance: null,
    minSpeed: null,
    maxSpeed: null,
    minCourse: null,
    maxCourse: null,
    minSize: null,
    maxSize: null,
    minDistanceError: null,
    maxDistanceError: null,
    minHeightError: null,
    maxHeightError: null,
    minAzimuthError: null,
    maxAzimuthError: null,
    minElevationError: null,
    maxElevationError: null,
    minCourseError: null,
    maxCourseError: null,
    minSpeedError: null,
    maxSpeedError: null,
  };
}

export function parseCommaSeparatedIds(raw: string): number[] {
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

function isValidNumber(val: number | null | undefined): val is number {
  return val != null && Number.isFinite(val);
}

function isValidOriginalId(id: unknown): boolean {
  return id !== undefined && id !== null && id !== "" && id !== 0;
}

function numId(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

interface FusionErrorInfo {
  distance?: { fusion?: number | null };
  height?: { fusion?: number | null };
  azimuth?: { fusion?: number | null };
  elevation?: { fusion?: number | null };
  course?: { fusion?: number | null };
  speed?: { fusion?: number | null };
}

function readErrorInfo(f: EvalTrackFeature): FusionErrorInfo {
  const raw = f.originalData?.errorInfo;
  if (raw && typeof raw === "object") return raw as FusionErrorInfo;
  return {};
}

function featureAzimuth(f: EvalTrackFeature): number {
  const od = f.originalData;
  const v = od.azimuth ?? od.azi ?? od.bearing;
  return v !== undefined && v !== null ? Number(v) : 0;
}

function featureDistance(f: EvalTrackFeature): number {
  const od = f.originalData;
  const direct = od.distance ?? od.range ?? od.dis;
  if (direct !== undefined && direct !== null && direct !== 0) return Number(direct);
  return 0;
}

function featureSize(f: EvalTrackFeature): number {
  const od = f.originalData;
  const v = od.size ?? od.target_size ?? od.rcs;
  return v !== undefined && v !== null ? Number(v) : 0;
}

function matchesSensorFilter(f: EvalTrackFeature, options: TrackEvalDisplayFilterState): boolean {
  const sensorId = f.sensorId;
  if (sensorId === 0) {
    if (!options.displaySensorIds.includes(0)) return false;
    const sources = parseFusionSourcesFromTrackOriginal(f.originalData, "sea");
    const hasAis =
      sources.some(isAisFusionSource) || isValidOriginalId(f.originalData?.original_track_id2);
    if (options.seaFusionFilter === "with-ais") return hasAis;
    if (options.seaFusionFilter === "without-ais") return !hasAis;
    return true;
  }
  if (sensorId === 6) {
    if (!options.displaySensorIds.includes(6)) return false;
    const sources = parseAirFusionSources(f.originalData);
    const hasSelfReport = sources.selfReport !== undefined;
    if (options.airFusionFilter === "with-selfreport") return hasSelfReport;
    if (options.airFusionFilter === "without-selfreport") return !hasSelfReport;
    return true;
  }
  if (options.displaySensorIds.length === 0) return true;
  return options.displaySensorIds.includes(sensorId);
}

function matchesErrorFilters(f: EvalTrackFeature, options: TrackEvalDisplayFilterState): boolean {
  const hasErrorFilter =
    isValidNumber(options.minDistanceError) ||
    isValidNumber(options.maxDistanceError) ||
    isValidNumber(options.minHeightError) ||
    isValidNumber(options.maxHeightError) ||
    isValidNumber(options.minAzimuthError) ||
    isValidNumber(options.maxAzimuthError) ||
    isValidNumber(options.minElevationError) ||
    isValidNumber(options.maxElevationError) ||
    isValidNumber(options.minCourseError) ||
    isValidNumber(options.maxCourseError) ||
    isValidNumber(options.minSpeedError) ||
    isValidNumber(options.maxSpeedError);

  if (!hasErrorFilter) return true;

  const sensorId = f.sensorId;
  if (sensorId !== 0 && sensorId !== 6) return false;

  const errorInfo = readErrorInfo(f);

  const check = (
    min: number | null,
    max: number | null,
    value: number | null | undefined,
    heightOnlyAir = false,
  ): boolean => {
    if (!isValidNumber(min) && !isValidNumber(max)) return true;
    if (heightOnlyAir && sensorId !== 6) return false;
    if (value == null || !Number.isFinite(value)) return false;
    if (isValidNumber(min) && value < min) return false;
    if (isValidNumber(max) && value > max) return false;
    return true;
  };

  if (!check(options.minDistanceError, options.maxDistanceError, errorInfo.distance?.fusion)) {
    return false;
  }
  if (!check(options.minHeightError, options.maxHeightError, errorInfo.height?.fusion, true)) {
    return false;
  }
  if (!check(options.minAzimuthError, options.maxAzimuthError, errorInfo.azimuth?.fusion)) {
    return false;
  }
  if (
    !check(options.minElevationError, options.maxElevationError, errorInfo.elevation?.fusion)
  ) {
    return false;
  }
  if (!check(options.minCourseError, options.maxCourseError, errorInfo.course?.fusion)) {
    return false;
  }
  if (!check(options.minSpeedError, options.maxSpeedError, errorInfo.speed?.fusion)) {
    return false;
  }
  return true;
}

function collectFeatureRelatedIds(f: EvalTrackFeature): number[] {
  const ids: number[] = [];
  const push = (v: unknown) => {
    const n = numId(v);
    if (n != null) ids.push(n);
  };
  push(f.trackId);
  push(f.uniqueId);
  const od = f.originalData ?? {};
  for (let i = 1; i <= 8; i++) push(od[`original_track_id${i}`]);
  if (f.sensorId === 0) {
    for (const s of parseFusionSourcesFromTrackOriginal(od, "sea")) push(s.trackId);
  } else if (f.sensorId === 6) {
    for (const s of parseFusionSourcesFromTrackOriginal(od, "air")) push(s.trackId);
    const air = parseAirFusionSources(od);
    push(air.bird);
    push(air.selfReport);
    push(air.fanwu);
    push(air.legacyKu);
  }
  return ids;
}

function fusionMatchesIdFilters(
  f: EvalTrackFeature,
  fusionUniqueIds: number[],
  radarIds: number[],
  aisIds: number[],
  selfIds: number[],
): boolean {
  if (f.sensorId !== 0 && f.sensorId !== 6) return false;
  // 前端融合 ID = unique_id / target_id
  const uid = numId(f.uniqueId);
  if (fusionUniqueIds.length > 0 && (uid == null || !fusionUniqueIds.includes(uid))) return false;

  const related = new Set(collectFeatureRelatedIds(f));
  if (radarIds.length > 0 && !radarIds.some((id) => related.has(id))) return false;
  if (aisIds.length > 0 && !aisIds.some((id) => related.has(id))) return false;
  if (selfIds.length > 0 && !selfIds.some((id) => related.has(id))) return false;
  return true;
}

function directSourceMatchesIdFilters(
  f: EvalTrackFeature,
  radarIds: number[],
  aisIds: number[],
  selfIds: number[],
): boolean {
  const tid = numId(f.trackId);
  const uid = numId(f.uniqueId);
  const hit = (ids: number[]) =>
    ids.length > 0 && ((tid != null && ids.includes(tid)) || (uid != null && ids.includes(uid)));

  if (f.sensorId === 3) return hit(aisIds);
  if (f.sensorId === 4 || f.sensorId === 202) return hit(selfIds);
  // 雷达表（非融合、非 AIS）
  if (f.sensorId !== 0 && f.sensorId !== 6) return hit(radarIds) || hit(selfIds);
  return false;
}

/** WS 路径：对已查询航迹点做显示筛选（保留匹配融合及其关联源点） */
export function filterEvalTrackFeatures(
  features: EvalTrackFeature[],
  options: TrackEvalDisplayFilterState,
): EvalTrackFeature[] {
  const fusionUniqueIds = parseCommaSeparatedIds(options.fusionUniqueId);
  const radarIds = parseCommaSeparatedIds(options.radarTrackId);
  const aisIds = parseCommaSeparatedIds(options.aisId);
  const selfIds = parseCommaSeparatedIds(options.selfReportId);
  const hasIdFilter =
    fusionUniqueIds.length > 0 || radarIds.length > 0 || aisIds.length > 0 || selfIds.length > 0;

  const companionIds = new Set<number>();
  if (hasIdFilter) {
    for (const f of features) {
      if (!matchesSensorFilter(f, options)) continue;
      if (fusionMatchesIdFilters(f, fusionUniqueIds, radarIds, aisIds, selfIds)) {
        for (const id of collectFeatureRelatedIds(f)) companionIds.add(id);
      }
      if (directSourceMatchesIdFilters(f, radarIds, aisIds, selfIds)) {
        const tid = numId(f.trackId);
        const uid = numId(f.uniqueId);
        if (tid != null) companionIds.add(tid);
        if (uid != null) companionIds.add(uid);
      }
    }
    for (const id of [...fusionUniqueIds, ...radarIds, ...aisIds, ...selfIds]) companionIds.add(id);
  }

  const out: EvalTrackFeature[] = [];
  for (const f of features) {
    if (!matchesSensorFilter(f, options)) continue;

    if (hasIdFilter) {
      const tid = numId(f.trackId);
      const uid = numId(f.uniqueId);
      const keep =
        fusionMatchesIdFilters(f, fusionUniqueIds, radarIds, aisIds, selfIds) ||
        directSourceMatchesIdFilters(f, radarIds, aisIds, selfIds) ||
        (tid != null && companionIds.has(tid)) ||
        (uid != null && companionIds.has(uid));
      if (!keep) continue;
    }

    const azimuth = featureAzimuth(f);
    if (isValidNumber(options.minAzimuth) && azimuth < options.minAzimuth) continue;
    if (isValidNumber(options.maxAzimuth) && azimuth > options.maxAzimuth) continue;

    const distance = featureDistance(f);
    if (isValidNumber(options.minDistance) && distance < options.minDistance) continue;
    if (isValidNumber(options.maxDistance) && distance > options.maxDistance) continue;

    if (isValidNumber(options.minSpeed) && f.speed < options.minSpeed) continue;
    if (isValidNumber(options.maxSpeed) && f.speed > options.maxSpeed) continue;

    if (isValidNumber(options.minCourse) && f.course < options.minCourse) continue;
    if (isValidNumber(options.maxCourse) && f.course > options.maxCourse) continue;

    const size = featureSize(f);
    if (isValidNumber(options.minSize) && size < options.minSize) continue;
    if (isValidNumber(options.maxSize) && size > options.maxSize) continue;

    if (!matchesErrorFilters(f, options)) continue;

    out.push(f);
  }
  return out;
}

function filterErrorStatsItems(
  items: TrackErrorStatsItem[],
  min: number | null,
  max: number | null,
): TrackErrorStatsItem[] {
  if (!isValidNumber(min) && !isValidNumber(max)) return items;
  return items.filter((item) => {
    const v = item.fusionAvg;
    if (v == null || !Number.isFinite(v)) return false;
    if (isValidNumber(min) && v < min) return false;
    if (isValidNumber(max) && v > max) return false;
    return true;
  });
}

function idInLists(id: string, ids: number[]): boolean {
  if (ids.length === 0) return true;
  const n = parseInt(id, 10);
  return Number.isFinite(n) && ids.includes(n);
}

function filterMetricIdArrays<T>(
  items: T[],
  ids: number[],
  idOf: (item: T) => string,
  extraIds?: (item: T) => string[],
): T[] {
  if (ids.length === 0) return items;
  return items.filter((item) => {
    if (idInLists(idOf(item), ids)) return true;
    const extras = extraIds?.(item) ?? [];
    return extras.some((eid) => idInLists(eid, ids));
  });
}

/** gRPC 路径：对聚合指标做显示筛选（多 ID、误差范围等） */
export function filterGrpcTrackMetrics(
  metrics: TrackEvalMetricsResult,
  options: TrackEvalDisplayFilterState,
): TrackEvalMetricsResult {
  const fusionUniqueIds = parseCommaSeparatedIds(options.fusionUniqueId);
  const radarIds = parseCommaSeparatedIds(options.radarTrackId);
  const aisIds = parseCommaSeparatedIds(options.aisId);
  const selfIds = parseCommaSeparatedIds(options.selfReportId);
  /** 用户填的任一 ID（融合 unique_id 常与 AIS/MMSI 相同，误差项 reference_id 也按此筛） */
  const anyIds = [...new Set([...fusionUniqueIds, ...radarIds, ...aisIds, ...selfIds])];
  const seaRefIds = [...new Set([...aisIds, ...fusionUniqueIds, ...radarIds])];
  const airRefIds = [...new Set([...selfIds, ...fusionUniqueIds, ...radarIds])];

  const filterAcc = <T extends { id: string; fusionTrackIds?: (number | string)[] }>(
    items: T[],
  ): T[] => {
    if (radarIds.length > 0) {
      return filterMetricIdArrays(items, radarIds, (item) => item.id, (item) =>
        (item.fusionTrackIds ?? []).map(String),
      );
    }
    if (fusionUniqueIds.length > 0) {
      // 准确率项的 id 是雷达批号；优先用 fusionTrackIds 匹配 unique_id。
      // 若项上没有 fusionTrackIds（或对不上），保留原列表，依赖服务端已按 unique_id 收窄。
      const matched = items.filter((item) => {
        const fids = (item.fusionTrackIds ?? [])
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n));
        return fids.some((id) => fusionUniqueIds.includes(id));
      });
      return matched.length > 0 ? matched : items;
    }
    if (anyIds.length > 0) {
      return filterMetricIdArrays(items, anyIds, (item) => item.id, (item) =>
        (item.fusionTrackIds ?? []).map(String),
      );
    }
    return items;
  };

  const filterByAny = <T>(items: T[], idOf: (item: T) => string, extraIds?: (item: T) => string[]) =>
    filterMetricIdArrays(items, anyIds, idOf, extraIds);

  const seaStabilityByAis = filterByAny(metrics.seaFusionStabilityByAis, (x) => x.aisId);
  const airStabilityBySelf = filterByAny(
    metrics.airFusionStabilityBySelfReport,
    (x) => x.selfReportId,
  );
  const seaStabilityDurByAis = filterByAny(
    metrics.seaFusionStabilityDurationByAis,
    (x) => x.aisId,
  );
  const airStabilityDurBySelf = filterByAny(
    metrics.airFusionStabilityDurationBySelfReport,
    (x) => x.selfReportId,
  );
  const seaFusionTrackCovByAis = filterByAny(
    metrics.seaFusionTrackCoverageByAis,
    (x) => x.aisId,
  );
  const airFusionTrackCovBySelf = filterByAny(
    metrics.airFusionTrackCoverageBySelfReport,
    (x) => x.selfReportId,
  );

  const avgOfField = <T>(items: T[], pick: (x: T) => number | null | undefined): number | null => {
    const vals = items.map(pick).filter((v): v is number => v != null && Number.isFinite(v));
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  const seaDistanceError = filterErrorStatsItems(
    filterMetricIdArrays(metrics.seaDistanceError, seaRefIds, (item) => item.id),
    options.minDistanceError,
    options.maxDistanceError,
  );
  const airDistanceError = filterErrorStatsItems(
    filterMetricIdArrays(metrics.airDistanceError, airRefIds, (item) => item.id),
    options.minDistanceError,
    options.maxDistanceError,
  );
  const seaHeightError = filterErrorStatsItems(
    filterMetricIdArrays(metrics.seaHeightError, seaRefIds, (item) => item.id),
    options.minHeightError,
    options.maxHeightError,
  );
  const airHeightError = filterErrorStatsItems(
    filterMetricIdArrays(metrics.airHeightError, airRefIds, (item) => item.id),
    options.minHeightError,
    options.maxHeightError,
  );
  const seaAzimuthError = filterErrorStatsItems(
    filterMetricIdArrays(metrics.seaAzimuthError, seaRefIds, (item) => item.id),
    options.minAzimuthError,
    options.maxAzimuthError,
  );
  const airAzimuthError = filterErrorStatsItems(
    filterMetricIdArrays(metrics.airAzimuthError, airRefIds, (item) => item.id),
    options.minAzimuthError,
    options.maxAzimuthError,
  );
  const seaElevationError = filterErrorStatsItems(
    filterMetricIdArrays(metrics.seaElevationError, seaRefIds, (item) => item.id),
    options.minElevationError,
    options.maxElevationError,
  );
  const airElevationError = filterErrorStatsItems(
    filterMetricIdArrays(metrics.airElevationError, airRefIds, (item) => item.id),
    options.minElevationError,
    options.maxElevationError,
  );
  const seaCourseError = filterErrorStatsItems(
    filterMetricIdArrays(metrics.seaCourseError, seaRefIds, (item) => item.id),
    options.minCourseError,
    options.maxCourseError,
  );
  const airCourseError = filterErrorStatsItems(
    filterMetricIdArrays(metrics.airCourseError, airRefIds, (item) => item.id),
    options.minCourseError,
    options.maxCourseError,
  );
  const seaSpeedError = filterErrorStatsItems(
    filterMetricIdArrays(metrics.seaSpeedError, seaRefIds, (item) => item.id),
    options.minSpeedError,
    options.maxSpeedError,
  );
  const airSpeedError = filterErrorStatsItems(
    filterMetricIdArrays(metrics.airSpeedError, airRefIds, (item) => item.id),
    options.minSpeedError,
    options.maxSpeedError,
  );

  const seaBreakCount = filterByAny(metrics.seaBreakCount, (item) => item.aisId);
  const airBreakCount = filterByAny(metrics.airBreakCount, (item) => item.selfReportId);
  const seaChangeBatchCount = filterByAny(metrics.seaChangeBatchCount, (item) => item.aisId);
  const airChangeBatchCount = filterByAny(
    metrics.airChangeBatchCount,
    (item) => item.selfReportId,
  );
  const seaMaxTrackingDuration = filterByAny(
    metrics.seaMaxTrackingDuration,
    (item) => item.aisId,
    (item) => (item.fusionTrackIds ?? []).map(String),
  );
  const airMaxTrackingDuration = filterByAny(
    metrics.airMaxTrackingDuration,
    (item) => item.selfReportId,
    (item) => (item.fusionTrackIds ?? []).map(String),
  );

  return {
    ...metrics,
    birdTrackAccuracy: filterAcc(metrics.birdTrackAccuracy),
    kuRadarAccuracy: filterAcc(metrics.kuRadarAccuracy),
    birdTrackRecall: filterMetricIdArrays(
      metrics.birdTrackRecall,
      selfIds.length > 0 ? selfIds : anyIds,
      (item) => item.id,
    ),
    kuRadarRecall: filterMetricIdArrays(
      metrics.kuRadarRecall,
      selfIds.length > 0 ? selfIds : anyIds,
      (item) => item.id,
    ),
    birdTrackFalseAlarm: filterAcc(metrics.birdTrackFalseAlarm),
    kuRadarFalseAlarm: filterAcc(metrics.kuRadarFalseAlarm),
    seaBreakCount,
    airBreakCount,
    seaBreakCountAvg:
      anyIds.length > 0 ? avgOfField(seaBreakCount, (x) => x.breakCount) : metrics.seaBreakCountAvg,
    airBreakCountAvg:
      anyIds.length > 0 ? avgOfField(airBreakCount, (x) => x.breakCount) : metrics.airBreakCountAvg,
    seaChangeBatchCount,
    airChangeBatchCount,
    seaChangeBatchCountAvg:
      anyIds.length > 0
        ? avgOfField(seaChangeBatchCount, (x) => x.changeBatchCount)
        : metrics.seaChangeBatchCountAvg,
    airChangeBatchCountAvg:
      anyIds.length > 0
        ? avgOfField(airChangeBatchCount, (x) => x.changeBatchCount)
        : metrics.airChangeBatchCountAvg,
    seaMaxTrackingDuration,
    airMaxTrackingDuration,
    seaMaxTrackingDurationAvg:
      anyIds.length > 0
        ? avgOfField(seaMaxTrackingDuration, (x) => x.maxDuration)
        : metrics.seaMaxTrackingDurationAvg,
    airMaxTrackingDurationAvg:
      anyIds.length > 0
        ? avgOfField(airMaxTrackingDuration, (x) => x.maxDuration)
        : metrics.airMaxTrackingDurationAvg,
    seaDistanceError,
    airDistanceError,
    seaHeightError,
    airHeightError,
    seaAzimuthError,
    airAzimuthError,
    seaElevationError,
    airElevationError,
    seaCourseError,
    airCourseError,
    seaSpeedError,
    airSpeedError,
    seaFusionStabilityByAis: seaStabilityByAis,
    airFusionStabilityBySelfReport: airStabilityBySelf,
    seaFusionStabilityDurationByAis: seaStabilityDurByAis,
    airFusionStabilityDurationBySelfReport: airStabilityDurBySelf,
    seaFusionTrackCoverageByAis: seaFusionTrackCovByAis,
    airFusionTrackCoverageBySelfReport: airFusionTrackCovBySelf,
    seaFusionStabilityAvg:
      anyIds.length > 0
        ? avgOfField(seaStabilityByAis, (x) => x.stability)
        : metrics.seaFusionStabilityAvg,
    airFusionStabilityAvg:
      anyIds.length > 0
        ? avgOfField(airStabilityBySelf, (x) => x.stability)
        : metrics.airFusionStabilityAvg,
    seaFusionStabilityDurationAvg:
      anyIds.length > 0
        ? avgOfField(seaStabilityDurByAis, (x) => x.stability)
        : metrics.seaFusionStabilityDurationAvg,
    airFusionStabilityDurationAvg:
      anyIds.length > 0
        ? avgOfField(airStabilityDurBySelf, (x) => x.stability)
        : metrics.airFusionStabilityDurationAvg,
    seaFusionTrackCoverageAvg:
      anyIds.length > 0
        ? avgOfField(seaFusionTrackCovByAis, (x) => x.coverage)
        : metrics.seaFusionTrackCoverageAvg,
    airFusionTrackCoverageAvg:
      anyIds.length > 0
        ? avgOfField(airFusionTrackCovBySelf, (x) => x.coverage)
        : metrics.airFusionTrackCoverageAvg,
  };
}

export function buildDisplayFilterGrpcPayload(
  options: TrackEvalDisplayFilterState,
): Pick<
  import("@/lib/system-eval-track-api").TrackEvalGrpcRequest,
  | "fusion_unique_ids"
  | "radar_track_ids"
  | "ais_ids"
  | "self_report_ids"
  | "attr_range"
  | "sea_fusion_filter"
  | "air_fusion_filter"
  | "display_sensor_ids"
> {
  const fusionUnique = parseCommaSeparatedIds(options.fusionUniqueId);
  const radar = parseCommaSeparatedIds(options.radarTrackId);
  const ais = parseCommaSeparatedIds(options.aisId);
  const selfReport = parseCommaSeparatedIds(options.selfReportId);
  const attr: NonNullable<
    import("@/lib/system-eval-track-api").TrackEvalGrpcRequest["attr_range"]
  > = {};
  if (isValidNumber(options.minAzimuth)) attr.min_azimuth = options.minAzimuth;
  if (isValidNumber(options.maxAzimuth)) attr.max_azimuth = options.maxAzimuth;
  if (isValidNumber(options.minDistance)) attr.min_distance = options.minDistance;
  if (isValidNumber(options.maxDistance)) attr.max_distance = options.maxDistance;
  if (isValidNumber(options.minSpeed)) attr.min_speed = options.minSpeed;
  if (isValidNumber(options.maxSpeed)) attr.max_speed = options.maxSpeed;
  if (isValidNumber(options.minCourse)) attr.min_course = options.minCourse;
  if (isValidNumber(options.maxCourse)) attr.max_course = options.maxCourse;
  if (isValidNumber(options.minSize)) attr.min_size = options.minSize;
  if (isValidNumber(options.maxSize)) attr.max_size = options.maxSize;

  const seaMap: Record<SeaFusionFilterMode, "ALL" | "WITH_AIS" | "WITHOUT_AIS"> = {
    all: "ALL",
    "with-ais": "WITH_AIS",
    "without-ais": "WITHOUT_AIS",
  };
  const airMap: Record<AirFusionFilterMode, "ALL" | "WITH_SELF_REPORT" | "WITHOUT_SELF_REPORT"> = {
    all: "ALL",
    "with-selfreport": "WITH_SELF_REPORT",
    "without-selfreport": "WITHOUT_SELF_REPORT",
  };

  return {
    fusion_unique_ids: fusionUnique.length > 0 ? fusionUnique : undefined,
    radar_track_ids: radar.length > 0 ? radar : undefined,
    ais_ids: ais.length > 0 ? ais : undefined,
    self_report_ids: selfReport.length > 0 ? selfReport : undefined,
    attr_range: Object.keys(attr).length > 0 ? attr : undefined,
    sea_fusion_filter: seaMap[options.seaFusionFilter],
    air_fusion_filter: airMap[options.airFusionFilter],
    display_sensor_ids:
      options.displaySensorIds.length > 0 ? [...options.displaySensorIds] : undefined,
  };
}

export type DisplayFilterGrpcPayload = ReturnType<typeof buildDisplayFilterGrpcPayload>;

/** 有 ID 筛选时补齐误差评估所需参考传感器 */
export function enrichSensorsForDisplayIdFilters(
  baseSensors: number[],
  displayGrpc: DisplayFilterGrpcPayload,
): number[] {
  const sensorSet = new Set<number>(baseSensors);
  if ((displayGrpc.ais_ids?.length ?? 0) > 0 || sensorSet.has(0)) {
    sensorSet.add(0);
    sensorSet.add(3);
  }
  if ((displayGrpc.self_report_ids?.length ?? 0) > 0) {
    sensorSet.add(0);
    sensorSet.add(6);
    sensorSet.add(4);
    sensorSet.add(202);
  }
  if ((displayGrpc.radar_track_ids?.length ?? 0) > 0) {
    sensorSet.add(0);
    sensorSet.add(1);
    sensorSet.add(2);
    sensorSet.add(5);
    sensorSet.add(204);
    sensorSet.add(203);
  }
  if ((displayGrpc.fusion_unique_ids?.length ?? 0) > 0) {
    sensorSet.add(0);
    sensorSet.add(6);
    sensorSet.add(3);
    sensorSet.add(4);
    sensorSet.add(202);
    sensorSet.add(1);
    sensorSet.add(2);
    sensorSet.add(204);
  }
  return [...sensorSet].sort((a, b) => a - b);
}

export function summarizeDisplayIdFilterHint(displayGrpc: DisplayFilterGrpcPayload): string {
  if ((displayGrpc.fusion_unique_ids?.length ?? 0) > 0) {
    return `融合 unique_id ${displayGrpc.fusion_unique_ids!.join(",")}`;
  }
  if ((displayGrpc.ais_ids?.length ?? 0) > 0) {
    return `AIS ${displayGrpc.ais_ids!.join(",")}`;
  }
  if ((displayGrpc.radar_track_ids?.length ?? 0) > 0) {
    return `雷达 ${displayGrpc.radar_track_ids!.join(",")}`;
  }
  if ((displayGrpc.self_report_ids?.length ?? 0) > 0) {
    return `自报位 ${displayGrpc.self_report_ids!.join(",")}`;
  }
  return "";
}

export function hasActiveDisplayIdOrAttrFilter(displayGrpc: DisplayFilterGrpcPayload): boolean {
  return Boolean(
    (displayGrpc.fusion_unique_ids?.length ?? 0) > 0 ||
      (displayGrpc.radar_track_ids?.length ?? 0) > 0 ||
      (displayGrpc.ais_ids?.length ?? 0) > 0 ||
      (displayGrpc.self_report_ids?.length ?? 0) > 0 ||
      displayGrpc.attr_range ||
      (displayGrpc.sea_fusion_filter && displayGrpc.sea_fusion_filter !== "ALL") ||
      (displayGrpc.air_fusion_filter && displayGrpc.air_fusion_filter !== "ALL"),
  );
}
