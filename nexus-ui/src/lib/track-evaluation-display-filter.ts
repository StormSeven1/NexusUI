/**
 * 航迹评估「显示筛选」（对齐 mapbox-vue2 TrackFilterPanel.applyFilter / handleApplyFilter）
 */

import type { EvalTrackFeature, TrackEvalMetricsResult, TrackErrorStatsItem } from "@/lib/track-evaluation-metrics";

export type SeaFusionFilterMode = "all" | "with-ais" | "without-ais";
export type AirFusionFilterMode = "all" | "with-selfreport" | "without-selfreport";

export interface TrackEvalDisplayFilterState {
  displaySensorIds: number[];
  seaFusionFilter: SeaFusionFilterMode;
  airFusionFilter: AirFusionFilterMode;
  trackId: string;
  uniqueId: string;
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
    trackId: "",
    uniqueId: "",
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
    const aisId = f.originalData?.original_track_id2;
    const hasAis = isValidOriginalId(aisId);
    if (options.seaFusionFilter === "with-ais") return hasAis;
    if (options.seaFusionFilter === "without-ais") return !hasAis;
    return true;
  }
  if (sensorId === 6) {
    if (!options.displaySensorIds.includes(6)) return false;
    const selfReportId = f.originalData?.original_track_id2;
    const hasSelfReport = isValidOriginalId(selfReportId);
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

  const hasRef =
    isValidOriginalId(f.originalData?.original_track_id2);
  if (!hasRef) return false;

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

  if (
    !check(options.minDistanceError, options.maxDistanceError, errorInfo.distance?.fusion)
  ) {
    return false;
  }
  if (
    !check(options.minHeightError, options.maxHeightError, errorInfo.height?.fusion, true)
  ) {
    return false;
  }
  if (
    !check(options.minAzimuthError, options.maxAzimuthError, errorInfo.azimuth?.fusion)
  ) {
    return false;
  }
  if (
    !check(
      options.minElevationError,
      options.maxElevationError,
      errorInfo.elevation?.fusion,
    )
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

/** WS 路径：对已查询航迹点做显示筛选 */
export function filterEvalTrackFeatures(
  features: EvalTrackFeature[],
  options: TrackEvalDisplayFilterState,
): EvalTrackFeature[] {
  const trackIdList = parseCommaSeparatedIds(options.trackId);
  const uniqueIdList = parseCommaSeparatedIds(options.uniqueId);
  const out: EvalTrackFeature[] = [];

  for (const f of features) {
    if (!matchesSensorFilter(f, options)) continue;

    const tid = Number(f.trackId);
    if (trackIdList.length > 0 && !trackIdList.includes(tid)) continue;

    const uid = Number(f.uniqueId);
    if (uniqueIdList.length > 0 && !uniqueIdList.includes(uid)) continue;

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

function idInLists(id: string, trackIds: number[], uniqueIds: number[]): boolean {
  if (trackIds.length === 0 && uniqueIds.length === 0) return true;
  const n = parseInt(id, 10);
  if (Number.isFinite(n)) {
    if (trackIds.includes(n) || uniqueIds.includes(n)) return true;
  }
  return false;
}

function filterMetricIdArrays<T>(
  items: T[],
  trackIds: number[],
  uniqueIds: number[],
  idOf: (item: T) => string,
  extraIds?: (item: T) => string[],
): T[] {
  if (trackIds.length === 0 && uniqueIds.length === 0) return items;
  return items.filter((item) => {
    if (idInLists(idOf(item), trackIds, uniqueIds)) return true;
    const extras = extraIds?.(item) ?? [];
    return extras.some((eid) => idInLists(eid, trackIds, uniqueIds));
  });
}

/** gRPC 路径：对聚合指标做显示筛选（多 ID、误差范围等） */
export function filterGrpcTrackMetrics(
  metrics: TrackEvalMetricsResult,
  options: TrackEvalDisplayFilterState,
): TrackEvalMetricsResult {
  const trackIds = parseCommaSeparatedIds(options.trackId);
  const uniqueIds = parseCommaSeparatedIds(options.uniqueId);

  const filterAcc = <T extends { id: string; fusionTrackIds?: (number | string)[] }>(
    items: T[],
  ) =>
    filterMetricIdArrays(
      items,
      trackIds,
      uniqueIds,
      (item) => item.id,
      (item) => (item.fusionTrackIds ?? []).map(String),
    );

  return {
    ...metrics,
    birdTrackAccuracy: filterAcc(metrics.birdTrackAccuracy),
    kuRadarAccuracy: filterAcc(metrics.kuRadarAccuracy),
    birdTrackRecall: filterMetricIdArrays(
      metrics.birdTrackRecall,
      trackIds,
      uniqueIds,
      (item) => item.id,
    ),
    kuRadarRecall: filterMetricIdArrays(
      metrics.kuRadarRecall,
      trackIds,
      uniqueIds,
      (item) => item.id,
    ),
    birdTrackFalseAlarm: filterAcc(metrics.birdTrackFalseAlarm),
    kuRadarFalseAlarm: filterAcc(metrics.kuRadarFalseAlarm),
    seaBreakCount: filterMetricIdArrays(
      metrics.seaBreakCount,
      trackIds,
      uniqueIds,
      (item) => item.aisId,
    ),
    airBreakCount: filterMetricIdArrays(
      metrics.airBreakCount,
      trackIds,
      uniqueIds,
      (item) => item.selfReportId,
    ),
    seaChangeBatchCount: filterMetricIdArrays(
      metrics.seaChangeBatchCount,
      trackIds,
      uniqueIds,
      (item) => item.aisId,
    ),
    airChangeBatchCount: filterMetricIdArrays(
      metrics.airChangeBatchCount,
      trackIds,
      uniqueIds,
      (item) => item.selfReportId,
    ),
    seaMaxTrackingDuration: filterMetricIdArrays(
      metrics.seaMaxTrackingDuration,
      trackIds,
      uniqueIds,
      (item) => item.aisId,
      (item) => (item.fusionTrackIds ?? []).map(String),
    ),
    airMaxTrackingDuration: filterMetricIdArrays(
      metrics.airMaxTrackingDuration,
      trackIds,
      uniqueIds,
      (item) => item.selfReportId,
      (item) => (item.fusionTrackIds ?? []).map(String),
    ),
    seaDistanceError: filterErrorStatsItems(
      filterMetricIdArrays(
        metrics.seaDistanceError,
        trackIds,
        uniqueIds,
        (item) => item.id,
      ),
      options.minDistanceError,
      options.maxDistanceError,
    ),
    airDistanceError: filterErrorStatsItems(
      filterMetricIdArrays(
        metrics.airDistanceError,
        trackIds,
        uniqueIds,
        (item) => item.id,
      ),
      options.minDistanceError,
      options.maxDistanceError,
    ),
    seaHeightError: filterErrorStatsItems(
      filterMetricIdArrays(
        metrics.seaHeightError,
        trackIds,
        uniqueIds,
        (item) => item.id,
      ),
      options.minHeightError,
      options.maxHeightError,
    ),
    airHeightError: filterErrorStatsItems(
      filterMetricIdArrays(
        metrics.airHeightError,
        trackIds,
        uniqueIds,
        (item) => item.id,
      ),
      options.minHeightError,
      options.maxHeightError,
    ),
    seaAzimuthError: filterErrorStatsItems(
      filterMetricIdArrays(
        metrics.seaAzimuthError,
        trackIds,
        uniqueIds,
        (item) => item.id,
      ),
      options.minAzimuthError,
      options.maxAzimuthError,
    ),
    airAzimuthError: filterErrorStatsItems(
      filterMetricIdArrays(
        metrics.airAzimuthError,
        trackIds,
        uniqueIds,
        (item) => item.id,
      ),
      options.minAzimuthError,
      options.maxAzimuthError,
    ),
    seaElevationError: filterErrorStatsItems(
      filterMetricIdArrays(
        metrics.seaElevationError,
        trackIds,
        uniqueIds,
        (item) => item.id,
      ),
      options.minElevationError,
      options.maxElevationError,
    ),
    airElevationError: filterErrorStatsItems(
      filterMetricIdArrays(
        metrics.airElevationError,
        trackIds,
        uniqueIds,
        (item) => item.id,
      ),
      options.minElevationError,
      options.maxElevationError,
    ),
    seaCourseError: filterErrorStatsItems(
      filterMetricIdArrays(
        metrics.seaCourseError,
        trackIds,
        uniqueIds,
        (item) => item.id,
      ),
      options.minCourseError,
      options.maxCourseError,
    ),
    airCourseError: filterErrorStatsItems(
      filterMetricIdArrays(
        metrics.airCourseError,
        trackIds,
        uniqueIds,
        (item) => item.id,
      ),
      options.minCourseError,
      options.maxCourseError,
    ),
    seaSpeedError: filterErrorStatsItems(
      filterMetricIdArrays(
        metrics.seaSpeedError,
        trackIds,
        uniqueIds,
        (item) => item.id,
      ),
      options.minSpeedError,
      options.maxSpeedError,
    ),
    airSpeedError: filterErrorStatsItems(
      filterMetricIdArrays(
        metrics.airSpeedError,
        trackIds,
        uniqueIds,
        (item) => item.id,
      ),
      options.minSpeedError,
      options.maxSpeedError,
    ),
  };
}

export function buildDisplayFilterGrpcPayload(
  options: TrackEvalDisplayFilterState,
): Pick<
  import("@/lib/system-eval-track-api").TrackEvalGrpcRequest,
  | "fused_track_id"
  | "unique_id"
  | "attr_range"
  | "sea_fusion_filter"
  | "air_fusion_filter"
  | "display_sensor_ids"
> {
  const trackIds = parseCommaSeparatedIds(options.trackId);
  const uniqueIds = parseCommaSeparatedIds(options.uniqueId);
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
    fused_track_id: trackIds.length === 1 ? trackIds[0] : undefined,
    unique_id: uniqueIds.length === 1 ? uniqueIds[0] : undefined,
    attr_range: Object.keys(attr).length > 0 ? attr : undefined,
    sea_fusion_filter: seaMap[options.seaFusionFilter],
    air_fusion_filter: airMap[options.airFusionFilter],
    display_sensor_ids:
      options.displaySensorIds.length > 0 ? [...options.displaySensorIds] : undefined,
  };
}
