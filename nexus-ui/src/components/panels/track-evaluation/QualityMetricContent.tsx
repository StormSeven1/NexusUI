"use client";

import {
  useTrackEvaluationStore,
  type QualityMetricTabId,
} from "@/stores/track-evaluation-store";
import type { TrackEvalMetricsResult, TrackErrorStatsItem } from "@/lib/track-evaluation-metrics";
import { MetricRateChart } from "@/components/panels/track-evaluation/MetricRateChart";

function ErrorStatsTable({
  title,
  items,
}: {
  title: string;
  items: TrackErrorStatsItem[];
}) {
  if (items.length === 0) {
    return (
      <section className="mb-3">
        <h4 className="text-xs font-semibold text-nexus-text-secondary">{title}</h4>
        <p className="mt-1 text-[11px] text-nexus-text-muted">暂无数据</p>
      </section>
    );
  }
  return (
    <section className="mb-3">
      <h4 className="mb-1 text-xs font-semibold text-nexus-text-secondary">{title}</h4>
      <ul className="max-h-40 space-y-1 overflow-y-auto">
        {items.slice(0, 15).map((it) => (
          <li
            key={it.id}
            className="rounded border border-nexus-border/50 bg-nexus-bg-base/30 px-2 py-1 font-mono text-[10px] text-nexus-text-muted"
          >
            <span className="text-nexus-text-secondary">AIS/自报 {it.id}</span>
            <span className="ml-2">
              融合 avg {it.fusionAvg?.toFixed(2) ?? "--"} rmse {it.fusionRmse?.toFixed(2) ?? "--"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function renderTab(tab: QualityMetricTabId, m: TrackEvalMetricsResult) {
  switch (tab) {
    case "accuracy":
      return (
        <MetricRateChart
          title="准确率"
          description="准确率 = 融合中的航迹数量 / 该航迹 ID 在 1 小时窗口内的总航迹数量。"
          series={[
            {
              label: "14s 对空",
              color: "#3b82f6",
              points: m.birdTrackAccuracy.map((x) => ({
                id: x.id,
                value: x.accuracy,
              })),
            },
            {
              label: "KU 雷达",
              color: "#a855f7",
              points: m.kuRadarAccuracy.map((x) => ({ id: x.id, value: x.accuracy })),
            },
          ]}
        />
      );
    case "recall":
      return (
        <MetricRateChart
          title="召回率"
          description="按自报位 ID 分组，衡量融合航迹对源航迹的覆盖程度。"
          series={[
            {
              label: "14s 对空召回",
              color: "#3b82f6",
              points: m.birdTrackRecall.map((x) => ({ id: x.id, value: x.recall })),
            },
            {
              label: "KU 雷达召回",
              color: "#a855f7",
              points: m.kuRadarRecall.map((x) => ({ id: x.id, value: x.recall })),
            },
          ]}
        />
      );
    case "falseAlarm":
      return (
        <MetricRateChart
          title="虚警率"
          description="虚警率 = 1 - 准确率（同源统计口径）。"
          series={[
            {
              label: "14s 对空虚警",
              color: "#f59e0b",
              points: m.birdTrackFalseAlarm.map((x) => ({
                id: x.id,
                value: x.falseAlarm,
              })),
            },
            {
              label: "KU 雷达虚警",
              color: "#ef4444",
              points: m.kuRadarFalseAlarm.map((x) => ({
                id: x.id,
                value: x.falseAlarm,
              })),
            },
          ]}
        />
      );
    case "stability":
      return (
        <>
          <MetricRateChart
            title="对海融合 — 跟踪稳定性（航迹点）"
            series={[
              {
                label: `平均 ${m.seaFusionStabilityAvg != null ? (m.seaFusionStabilityAvg * 100).toFixed(1) : "--"}%`,
                color: "#22c55e",
                points: m.seaFusionStabilityByAis.map((x) => ({
                  id: x.aisId,
                  value: x.stability,
                })),
              },
            ]}
          />
          <MetricRateChart
            title="对空融合 — 跟踪稳定性（航迹点）"
            series={[
              {
                label: `平均 ${m.airFusionStabilityAvg != null ? (m.airFusionStabilityAvg * 100).toFixed(1) : "--"}%`,
                color: "#06b6d4",
                points: m.airFusionStabilityBySelfReport.map((x) => ({
                  id: x.selfReportId,
                  value: x.stability,
                })),
              },
            ]}
          />
        </>
      );
    case "stabilityDuration":
      return (
        <>
          <MetricRateChart
            title="对海 — 跟踪稳定性（时长）"
            series={[
              {
                label: `平均 ${m.seaFusionStabilityDurationAvg != null ? (m.seaFusionStabilityDurationAvg * 100).toFixed(1) : "--"}%`,
                color: "#22c55e",
                points: m.seaFusionStabilityDurationByAis.map((x) => ({
                  id: x.aisId,
                  value: x.stability,
                })),
              },
            ]}
          />
          <MetricRateChart
            title="对空 — 跟踪稳定性（时长）"
            series={[
              {
                label: `平均 ${m.airFusionStabilityDurationAvg != null ? (m.airFusionStabilityDurationAvg * 100).toFixed(1) : "--"}%`,
                color: "#06b6d4",
                points: m.airFusionStabilityDurationBySelfReport.map((x) => ({
                  id: x.selfReportId,
                  value: x.stability,
                })),
              },
            ]}
          />
        </>
      );
    case "maxTrackingDuration":
      return (
        <>
          <DurationList
            title="对海最大跟踪时长"
            rows={m.seaMaxTrackingDuration.map((x) => ({
              id: x.aisId,
              value: (x.maxDuration * 100).toFixed(1) + "%",
            }))}
            avg={m.seaMaxTrackingDurationAvg}
          />
          <DurationList
            title="对空最大跟踪时长"
            rows={m.airMaxTrackingDuration.map((x) => ({
              id: x.selfReportId,
              value: (x.maxDuration * 100).toFixed(1) + "%",
            }))}
            avg={m.airMaxTrackingDurationAvg}
          />
        </>
      );
    case "breakCount":
      return (
        <>
          <CountList
            title="对海断批次数"
            rows={m.seaBreakCount.map((x) => ({ id: x.aisId, value: String(x.breakCount) }))}
            avg={m.seaBreakCountAvg}
          />
          <CountList
            title="对空断批次数"
            rows={m.airBreakCount.map((x) => ({
              id: x.selfReportId,
              value: String(x.breakCount),
            }))}
            avg={m.airBreakCountAvg}
          />
        </>
      );
    case "changeBatchCount":
      return (
        <>
          <CountList
            title="对海换批次数"
            rows={m.seaChangeBatchCount.map((x) => ({
              id: x.aisId,
              value: String(x.changeBatchCount),
            }))}
            avg={m.seaChangeBatchCountAvg}
          />
          <CountList
            title="对空换批次数"
            rows={m.airChangeBatchCount.map((x) => ({
              id: x.selfReportId,
              value: String(x.changeBatchCount),
            }))}
            avg={m.airChangeBatchCountAvg}
          />
        </>
      );
    case "distanceHeightError":
      return (
        <>
          <ErrorStatsTable title="对海 — 距离误差" items={m.seaDistanceError} />
          <ErrorStatsTable title="对海 — 高度误差" items={m.seaHeightError} />
          <ErrorStatsTable title="对空 — 距离误差" items={m.airDistanceError} />
          <ErrorStatsTable title="对空 — 高度误差" items={m.airHeightError} />
        </>
      );
    case "azimuthError":
      return (
        <>
          <ErrorStatsTable title="对海 — 方位角误差" items={m.seaAzimuthError} />
          <ErrorStatsTable title="对空 — 方位角误差" items={m.airAzimuthError} />
        </>
      );
    case "elevationError":
      return (
        <>
          <ErrorStatsTable title="对海 — 俯仰角误差" items={m.seaElevationError} />
          <ErrorStatsTable title="对空 — 俯仰角误差" items={m.airElevationError} />
        </>
      );
    case "courseError":
      return (
        <>
          <ErrorStatsTable title="对海 — 航向误差" items={m.seaCourseError} />
          <ErrorStatsTable title="对空 — 航向误差" items={m.airCourseError} />
        </>
      );
    case "speedError":
      return (
        <>
          <ErrorStatsTable title="对海 — 航速误差" items={m.seaSpeedError} />
          <ErrorStatsTable title="对空 — 航速误差" items={m.airSpeedError} />
        </>
      );
    default:
      return null;
  }
}

function DurationList({
  title,
  rows,
  avg,
}: {
  title: string;
  rows: { id: string; value: string }[];
  avg: number | null;
}) {
  if (rows.length === 0) {
    return (
      <section className="mb-3">
        <h4 className="text-xs font-semibold text-nexus-text-secondary">{title}</h4>
        <p className="text-[11px] text-nexus-text-muted">暂无数据</p>
      </section>
    );
  }
  return (
    <section className="mb-3">
      <h4 className="mb-1 text-xs font-semibold text-nexus-text-secondary">
        {title}
        {avg != null ? (
          <span className="ml-2 font-normal text-nexus-text-muted">
            平均 {(avg * 100).toFixed(1)}%
          </span>
        ) : null}
      </h4>
      <ul className="max-h-36 space-y-1 overflow-y-auto">
        {rows.slice(0, 12).map((it) => (
          <li key={it.id} className="flex justify-between font-mono text-[10px] text-nexus-text-muted">
            <span>{it.id}</span>
            <span>{it.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CountList({
  title,
  rows,
  avg,
}: {
  title: string;
  rows: { id: string; value: string }[];
  avg: number | null;
}) {
  if (rows.length === 0) {
    return (
      <section className="mb-3">
        <h4 className="text-xs font-semibold text-nexus-text-secondary">{title}</h4>
        <p className="text-[11px] text-nexus-text-muted">暂无数据</p>
      </section>
    );
  }
  return (
    <section className="mb-3">
      <h4 className="mb-1 text-xs font-semibold text-nexus-text-secondary">
        {title}
        {avg != null ? (
          <span className="ml-2 font-normal text-nexus-text-muted">平均 {avg.toFixed(2)}</span>
        ) : null}
      </h4>
      <ul className="max-h-36 space-y-1 overflow-y-auto">
        {rows.slice(0, 12).map((it) => (
          <li key={it.id} className="flex justify-between font-mono text-[10px] text-nexus-text-muted">
            <span>{it.id}</span>
            <span>{it.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function QualityMetricContent() {
  const qualityTab = useTrackEvaluationStore((s) => s.qualityTab);
  const metrics = useTrackEvaluationStore((s) => s.metrics);
  const metricsComputing = useTrackEvaluationStore((s) => s.metricsComputing);
  const queryStats = useTrackEvaluationStore((s) => s.queryStats);

  if (metricsComputing) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <span className="text-lg opacity-40">⏳</span>
        <p className="text-xs text-nexus-text-muted">正在计算质量指标…</p>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
        <p className="text-xs text-nexus-text-muted">暂无评估数据</p>
        <p className="text-[10px] leading-relaxed text-nexus-text-muted/80">
          在「航迹筛选」中发送查询；数据接收完成后将自动计算并展示图表（不绘制到地图）。
          {queryStats.total > 0 ? ` 已缓存 ${queryStats.total} 条航迹点。` : ""}
        </p>
      </div>
    );
  }

  return <div className="min-h-0 flex-1 overflow-y-auto pr-1">{renderTab(qualityTab, metrics)}</div>;
}
