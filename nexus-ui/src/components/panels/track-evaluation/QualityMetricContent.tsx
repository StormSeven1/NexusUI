"use client";

import { Loader2 } from "lucide-react";
import {
  useTrackEvaluationStore,
  type QualityMetricTabId,
} from "@/stores/track-evaluation-store";
import type { TrackEvalMetricsResult } from "@/lib/track-evaluation-metrics";
import { TrackEvalLineChart } from "@/components/panels/track-evaluation/TrackEvalLineChart";
import { MetricErrorChart } from "@/components/panels/track-evaluation/MetricErrorChart";

const ERROR_DESC =
  "平均值 = Σ误差值 / 样本数量，RMSE = √(Σ(误差值²) / 样本数量)。对海以 AIS 为参考，对空以自报位为参考。";

function CalculationNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 rounded-md border-l-2 border-sky-500/60 bg-nexus-bg-base/50 px-3 py-2 text-[11px] leading-relaxed text-nexus-text-muted">
      <span className="font-semibold text-sky-400">计算方式：</span>
      {children}
    </p>
  );
}

function renderTab(tab: QualityMetricTabId, m: TrackEvalMetricsResult) {
  switch (tab) {
    case "accuracy":
      return (
        <>
          <CalculationNote>
            准确率 = 融合中的航迹数量 / 该航迹 ID 在 1 小时窗口内的总航迹数量。14s 对空与 KU 雷达分别统计。
          </CalculationNote>
          <TrackEvalLineChart
            title="14s 对空航迹准确率"
            points={m.birdTrackAccuracy.map((x) => ({ id: x.id, value: x.accuracy }))}
            color="#3b82f6"
            formatValue={(v) => `${(v * 100).toFixed(2)}%`}
          />
          <TrackEvalLineChart
            title="KU 雷达航迹准确率"
            points={m.kuRadarAccuracy.map((x) => ({ id: x.id, value: x.accuracy }))}
            color="#ec4899"
            formatValue={(v) => `${(v * 100).toFixed(2)}%`}
          />
        </>
      );
    case "recall":
      return (
        <>
          <CalculationNote>按自报位 ID 分组，衡量融合航迹对源航迹的覆盖程度。</CalculationNote>
          <TrackEvalLineChart
            title="14s 对空召回率"
            points={m.birdTrackRecall.map((x) => ({ id: x.id, value: x.recall }))}
            color="#3b82f6"
            formatValue={(v) => `${(v * 100).toFixed(2)}%`}
          />
          <TrackEvalLineChart
            title="KU 雷达召回率"
            points={m.kuRadarRecall.map((x) => ({ id: x.id, value: x.recall }))}
            color="#a855f7"
            formatValue={(v) => `${(v * 100).toFixed(2)}%`}
          />
        </>
      );
    case "falseAlarm":
      return (
        <>
          <CalculationNote>虚警率 = 1 - 准确率（同源统计口径）。</CalculationNote>
          <TrackEvalLineChart
            title="14s 对空虚警率"
            points={m.birdTrackFalseAlarm.map((x) => ({ id: x.id, value: x.falseAlarm }))}
            color="#f59e0b"
            formatValue={(v) => `${(v * 100).toFixed(2)}%`}
          />
          <TrackEvalLineChart
            title="KU 雷达虚警率"
            points={m.kuRadarFalseAlarm.map((x) => ({ id: x.id, value: x.falseAlarm }))}
            color="#ef4444"
            formatValue={(v) => `${(v * 100).toFixed(2)}%`}
          />
        </>
      );
    case "stability":
      return (
        <>
          <TrackEvalLineChart
            title="对海融合 — 跟踪稳定性（航迹点）"
            description={
              m.seaFusionStabilityAvg != null
                ? `平均 ${(m.seaFusionStabilityAvg * 100).toFixed(1)}%`
                : undefined
            }
            points={m.seaFusionStabilityByAis.map((x) => ({
              id: x.aisId,
              value: x.stability,
            }))}
            color="#22c55e"
            formatValue={(v) => `${(v * 100).toFixed(2)}%`}
          />
          <TrackEvalLineChart
            title="对空融合 — 跟踪稳定性（航迹点）"
            description={
              m.airFusionStabilityAvg != null
                ? `平均 ${(m.airFusionStabilityAvg * 100).toFixed(1)}%`
                : undefined
            }
            points={m.airFusionStabilityBySelfReport.map((x) => ({
              id: x.selfReportId,
              value: x.stability,
            }))}
            color="#06b6d4"
            formatValue={(v) => `${(v * 100).toFixed(2)}%`}
          />
        </>
      );
    case "stabilityDuration":
      return (
        <>
          <TrackEvalLineChart
            title="对海 — 跟踪稳定性（时长）"
            description={
              m.seaFusionStabilityDurationAvg != null
                ? `平均 ${(m.seaFusionStabilityDurationAvg * 100).toFixed(1)}%`
                : undefined
            }
            points={m.seaFusionStabilityDurationByAis.map((x) => ({
              id: x.aisId,
              value: x.stability,
            }))}
            color="#22c55e"
            formatValue={(v) => `${(v * 100).toFixed(2)}%`}
          />
          <TrackEvalLineChart
            title="对空 — 跟踪稳定性（时长）"
            description={
              m.airFusionStabilityDurationAvg != null
                ? `平均 ${(m.airFusionStabilityDurationAvg * 100).toFixed(1)}%`
                : undefined
            }
            points={m.airFusionStabilityDurationBySelfReport.map((x) => ({
              id: x.selfReportId,
              value: x.stability,
            }))}
            color="#06b6d4"
            formatValue={(v) => `${(v * 100).toFixed(2)}%`}
          />
        </>
      );
    case "maxTrackingDuration":
      return (
        <>
          <TrackEvalLineChart
            title="对海最大跟踪时长"
            description={
              m.seaMaxTrackingDurationAvg != null
                ? `平均 ${(m.seaMaxTrackingDurationAvg * 100).toFixed(1)}%`
                : undefined
            }
            points={m.seaMaxTrackingDuration.map((x) => ({
              id: x.aisId,
              value: x.maxDuration,
            }))}
            color="#3b82f6"
            formatValue={(v) => `${(v * 100).toFixed(1)}%`}
          />
          <TrackEvalLineChart
            title="对空最大跟踪时长"
            description={
              m.airMaxTrackingDurationAvg != null
                ? `平均 ${(m.airMaxTrackingDurationAvg * 100).toFixed(1)}%`
                : undefined
            }
            points={m.airMaxTrackingDuration.map((x) => ({
              id: x.selfReportId,
              value: x.maxDuration,
            }))}
            color="#06b6d4"
            formatValue={(v) => `${(v * 100).toFixed(1)}%`}
          />
        </>
      );
    case "breakCount":
      return (
        <>
          <CalculationNote>连续 5 次没有雷达航迹即记为一次断批，值越小越好。</CalculationNote>
          <TrackEvalLineChart
            title="对海断批次数"
            description={
              m.seaBreakCountAvg != null ? `平均 ${m.seaBreakCountAvg.toFixed(2)} 次` : undefined
            }
            points={m.seaBreakCount.map((x) => ({ id: x.aisId, value: x.breakCount }))}
            color="#3b82f6"
            formatValue={(v) => `${v.toFixed(0)} 次`}
          />
          <TrackEvalLineChart
            title="对空断批次数"
            description={
              m.airBreakCountAvg != null ? `平均 ${m.airBreakCountAvg.toFixed(2)} 次` : undefined
            }
            points={m.airBreakCount.map((x) => ({
              id: x.selfReportId,
              value: x.breakCount,
            }))}
            color="#06b6d4"
            formatValue={(v) => `${v.toFixed(0)} 次`}
          />
        </>
      );
    case "changeBatchCount":
      return (
        <>
          <TrackEvalLineChart
            title="对海换批次数"
            description={
              m.seaChangeBatchCountAvg != null
                ? `平均 ${m.seaChangeBatchCountAvg.toFixed(2)} 次`
                : undefined
            }
            points={m.seaChangeBatchCount.map((x) => ({
              id: x.aisId,
              value: x.changeBatchCount,
            }))}
            color="#3b82f6"
            formatValue={(v) => `${v.toFixed(0)} 次`}
          />
          <TrackEvalLineChart
            title="对空换批次数"
            description={
              m.airChangeBatchCountAvg != null
                ? `平均 ${m.airChangeBatchCountAvg.toFixed(2)} 次`
                : undefined
            }
            points={m.airChangeBatchCount.map((x) => ({
              id: x.selfReportId,
              value: x.changeBatchCount,
            }))}
            color="#06b6d4"
            formatValue={(v) => `${v.toFixed(0)} 次`}
          />
        </>
      );
    case "distanceHeightError":
      return (
        <>
          <CalculationNote>{ERROR_DESC}</CalculationNote>
          <MetricErrorChart title="对海 — 距离误差" items={m.seaDistanceError} unit="m" />
          <MetricErrorChart title="对海 — 高度误差" items={m.seaHeightError} unit="m" />
          <MetricErrorChart title="对空 — 距离误差" items={m.airDistanceError} unit="m" />
          <MetricErrorChart title="对空 — 高度误差" items={m.airHeightError} unit="m" />
        </>
      );
    case "azimuthError":
      return (
        <>
          <CalculationNote>{ERROR_DESC}</CalculationNote>
          <MetricErrorChart title="对海 — 方位角误差" items={m.seaAzimuthError} unit="°" />
          <MetricErrorChart title="对空 — 方位角误差" items={m.airAzimuthError} unit="°" />
        </>
      );
    case "elevationError":
      return (
        <>
          <CalculationNote>{ERROR_DESC}</CalculationNote>
          <MetricErrorChart title="对海 — 俯仰角误差" items={m.seaElevationError} unit="°" />
          <MetricErrorChart title="对空 — 俯仰角误差" items={m.airElevationError} unit="°" />
        </>
      );
    case "courseError":
      return (
        <>
          <CalculationNote>{ERROR_DESC}</CalculationNote>
          <MetricErrorChart title="对海 — 航向误差" items={m.seaCourseError} unit="°" />
          <MetricErrorChart title="对空 — 航向误差" items={m.airCourseError} unit="°" />
        </>
      );
    case "speedError":
      return (
        <>
          <CalculationNote>{ERROR_DESC}</CalculationNote>
          <MetricErrorChart title="对海 — 航速误差" items={m.seaSpeedError} unit=" m/s" />
          <MetricErrorChart title="对空 — 航速误差" items={m.airSpeedError} unit=" m/s" />
        </>
      );
    default:
      return null;
  }
}

