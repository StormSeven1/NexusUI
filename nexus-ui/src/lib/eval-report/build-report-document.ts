import {
  PERF_STAGE_LABELS,
  type SystemResponseTimeStats,
} from "@/lib/system-eval-perf-api";
import type {
  TrackErrorStatsItem,
  TrackEvalMetricsResult,
} from "@/lib/track-evaluation-metrics";
import type {
  ReportBlock,
  ReportDocument,
  ReportSection,
} from "@/lib/eval-report/types";
import {
  EVAL_REPORT_AUTHOR,
  EVAL_REPORT_TITLE,
  applyReportOutlineNumbering,
} from "@/lib/eval-report/types";
import type { TrackChartItem } from "@/lib/eval-report/track-chart-items";
import {
  TRACK_LINK_SEGMENT_LABELS,
  type TrackLinkTypeResult,
} from "@/lib/system-eval-track-link-api";

function formatMs(v: number | undefined | null): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${Math.round(v)} ms`;
}

function formatPct(v: number | null | undefined, digits = 1): string | null {
  if (v == null || Number.isNaN(v)) return null;
  return `${(v * 100).toFixed(digits)}%`;
}

function formatNum(v: number | null | undefined, digits = 2, suffix = ""): string | null {
  if (v == null || Number.isNaN(v)) return null;
  return `${v.toFixed(digits)}${suffix}`;
}

function avgOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function pushRow(
  rows: Array<{ label: string; value: string }>,
  label: string,
  value: string | null | undefined,
) {
  if (value == null || value === "" || value === "—") return;
  rows.push({ label, value });
}

function pushChartItem(
  items: TrackChartItem[],
  label: string,
  value: number | null | undefined,
  format: TrackChartItem["format"] = "percent",
  unit?: string,
  digits?: number,
) {
  if (value == null || Number.isNaN(value)) return;
  items.push({ label, value, format, unit, digits });
}

function pushErrorChartItems(
  items: TrackChartItem[],
  title: string,
  errorItems: TrackErrorStatsItem[],
  unit: string,
) {
  if (!errorItems || errorItems.length === 0) return;
  const fusionAvg = avgField(errorItems, (it) => it.fusionAvg);
  const fusionRmse = avgField(errorItems, (it) => it.fusionRmse);
  pushChartItem(items, `${title}融合均值`, fusionAvg, "number", unit);
  pushChartItem(items, `${title}融合RMSE`, fusionRmse, "number", unit);
}


function avgField(
  items: TrackErrorStatsItem[],
  pick: (it: TrackErrorStatsItem) => number | null | undefined,
): number | null {
  return avgOf(
    items.map(pick).filter((v): v is number => v != null && !Number.isNaN(v)),
  );
}

/** 误差指标摘要行：仅写入有数据的融合均值/RMSE 与各源均值 */
function pushErrorMetricRows(
  rows: Array<{ label: string; value: string }>,
  title: string,
  items: TrackErrorStatsItem[],
  unit: string,
) {
  if (!items || items.length === 0) return;

  const fusionAvg = avgField(items, (it) => it.fusionAvg);
  const fusionRmse = avgField(items, (it) => it.fusionRmse);
  pushRow(rows, `${title}（融合均值）`, formatNum(fusionAvg, 2, unit));
  pushRow(rows, `${title}（融合 RMSE）`, formatNum(fusionRmse, 2, unit));

  const sourceAgg = new Map<string, { label: string; values: number[] }>();
  for (const it of items) {
    for (const s of it.sourceErrors ?? []) {
      if (s.avg == null || Number.isNaN(s.avg)) continue;
      const key = s.key || s.label;
      if (!key) continue;
      let entry = sourceAgg.get(key);
      if (!entry) {
        entry = { label: s.label || s.key, values: [] };
        sourceAgg.set(key, entry);
      }
      entry.values.push(s.avg);
    }
  }
  // 兼容无 sourceErrors 的旧数据
  if (sourceAgg.size === 0) {
    const r1 = avgField(items, (it) => it.radar1Avg);
    const r2 = avgField(items, (it) => it.radar2Avg);
    const r1Name = items.find((it) => it.radar1Name)?.radar1Name || "源1";
    const r2Name = items.find((it) => it.radar2Name)?.radar2Name || "源2";
    pushRow(rows, `${title}（${r1Name}均值）`, formatNum(r1, 2, unit));
    pushRow(rows, `${title}（${r2Name}均值）`, formatNum(r2, 2, unit));
  } else {
    for (const entry of sourceAgg.values()) {
      pushRow(
        rows,
        `${title}（${entry.label}均值）`,
        formatNum(avgOf(entry.values), 2, unit),
      );
    }
  }
}

function isSectionEmpty(sec: ReportSection): boolean {
  if (sec.status === "placeholder") return true;
  const meaningful = sec.blocks.filter((b) => {
    if (b.type === "heading") return false;
    if (b.type === "placeholder") return false;
    if (b.type === "table") return b.rows.length > 0;
    if (b.type === "kv") return b.items.length > 0;
    if (b.type === "chart") {
      const data = b.data as {
        stages?: unknown[];
        items?: Array<{ value: number | null }>;
      } | null;
      if (b.chartType === "perf-stage-bars") return (data?.stages?.length ?? 0) > 0;
      if (b.chartType === "track-metric-summary") {
        return (data?.items ?? []).some((x) => x.value != null);
      }
      if (b.chartType === "placeholder") return false;
      return data != null;
    }
    if (b.type === "note" || b.type === "paragraph") return Boolean(b.text?.trim());
    return true;
  });
  return meaningful.length === 0;
}

export function buildSystemPerfSection(input: {
  stats: SystemResponseTimeStats | null;
  error: string | null;
  fetchedAt?: string;
  /** 航迹链路评估结果（可选） */
  trackLinkResults?: TrackLinkTypeResult[] | null;
  trackLinkError?: string | null;
  trackLinkDurationSec?: number | null;
}): ReportSection {
  const hasAlarmStats = Boolean(input.stats);
  const trackLinkRows = input.trackLinkResults ?? [];
  const hasTrackLink = trackLinkRows.length > 0;

  if (input.error && !hasAlarmStats && !hasTrackLink) {
    return {
      id: "system",
      title: "系统评估",
      status: "error",
      errorMessage: input.error,
      blocks: [
        { type: "heading", level: 2, text: "系统评估" },
        { type: "note", text: `评估失败：${input.error}` },
      ],
    };
  }

  const stats = input.stats;
  const blocks: ReportBlock[] = [
    { type: "heading", level: 2, text: "系统评估" },
  ];

  // —— 告警端到端 ——
  blocks.push({ type: "heading", level: 3, text: "端到端响应耗时（告警链路）" });
  if (!stats) {
    blocks.push({
      type: "note",
      text: input.error?.trim() || "暂无系统性能数据",
    });
  } else {
    const stageRows = PERF_STAGE_LABELS.map((s) => ({
      label: s.label,
      ms: Number(stats[s.key] ?? 0),
      count: Number(stats[s.countKey] ?? 0),
    })).filter((r) => r.ms > 0 || r.count > 0);

    const totalMs = stageRows.reduce((sum, s) => sum + s.ms, 0);

    const kvItems: Array<{ label: string; value: string }> = [];
    if ((stats.fetched_record_count ?? 0) > 0) {
      kvItems.push({ label: "读取记录数", value: String(stats.fetched_record_count) });
    }
    if (stageRows.length > 0) {
      kvItems.push({ label: "五段耗时合计（均值）", value: formatMs(totalMs) });
    }
    if (input.fetchedAt) {
      kvItems.push({
        label: "数据时间",
        value: new Date(input.fetchedAt).toLocaleString(),
      });
    }

    blocks.push({
      type: "paragraph",
      text: "端到端响应耗时（告警链路各阶段均值）。",
    });
    if (kvItems.length > 0) {
      blocks.push({ type: "kv", items: kvItems });
    }
    if (stageRows.length > 0) {
      blocks.push({
        type: "table",
        headers: ["阶段", "平均耗时", "样本数"],
        rows: stageRows.map((r) => [r.label, formatMs(r.ms), String(r.count)]),
      });
      blocks.push({
        type: "chart",
        id: "system-perf-stage-bars",
        title: "告警链路阶段耗时对比",
        chartType: "perf-stage-bars",
        data: { stages: stageRows, totalMs },
      });
    } else {
      blocks.push({ type: "note", text: "暂无有效告警阶段样本" });
    }
    if (input.error) {
      blocks.push({ type: "note", text: `告警链路附注：${input.error}` });
    }
  }

  // —— 航迹链路 ——
  blocks.push({ type: "heading", level: 3, text: "航迹链路评估" });
  blocks.push({
    type: "paragraph",
    text:
      "旁路采样 gRPC 航迹各段时延与更新频率。「创建→接收」可能含观测时戳滞后（对海融合可达数十秒级），以中位数为准；「接收→发送」「发送→后端」更接近近端链路时延。",
  });

  if (input.trackLinkDurationSec != null && input.trackLinkDurationSec > 0) {
    blocks.push({
      type: "kv",
      items: [{ label: "采集时长", value: `${input.trackLinkDurationSec} 秒` }],
    });
  }

  if (input.trackLinkError?.trim() && !hasTrackLink) {
    blocks.push({ type: "note", text: `航迹链路评估失败：${input.trackLinkError}` });
  } else if (!hasTrackLink) {
    blocks.push({
      type: "note",
      text: "暂无航迹链路评估结果（生成报告时将自动采集约 30 秒，或先在系统评估页点击「开始评估」）",
    });
  } else {
    if (input.trackLinkError?.trim()) {
      blocks.push({ type: "note", text: `航迹链路附注：${input.trackLinkError}` });
    }

    const summaryRows: string[][] = [];
    for (const row of trackLinkRows) {
      summaryRows.push([
        row.label || row.track_layer_key,
        String(row.sampled_track_count ?? 0),
        String(row.total_updates ?? 0),
        row.update_frequency_hz != null
          ? `${Number(row.update_frequency_hz).toFixed(3)} Hz`
          : "—",
      ]);
    }
    blocks.push({
      type: "table",
      headers: ["航迹类型", "采样航迹", "更新次数", "更新频率"],
      rows: summaryRows,
    });

    const freqChartItems: TrackChartItem[] = trackLinkRows
      .filter((r) => r.update_frequency_hz != null && Number.isFinite(r.update_frequency_hz))
      .map((r) => ({
        label: r.label || r.track_layer_key,
        value: Number(r.update_frequency_hz),
        format: "number" as const,
        unit: " Hz",
        digits: 3,
      }));
    if (freqChartItems.length > 0) {
      blocks.push({
        type: "chart",
        id: "track-link-update-freq",
        title: "各类型航迹更新频率",
        chartType: "track-metric-summary",
        data: { items: freqChartItems },
      });
    }

    for (const row of trackLinkRows) {
      const typeLabel = row.label || row.track_layer_key;
      const segRows: string[][] = [];
      const stageBars: Array<{ label: string; ms: number; count: number }> = [];
      for (const s of TRACK_LINK_SEGMENT_LABELS) {
        const seg = row.segments?.[s.key];
        if (!seg || !(seg.count > 0)) continue;
        const median = seg.median_ms ?? seg.avg_ms;
        segRows.push([
          s.label,
          formatMs(median),
          formatMs(seg.avg_ms),
          formatMs(seg.min_ms),
          formatMs(seg.max_ms),
          String(seg.count),
        ]);
        // 图用中位数；创建→接收可能很大，仍如实画出
        if (median != null && Number.isFinite(median) && median >= 0) {
          stageBars.push({
            label: s.label,
            ms: Number(median),
            count: Number(seg.count),
          });
        }
      }
      if (segRows.length === 0) continue;
      blocks.push({
        type: "heading",
        level: 3,
        text: `${typeLabel} · 链路段时延`,
      });
      blocks.push({
        type: "table",
        headers: ["链路段", "中位", "avg", "min", "max", "n"],
        rows: segRows,
      });
      if (stageBars.length > 0) {
        const totalMs = stageBars
          .filter((x) => x.label !== "创建 → 后端（合计）")
          .reduce((a, b) => a + b.ms, 0);
        blocks.push({
          type: "chart",
          id: `track-link-seg-${row.track_layer_key}`,
          title: `${typeLabel} · 链路段中位时延`,
          chartType: "perf-stage-bars",
          data: { stages: stageBars, totalMs },
        });
      }
    }

    // 近端链路对比图：接收→发送 / 发送→后端 中位数
    const nearLinkItems: TrackChartItem[] = [];
    for (const row of trackLinkRows) {
      const typeLabel = row.label || row.track_layer_key;
      const r2s = row.segments?.recv_to_send;
      const s2b = row.segments?.send_to_backend;
      const r2sMed = r2s?.median_ms ?? r2s?.avg_ms;
      const s2bMed = s2b?.median_ms ?? s2b?.avg_ms;
      if (r2sMed != null && Number.isFinite(r2sMed) && (r2s?.count ?? 0) > 0) {
        nearLinkItems.push({
          label: `${typeLabel} 接收→发送`,
          value: Number(r2sMed),
          format: "number",
          unit: " ms",
          digits: 1,
        });
      }
      if (s2bMed != null && Number.isFinite(s2bMed) && (s2b?.count ?? 0) > 0) {
        nearLinkItems.push({
          label: `${typeLabel} 发送→后端`,
          value: Number(s2bMed),
          format: "number",
          unit: " ms",
          digits: 1,
        });
      }
    }
    if (nearLinkItems.length > 0) {
      blocks.push({
        type: "chart",
        id: "track-link-near-hop",
        title: "近端链路中位时延（接收→发送 / 发送→后端）",
        chartType: "track-metric-summary",
        data: { items: nearLinkItems },
      });
    }
  }

  const ok = hasAlarmStats || hasTrackLink;
  return {
    id: "system",
    title: "系统评估",
    status: ok ? "ok" : "error",
    errorMessage: ok ? undefined : "暂无系统评估数据",
    blocks,
  };
}

export function buildTrackEvalSection(input: {
  metrics: TrackEvalMetricsResult | null;
  error: string | null;
  trackPointCount: number;
  startTime: string;
  endTime: string;
  sensorLabels: string[];
}): ReportSection {
  if (input.error && !input.metrics) {
    return {
      id: "track",
      title: "航迹评估",
      status: "error",
      errorMessage: input.error,
      blocks: [
        { type: "heading", level: 2, text: "航迹评估" },
        { type: "note", text: `评估失败：${input.error}` },
      ],
    };
  }

  const m = input.metrics;
  if (!m) {
    return {
      id: "track",
      title: "航迹评估",
      status: "error",
      errorMessage: "暂无航迹质量指标",
      blocks: [
        { type: "heading", level: 2, text: "航迹评估" },
        { type: "note", text: "暂无航迹质量指标" },
      ],
    };
  }

  const birdAcc = avgOf(m.birdTrackAccuracy.map((x) => x.accuracy));
  const kuAcc = avgOf(m.kuRadarAccuracy.map((x) => x.accuracy));
  const birdRecall = avgOf(m.birdTrackRecall.map((x) => x.recall));
  const kuRecall = avgOf(m.kuRadarRecall.map((x) => x.recall));
  const birdFa = avgOf(m.birdTrackFalseAlarm.map((x) => x.falseAlarm));
  const kuFa = avgOf(m.kuRadarFalseAlarm.map((x) => x.falseAlarm));

  const qualityRows: Array<{ label: string; value: string }> = [];
  pushRow(qualityRows, "14s 对空准确率（均值）", formatPct(birdAcc));
  pushRow(qualityRows, "KU 雷达准确率（均值）", formatPct(kuAcc));
  pushRow(qualityRows, "14s 对空召回率（均值）", formatPct(birdRecall));
  pushRow(qualityRows, "KU 雷达召回率（均值）", formatPct(kuRecall));
  pushRow(qualityRows, "14s 对空虚警率（均值）", formatPct(birdFa));
  pushRow(qualityRows, "KU 雷达虚警率（均值）", formatPct(kuFa));
  pushRow(qualityRows, "对海融合航迹稳定性", formatPct(m.seaFusionTrackCoverageAvg));
  pushRow(qualityRows, "对空融合航迹稳定性", formatPct(m.airFusionTrackCoverageAvg));
  pushRow(qualityRows, "对海跟踪稳定性（航迹点）", formatPct(m.seaFusionStabilityAvg));
  pushRow(qualityRows, "对空跟踪稳定性（航迹点）", formatPct(m.airFusionStabilityAvg));
  pushRow(qualityRows, "对海跟踪稳定性（时长）", formatPct(m.seaFusionStabilityDurationAvg));
  pushRow(qualityRows, "对空跟踪稳定性（时长）", formatPct(m.airFusionStabilityDurationAvg));
  pushRow(qualityRows, "对海最大跟踪时长（均值）", formatPct(m.seaMaxTrackingDurationAvg));
  pushRow(qualityRows, "对空最大跟踪时长（均值）", formatPct(m.airMaxTrackingDurationAvg));
  pushRow(qualityRows, "对海断批次数（均值）", formatNum(m.seaBreakCountAvg, 2));
  pushRow(qualityRows, "对空断批次数（均值）", formatNum(m.airBreakCountAvg, 2));
  pushRow(qualityRows, "对海换批次数（均值）", formatNum(m.seaChangeBatchCountAvg, 2));
  pushRow(qualityRows, "对空换批次数（均值）", formatNum(m.airChangeBatchCountAvg, 2));

  const errorRows: Array<{ label: string; value: string }> = [];
  pushErrorMetricRows(errorRows, "对海距离误差", m.seaDistanceError, " m");
  pushErrorMetricRows(errorRows, "对空距离误差", m.airDistanceError, " m");
  pushErrorMetricRows(errorRows, "对海高度误差", m.seaHeightError, " m");
  pushErrorMetricRows(errorRows, "对空高度误差", m.airHeightError, " m");
  pushErrorMetricRows(errorRows, "对海方位角误差", m.seaAzimuthError, "°");
  pushErrorMetricRows(errorRows, "对空方位角误差", m.airAzimuthError, "°");
  pushErrorMetricRows(errorRows, "对海俯仰角误差", m.seaElevationError, "°");
  pushErrorMetricRows(errorRows, "对空俯仰角误差", m.airElevationError, "°");
  pushErrorMetricRows(errorRows, "对海航向误差", m.seaCourseError, "°");
  pushErrorMetricRows(errorRows, "对空航向误差", m.airCourseError, "°");
  pushErrorMetricRows(errorRows, "对海航速误差", m.seaSpeedError, " m/s");
  pushErrorMetricRows(errorRows, "对空航速误差", m.airSpeedError, " m/s");

  const kvItems: Array<{ label: string; value: string }> = [];
  if (input.startTime || input.endTime) {
    kvItems.push({
      label: "时间范围",
      value: `${input.startTime || "—"} ~ ${input.endTime || "—"}`,
    });
  }
  if (input.sensorLabels.length > 0) {
    kvItems.push({ label: "传感器", value: input.sensorLabels.join("、") });
  }
  if (input.trackPointCount > 0) {
    kvItems.push({ label: "参与航迹点数", value: String(input.trackPointCount) });
  }

  const ratioChartItems: TrackChartItem[] = [];
  pushChartItem(ratioChartItems, "对空准确率", birdAcc);
  pushChartItem(ratioChartItems, "KU 准确率", kuAcc);
  pushChartItem(ratioChartItems, "对空召回率", birdRecall);
  pushChartItem(ratioChartItems, "KU 召回率", kuRecall);
  pushChartItem(ratioChartItems, "对海融合航迹稳定性", m.seaFusionTrackCoverageAvg);
  pushChartItem(ratioChartItems, "对空融合航迹稳定性", m.airFusionTrackCoverageAvg);
  pushChartItem(ratioChartItems, "对海跟踪稳定性(点)", m.seaFusionStabilityAvg);
  pushChartItem(ratioChartItems, "对空跟踪稳定性(点)", m.airFusionStabilityAvg);
  pushChartItem(ratioChartItems, "对海跟踪稳定性(时长)", m.seaFusionStabilityDurationAvg);
  pushChartItem(ratioChartItems, "对空跟踪稳定性(时长)", m.airFusionStabilityDurationAvg);
  pushChartItem(ratioChartItems, "对海最大跟踪时长", m.seaMaxTrackingDurationAvg);
  pushChartItem(ratioChartItems, "对空最大跟踪时长", m.airMaxTrackingDurationAvg);

  const continuityChartItems: TrackChartItem[] = [];
  pushChartItem(continuityChartItems, "对海断批次数", m.seaBreakCountAvg, "count", " 次");
  pushChartItem(continuityChartItems, "对空断批次数", m.airBreakCountAvg, "count", " 次");
  pushChartItem(continuityChartItems, "对海换批次数", m.seaChangeBatchCountAvg, "count", " 次");
  pushChartItem(continuityChartItems, "对空换批次数", m.airChangeBatchCountAvg, "count", " 次");

  const errorChartItems: TrackChartItem[] = [];
  pushErrorChartItems(errorChartItems, "对海距离", m.seaDistanceError, " m");
  pushErrorChartItems(errorChartItems, "对空距离", m.airDistanceError, " m");
  pushErrorChartItems(errorChartItems, "对海高度", m.seaHeightError, " m");
  pushErrorChartItems(errorChartItems, "对空高度", m.airHeightError, " m");
  pushErrorChartItems(errorChartItems, "对海方位", m.seaAzimuthError, "°");
  pushErrorChartItems(errorChartItems, "对空方位", m.airAzimuthError, "°");
  pushErrorChartItems(errorChartItems, "对海俯仰", m.seaElevationError, "°");
  pushErrorChartItems(errorChartItems, "对空俯仰", m.airElevationError, "°");
  pushErrorChartItems(errorChartItems, "对海航向", m.seaCourseError, "°");
  pushErrorChartItems(errorChartItems, "对空航向", m.airCourseError, "°");
  pushErrorChartItems(errorChartItems, "对海航速", m.seaSpeedError, " m/s");
  pushErrorChartItems(errorChartItems, "对空航速", m.airSpeedError, " m/s");

  const blocks: ReportBlock[] = [
    { type: "heading", level: 2, text: "航迹评估" },
    {
      type: "paragraph",
      text: "基于当前用户勾选的传感器与时间范围计算的航迹质量指标摘要。融合航迹稳定性=按融合批号断段后累计/参考源时长；跟踪稳定性（时长）=有雷达连续时段累计/参考源时长（换批不断开）。",
    },
  ];

  if (kvItems.length > 0) {
    blocks.push({ type: "kv", items: kvItems });
  }

  if (qualityRows.length > 0) {
    blocks.push({ type: "heading", level: 3, text: "质量指标" });
    blocks.push({
      type: "table",
      headers: ["指标", "数值"],
      rows: qualityRows.map((r) => [r.label, r.value]),
    });
  }

  if (errorRows.length > 0) {
    blocks.push({ type: "heading", level: 3, text: "误差指标" });
    blocks.push({
      type: "paragraph",
      text: "误差 = 评估对象 − 参考源；均值 / RMSE 为各航迹 ID 上融合（及非 AIS 航迹源）统计的再平均。",
    });
    blocks.push({
      type: "table",
      headers: ["指标", "数值"],
      rows: errorRows.map((r) => [r.label, r.value]),
    });
  }

  if (ratioChartItems.length > 0) {
    blocks.push({
      type: "chart",
      id: "track-metric-summary",
      title: "关键质量指标摘要",
      chartType: "track-metric-summary",
      data: { items: ratioChartItems },
    });
  }
  if (continuityChartItems.length > 0) {
    blocks.push({
      type: "chart",
      id: "track-continuity-summary",
      title: "断批 / 换批摘要",
      chartType: "track-metric-summary",
      data: { items: continuityChartItems },
    });
  }
  if (errorChartItems.length > 0) {
    blocks.push({
      type: "chart",
      id: "track-error-summary",
      title: "误差指标摘要（融合均值/RMSE）",
      chartType: "track-metric-summary",
      data: { items: errorChartItems },
    });
  }

  if (input.error) {
    blocks.push({ type: "note", text: `附注：${input.error}` });
  }

  const hasData = qualityRows.length > 0 || errorRows.length > 0;
  return {
    id: "track",
    title: "航迹评估",
    status: hasData ? "ok" : "error",
    errorMessage: hasData ? undefined : "当前时间范围内无有效航迹质量指标",
    blocks: hasData
      ? blocks
      : [
          { type: "heading", level: 2, text: "航迹评估" },
          { type: "note", text: "当前时间范围内无有效航迹质量指标" },
        ],
  };
}

/** 光电评估：算法待改，报告中先占位（组装时若仍为 placeholder 会自动跳过） */
export function buildCameraEvalPlaceholderSection(): ReportSection {
  return {
    id: "camera",
    title: "光电评估",
    status: "placeholder",
    blocks: [
      { type: "heading", level: 2, text: "光电评估" },
      {
        type: "placeholder",
        text: "光电评估算法待调整，本节暂为占位。后续将接入清晰度 / 能见度 / 指向准确度等指标并生成图表。",
      },
      {
        type: "chart",
        id: "camera-eval-placeholder",
        title: "光电评估图表（占位）",
        chartType: "placeholder",
        data: null,
      },
    ],
  };
}

export function assembleReportDocument(input: {
  system?: ReportSection | null;
  track?: ReportSection | null;
  camera?: ReportSection | null;
  meta: ReportDocument["meta"];
}): ReportDocument {
  const sections = [input.system, input.track, input.camera].filter(
    (s): s is ReportSection => s != null && !isSectionEmpty(s),
  );
  const notes: string[] = [...(input.meta.notes ?? [])].filter((n) => {
    const t = n.trim();
    if (!t) return false;
    // 占位说明不再写入报告
    if (t.includes("占位")) return false;
    return true;
  });
  for (const sec of sections) {
    if (sec.status === "error" && sec.errorMessage) {
      notes.push(`${sec.title}：${sec.errorMessage}`);
    }
  }

  return {
    id: `eval-report-${Date.now()}`,
    title: EVAL_REPORT_TITLE,
    generatedAt: new Date().toISOString(),
    meta: {
      ...input.meta,
      author: input.meta.author?.trim() || EVAL_REPORT_AUTHOR,
      notes: notes.length > 0 ? notes : undefined,
    },
    sections: applyReportOutlineNumbering(sections),
  };
}
