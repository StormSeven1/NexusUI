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

const SERIES = [
  { key: "fusion" as const, label: "融合", color: "#3b82f6", dash: undefined },
  { key: "radar1" as const, label: "远遥码头", color: "#f59e0b", dash: "5,5" },
  { key: "radar2" as const, label: "靖子头", color: "#22c55e", dash: "3,3" },
];

function seriesValue(item: TrackErrorStatsItem, key: (typeof SERIES)[number]["key"]): number | null {
  if (key === "fusion") return item.fusionAvg;
  if (key === "radar1") return item.radar1Avg;
  return item.radar2Avg;
}

function overallAvg(items: TrackErrorStatsItem[], key: (typeof SERIES)[number]["key"]): number | null {
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

  const { min, max } = useMemo(() => {
    const vals: number[] = [];
    for (const it of items) {
      for (const s of SERIES) {
        const v = seriesValue(it, s.key);
        if (v != null) vals.push(v);
      }
    }
    if (vals.length === 0) return { min: 0, max: 1 };
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.05 || 1;
    return { min: lo - pad, max: hi + pad };
  }, [items]);

  const yLabels = buildLinearYAxisLabels(min, max, 4);
  const fmt = (v: number) => `${v.toFixed(0)}${unit}`;

  const buildLine = (key: (typeof SERIES)[number]["key"]) =>
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
        {SERIES.map((s) => {
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
          <rect width="100%" height="100%" fill={`url(#err-grid-${gridId})`} />

          {yLabels.map((label) => (
            <text
              key={label.ratio}
              x={CHART_PADDING - 8}
              y={chartY(label.value, min, max) + 4}
              textAnchor="end"
              className="fill-zinc-400 text-[10px]"
            >
              {fmt(label.value)}
            </text>
          ))}

          {items.map((it, i) => {
            const x = chartX(i, items.length);
            return (
              <text
                key={`x-${it.id}`}
                x={x}
                y={CHART_HEIGHT - 6}
                textAnchor="end"
                transform={`rotate(-40, ${x}, ${CHART_HEIGHT - 6})`}
                className="fill-zinc-500 text-[9px]"
              >
                {it.id}
              </text>
            );
          })}

          {SERIES.map((s) => {
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

          {SERIES.flatMap((s) =>
            items.map((it, i) => {
              const v = seriesValue(it, s.key);
              if (v == null) return null;
              return (
                <circle
                  key={`${s.key}-${it.id}`}
                  cx={chartX(i, items.length)}
                  cy={chartY(v, min, max)}
                  r={3.5}
                  fill={s.color}
                />
              );
            }),
          )}

          <g transform={`translate(${CHART_PADDING}, 12)`}>
            {SERIES.map((s, idx) => (
              <g key={s.key} transform={`translate(${idx * 88}, 0)`}>
                <line
                  x1={0}
                  y1={0}
                  x2={24}
                  y2={0}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray={s.dash}
                />
                <text x={28} y={4} className="fill-zinc-400 text-[9px]">
                  {s.label}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>

      <ul className="mt-3 max-h-52 space-y-2 overflow-y-auto">
        {items.map((it) => (
          <li
            key={it.id}
            className="rounded-md border border-nexus-border/60 bg-nexus-bg-base/40 px-3 py-2 text-[11px]"
          >
            <div className="mb-1.5 font-medium text-nexus-text-secondary">ID {it.id}</div>
            <div className="grid gap-1 sm:grid-cols-3">
              {SERIES.map((s) => {
                const avg = seriesValue(it, s.key);
                const rmse =
                  s.key === "fusion"
                    ? it.fusionRmse
                    : s.key === "radar1"
                      ? it.radar1Rmse
                      : it.radar2Rmse;
                if (avg == null && rmse == null) return null;
                return (
                  <div key={s.key} className="text-nexus-text-muted">
                    <span style={{ color: s.color }}>{s.label}</span>
                    {" · "}
                    avg {avg != null ? avg.toFixed(2) : "--"}
                    {unit} / rmse {rmse != null ? rmse.toFixed(2) : "--"}
                    {unit}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
