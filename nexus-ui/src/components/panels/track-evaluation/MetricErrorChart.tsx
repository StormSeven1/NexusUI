"use client";

import { useId, useMemo } from "react";
import type { TrackErrorStatsItem } from "@/lib/track-evaluation-metrics";
import {
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  buildLinearYAxisLabels,
  chartX,
  chartY,
} from "@/components/panels/track-evaluation/track-eval-chart-utils";

const SERIES_COLORS = ["#3b82f6", "#f59e0b", "#22c55e", "#a855f7", "#ef4444", "#06b6d4", "#eab308"];

type SeriesDef = { key: string; label: string; color: string; dash?: string };

function buildSeries(items: TrackErrorStatsItem[]): SeriesDef[] {
  const series: SeriesDef[] = [
    { key: "fusion", label: "融合", color: SERIES_COLORS[0] },
  ];
  const seen = new Set<string>();
  for (const it of items) {
    for (const s of it.sourceErrors ?? []) {
      if (!s.key || seen.has(s.key)) continue;
      seen.add(s.key);
      const color = SERIES_COLORS[(series.length % (SERIES_COLORS.length - 1)) + 1];
      series.push({
        key: s.key,
        label: s.label || s.key,
        color,
        dash: series.length % 2 === 0 ? "5,5" : "3,3",
      });
    }
  }
  // 兼容无 sourceErrors 的旧数据
  if (series.length === 1) {
    const hasR1 = items.some((it) => it.radar1Avg != null);
    const hasR2 = items.some((it) => it.radar2Avg != null);
    if (hasR1) {
      series.push({
        key: "radar1",
        label: items.find((it) => it.radar1Name)?.radar1Name || "远遥码头",
        color: SERIES_COLORS[1],
        dash: "5,5",
      });
    }
    if (hasR2) {
      series.push({
        key: "radar2",
        label: items.find((it) => it.radar2Name)?.radar2Name || "靖子头",
        color: SERIES_COLORS[2],
        dash: "3,3",
      });
    }
  }
  return series;
}

function seriesValue(item: TrackErrorStatsItem, key: string): number | null {
  if (key === "fusion") return item.fusionAvg;
  const fromSrc = item.sourceErrors?.find((s) => s.key === key);
  if (fromSrc) return fromSrc.avg;
  if (key === "radar1") return item.radar1Avg;
  if (key === "radar2") return item.radar2Avg;
  return null;
}

function overallAvg(items: TrackErrorStatsItem[], key: string): number | null {
  const vals = items
    .map((it) => seriesValue(it, key))
    .filter((v): v is number => v != null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function MetricErrorChart({
  title,
  description,
  items,
  unit = "m",
}: {
  title: string;
  description?: string;
  items: TrackErrorStatsItem[];
  unit?: string;
}) {
  const gridId = useId().replace(/:/g, "");
  const series = useMemo(() => buildSeries(items), [items]);

  const { min, max } = useMemo(() => {
    const vals: number[] = [];
    for (const it of items) {
      for (const s of series) {
        const v = seriesValue(it, s.key);
        if (v != null) vals.push(v);
      }
    }
    if (vals.length === 0) return { min: 0, max: 1 };
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.05 || 1;
    return { min: lo - pad, max: hi + pad };
  }, [items, series]);

  const yLabels = buildLinearYAxisLabels(min, max, 4);
  const fmt = (v: number) => `${v.toFixed(0)}${unit}`;

  const buildLine = (key: string) =>
    items
      .map((it, i) => {
        const v = seriesValue(it, key);
        if (v == null) return null;
        return `${chartX(i, items.length)},${chartY(v, min, max)}`;
      })
      .filter(Boolean)
      .join(" ");

  if (items.length === 0) {
    return (
      <section className="mb-5">
        <h4 className="mb-2 border-b border-sky-500/40 pb-1.5 text-[13px] font-semibold text-nexus-text-primary">
          {title}
        </h4>
        <p className="py-6 text-center text-[12px] text-nexus-text-muted">暂无数据</p>
      </section>
    );
  }

  return (
    <section className="mb-5">
      <h4 className="mb-2 border-b border-sky-500/40 pb-1.5 text-[13px] font-semibold text-nexus-text-primary">
        {title}
      </h4>
      {description ? (
        <p className="mb-3 rounded-md border-l-2 border-sky-500/60 bg-nexus-bg-base/50 px-3 py-2 text-[11px] leading-relaxed text-nexus-text-muted">
          {description}
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-3 rounded-md border border-nexus-border/50 bg-nexus-bg-base/30 px-3 py-2">
        {series.map((s) => {
          const avg = overallAvg(items, s.key);
          return (
            <div key={s.key} className="text-[11px]">
              <span className="font-medium text-nexus-text-secondary">{s.label}</span>
              <span className="ml-1.5 tabular-nums text-nexus-text-muted">
                平均 {avg != null ? avg.toFixed(2) : "--"}
                {unit}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mb-1 overflow-x-auto rounded-md border border-nexus-border/70 bg-nexus-bg-surface/60 p-2">
        <svg width={CHART_WIDTH} height={CHART_HEIGHT} className="min-w-[320px]">
          <defs>
            <pattern id={`err-grid-${gridId}`} width="32" height="32" patternUnits="userSpaceOnUse">
              <path
                d="M 32 0 L 0 0 0 32"
                fill="none"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect
            x={CHART_PADDING}
            y={CHART_PADDING}
            width={CHART_WIDTH - CHART_PADDING * 2}
            height={CHART_HEIGHT - CHART_PADDING * 2}
            fill={`url(#err-grid-${gridId})`}
          />
          {yLabels.map((label) => (
            <text
              key={label.ratio}
              x={CHART_PADDING - 6}
              y={chartY(label.value, min, max) + 3}
              textAnchor="end"
              className="fill-nexus-text-muted"
              style={{ fontSize: 9 }}
            >
              {fmt(label.value)}
            </text>
          ))}
          {series.map((s) => {
            const pts = buildLine(s.key);
            if (!pts) return null;
            return (
              <polyline
                key={s.key}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dash}
                points={pts}
              />
            );
          })}
          {items.map((it, i) => (
            <text
              key={it.id}
              x={chartX(i, items.length)}
              y={CHART_HEIGHT - 8}
              textAnchor="middle"
              className="fill-nexus-text-muted"
              style={{ fontSize: 8 }}
            >
              {String(it.id).length > 8 ? `${String(it.id).slice(0, 6)}…` : it.id}
            </text>
          ))}
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-nexus-text-muted">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-0.5 w-4"
              style={{
                backgroundColor: s.color,
                borderTop: s.dash ? `1px dashed ${s.color}` : undefined,
              }}
            />
            {s.label}
          </span>
        ))}
      </div>

      <div className="mt-2 overflow-x-auto rounded border border-nexus-border/50">
        <table className="w-full min-w-[360px] border-collapse text-[10px]">
          <thead>
            <tr className="bg-nexus-bg-elevated/60 text-nexus-text-muted">
              <th className="px-2 py-1 text-left">参考 ID</th>
              {series.map((s) => (
                <th key={s.key} className="px-2 py-1 text-right">
                  {s.label}均值
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="odd:bg-nexus-bg-base/20">
                <td className="px-2 py-1 font-mono text-nexus-text-primary">{it.id}</td>
                {series.map((s) => {
                  const v = seriesValue(it, s.key);
                  return (
                    <td key={s.key} className="px-2 py-1 text-right font-mono text-nexus-text-secondary">
                      {v != null ? v.toFixed(2) : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