export function QualityMetricContent() {
  const qualityTab = useTrackEvaluationStore((s) => s.qualityTab);
  const metrics = useTrackEvaluationStore((s) => s.metrics);
  const metricsComputing = useTrackEvaluationStore((s) => s.metricsComputing);
  const queryStats = useTrackEvaluationStore((s) => s.queryStats);

  if (metricsComputing) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-nexus-accent" aria-hidden />
        <p className="text-[13px] font-medium text-nexus-accent">正在分析...</p>
      </div>
    );
  }

  if (!metrics) {
    return (
      <EmptyState
        title="暂无评估数据"
        subtitle={
          <>
            在「航迹筛选」中发送查询；数据接收完成后将自动计算并展示图表。
            {queryStats.total > 0 ? ` 已缓存 ${queryStats.total} 条航迹点。` : ""}
          </>
        }
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1 text-nexus-text-secondary">
      {renderTab(qualityTab, metrics)}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon?: string;
  title: string;
  subtitle?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      {icon ? <span className="text-lg opacity-40">{icon}</span> : null}
      <p className="text-[13px] text-nexus-text-muted">{title}</p>
      {subtitle ? (
        <p className="max-w-xs text-[11px] leading-relaxed text-nexus-text-muted/80">{subtitle}</p>
      ) : null}
    </div>
  );
}
