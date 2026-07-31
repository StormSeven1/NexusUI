/**
 * gRPC EvaluateTrackQualityResponse（JSON）→ 前端 TrackEvalMetricsResult
 */
import type { TrackEvalMetricsResult, TrackErrorStatsItem } from "@/lib/track-evaluation-metrics";

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function optNum(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapErrorItems(arr: unknown): TrackErrorStatsItem[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((raw) => {
    const o = raw as Record<string, unknown>;
    const sourceRaw = o.source_errors ?? o.sourceErrors;
    const sourceErrors = Array.isArray(sourceRaw)
      ? sourceRaw.map((s) => {
          const x = s as Record<string, unknown>;
          return {
            key: String(x.source_key ?? x.key ?? ""),
            label: String(x.source_name ?? x.label ?? x.source_key ?? ""),
            avg: optNum(x.avg),
            rmse: optNum(x.rmse),
            errors: [] as number[],
          };
        })
      : [];
    return {
      id: String(o.reference_id ?? o.id ?? ""),
      fusionAvg: optNum(o.fusion_avg),
      fusionRmse: optNum(o.fusion_rmse),
      radar1Avg: optNum(o.radar1_avg),
      radar1Rmse: optNum(o.radar1_rmse),
      radar2Avg: optNum(o.radar2_avg),
      radar2Rmse: optNum(o.radar2_rmse),
      radar1Key: typeof o.radar1_key === "string" ? o.radar1_key : undefined,
      radar1Name: typeof o.radar1_name === "string" ? o.radar1_name : undefined,
      radar2Key: typeof o.radar2_key === "string" ? o.radar2_key : undefined,
      radar2Name: typeof o.radar2_name === "string" ? o.radar2_name : undefined,
      fusionErrors: [],
      radar1Errors: [],
      radar2Errors: [],
      sourceErrors,
    };
  });
}

function emptyMetrics(): TrackEvalMetricsResult {
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
    seaFusionTrackCoverageAvg: null,
    airFusionTrackCoverageAvg: null,
    seaFusionTrackCoverageByAis: [],
    airFusionTrackCoverageBySelfReport: [],
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

export function grpcResultToTrackEvalMetrics(result: Record<string, unknown>): TrackEvalMetricsResult {
  const out = emptyMetrics();
  const fe = (result.fusion_effect ?? {}) as Record<string, unknown>;
  const cont = (result.continuity ?? {}) as Record<string, unknown>;
  const err = (result.errors ?? {}) as Record<string, unknown>;

  const mapAcc = (arr: unknown, ku = false) => {
    if (!Array.isArray(arr)) return;
    for (const raw of arr) {
      const o = raw as Record<string, unknown>;
      const item = {
        id: String(o.radar_track_id ?? o.id ?? ""),
        accuracy: num(o.accuracy),
        fusedCount: num(o.fused_count),
        birdCount: ku ? 0 : num(o.radar_count),
        kuCount: ku ? num(o.radar_count) : 0,
        fusionTrackIds: Array.isArray(o.fusion_track_ids) ? o.fusion_track_ids : [],
        selfReportIds: Array.isArray(o.self_report_ids) ? (o.self_report_ids as string[]) : [],
      };
      if (ku) out.kuRadarAccuracy.push(item as (typeof out.kuRadarAccuracy)[0]);
      else out.birdTrackAccuracy.push(item as (typeof out.birdTrackAccuracy)[0]);
    }
  };
  mapAcc(fe.bird_track_accuracy, false);
  mapAcc(fe.ku_radar_accuracy, true);

  if (Array.isArray(fe.bird_track_recall)) {
    out.birdTrackRecall = fe.bird_track_recall.map((raw) => {
      const o = raw as Record<string, unknown>;
      return {
        id: String(o.self_report_id ?? o.id ?? ""),
        recall: num(o.recall),
        birdCount: num(o.bird_or_ku_count),
        selfReportCount: num(o.fusion_count),
        totalSelfReportIds: 0,
        totalFusionTracks: 0,
      };
    });
  }
  if (Array.isArray(fe.ku_radar_recall)) {
    out.kuRadarRecall = fe.ku_radar_recall.map((raw) => {
      const o = raw as Record<string, unknown>;
      return {
        id: String(o.self_report_id ?? o.id ?? ""),
        recall: num(o.recall),
        kuCount: num(o.bird_or_ku_count),
        selfReportCount: num(o.fusion_count),
        totalSelfReportIds: 0,
        totalFusionTracks: 0,
      };
    });
  }

  if (Array.isArray(fe.bird_false_alarm)) {
    out.birdTrackFalseAlarm = fe.bird_false_alarm.map((raw) => {
      const o = raw as Record<string, unknown>;
      return {
        id: String(o.radar_track_id ?? ""),
        falseAlarm: num(o.false_alarm),
        fusedCount: num(o.fused_count),
        birdCount: num(o.radar_count),
        fusionTrackIds: [],
        selfReportIds: [],
      };
    });
  }
  if (Array.isArray(fe.ku_false_alarm)) {
    out.kuRadarFalseAlarm = fe.ku_false_alarm.map((raw) => {
      const o = raw as Record<string, unknown>;
      return {
        id: String(o.radar_track_id ?? ""),
        falseAlarm: num(o.false_alarm),
        fusedCount: num(o.fused_count),
        kuCount: num(o.radar_count),
        fusionTrackIds: [],
        selfReportIds: [],
      };
    });
  }

  const seaStab = fe.sea_stability as Record<string, unknown> | undefined;
  if (seaStab) {
    out.seaFusionStabilityAvg = optNum(seaStab.avg_stability);
    if (Array.isArray(seaStab.by_reference)) {
      out.seaFusionStabilityByAis = seaStab.by_reference.map((raw) => {
        const o = raw as Record<string, unknown>;
        return { aisId: String(o.reference_id ?? ""), stability: num(o.stability) };
      });
    }
  }
  const airStab = fe.air_stability as Record<string, unknown> | undefined;
  if (airStab) {
    out.airFusionStabilityAvg = optNum(airStab.avg_stability);
    if (Array.isArray(airStab.by_reference)) {
      out.airFusionStabilityBySelfReport = airStab.by_reference.map((raw) => {
        const o = raw as Record<string, unknown>;
        return { selfReportId: String(o.reference_id ?? ""), stability: num(o.stability) };
      });
    }
  }

  const seaDur = cont.sea_stability_duration as Record<string, unknown> | undefined;
  if (seaDur) {
    out.seaFusionStabilityDurationAvg = optNum(seaDur.avg);
    if (Array.isArray(seaDur.by_reference)) {
      out.seaFusionStabilityDurationByAis = seaDur.by_reference.map((raw) => {
        const o = raw as Record<string, unknown>;
        return { aisId: String(o.reference_id ?? ""), stability: num(o.stability) };
      });
    }
  }
  const airDur = cont.air_stability_duration as Record<string, unknown> | undefined;
  if (airDur) {
    out.airFusionStabilityDurationAvg = optNum(airDur.avg);
    if (Array.isArray(airDur.by_reference)) {
      out.airFusionStabilityDurationBySelfReport = airDur.by_reference.map((raw) => {
        const o = raw as Record<string, unknown>;
        return { selfReportId: String(o.reference_id ?? ""), stability: num(o.stability) };
      });
    }
  }

  if (Array.isArray(cont.sea_break_count)) {
    out.seaBreakCount = cont.sea_break_count.map((raw) => {
      const o = raw as Record<string, unknown>;
      return { aisId: String(o.reference_id ?? ""), breakCount: num(o.break_count) };
    });
  }
  if (Array.isArray(cont.air_break_count)) {
    out.airBreakCount = cont.air_break_count.map((raw) => {
      const o = raw as Record<string, unknown>;
      return { selfReportId: String(o.reference_id ?? ""), breakCount: num(o.break_count) };
    });
  }
  out.seaBreakCountAvg = optNum(cont.sea_break_count_avg);
  out.airBreakCountAvg = optNum(cont.air_break_count_avg);

  if (Array.isArray(cont.sea_change_batch)) {
    out.seaChangeBatchCount = cont.sea_change_batch.map((raw) => {
      const o = raw as Record<string, unknown>;
      return { aisId: String(o.reference_id ?? ""), changeBatchCount: num(o.change_batch_count) };
    });
  }
  if (Array.isArray(cont.air_change_batch)) {
    out.airChangeBatchCount = cont.air_change_batch.map((raw) => {
      const o = raw as Record<string, unknown>;
      return { selfReportId: String(o.reference_id ?? ""), changeBatchCount: num(o.change_batch_count) };
    });
  }
  out.seaChangeBatchCountAvg = optNum(cont.sea_change_batch_count_avg);
  out.airChangeBatchCountAvg = optNum(cont.air_change_batch_count_avg);

  if (Array.isArray(cont.sea_max_tracking)) {
    out.seaMaxTrackingDuration = cont.sea_max_tracking.map((raw) => {
      const o = raw as Record<string, unknown>;
      return {
        aisId: String(o.reference_id ?? ""),
        maxDuration: num(o.max_duration_ratio),
        longestRadarId: o.longest_radar_id as string | number,
        longestRadarType: "",
        longestRadarDuration: 0,
        aisDuration: 0,
        fusionTrackIds: [],
      };
    });
  }
  if (Array.isArray(cont.air_max_tracking)) {
    out.airMaxTrackingDuration = cont.air_max_tracking.map((raw) => {
      const o = raw as Record<string, unknown>;
      return {
        selfReportId: String(o.reference_id ?? ""),
        maxDuration: num(o.max_duration_ratio),
        longestRadarId: o.longest_radar_id as string | number,
        longestRadarType: "",
        longestRadarDuration: 0,
        selfReportDuration: 0,
        fusionTrackIds: [],
      };
    });
  }
  out.seaMaxTrackingDurationAvg = optNum(cont.sea_max_tracking_duration_avg);
  out.airMaxTrackingDurationAvg = optNum(cont.air_max_tracking_duration_avg);

  const seaFusCov = cont.sea_fusion_track_coverage as Record<string, unknown> | undefined;
  if (seaFusCov) {
    out.seaFusionTrackCoverageAvg = optNum(seaFusCov.avg);
    if (Array.isArray(seaFusCov.by_reference)) {
      out.seaFusionTrackCoverageByAis = seaFusCov.by_reference.map((raw) => {
        const o = raw as Record<string, unknown>;
        return { aisId: String(o.reference_id ?? ""), coverage: num(o.stability) };
      });
    }
  }
  const airFusCov = cont.air_fusion_track_coverage as Record<string, unknown> | undefined;
  if (airFusCov) {
    out.airFusionTrackCoverageAvg = optNum(airFusCov.avg);
    if (Array.isArray(airFusCov.by_reference)) {
      out.airFusionTrackCoverageBySelfReport = airFusCov.by_reference.map((raw) => {
        const o = raw as Record<string, unknown>;
        return { selfReportId: String(o.reference_id ?? ""), coverage: num(o.stability) };
      });
    }
  }

  out.seaDistanceError = mapErrorItems(err.sea_distance);
  out.seaHeightError = mapErrorItems(err.sea_height);
  out.airDistanceError = mapErrorItems(err.air_distance);
  out.airHeightError = mapErrorItems(err.air_height);
  out.seaAzimuthError = mapErrorItems(err.sea_azimuth);
  out.airAzimuthError = mapErrorItems(err.air_azimuth);
  out.seaElevationError = mapErrorItems(err.sea_elevation);
  out.airElevationError = mapErrorItems(err.air_elevation);
  out.seaCourseError = mapErrorItems(err.sea_course);
  out.airCourseError = mapErrorItems(err.air_course);
  out.seaSpeedError = mapErrorItems(err.sea_speed);
  out.airSpeedError = mapErrorItems(err.air_speed);

  return out;
}
