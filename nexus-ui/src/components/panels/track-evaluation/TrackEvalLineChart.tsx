"use client";

import { useId } from "react";
import {
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  buildLinearYAxisLabels,
  chartX,
  chartY,
} from "@/components/panels/track-evaluation/track-eval-chart-utils";

export interface LineChartPoint {
  id: string;
  value: number;
}

export function TrackEvalLineChart({
  title,
  description,
  points,
  color = "#3b82f6",
  yMin,
  yMax,
  formatY,
  formatValue,
  emptyLabel = "暂无数据",
}: {
  title: string;
  description?: string;
  points: LineChartPoint[];
  color?: string;
  yMin?: number;
  yMax?: number;
  formatY?: (v: number) => string;
  formatValue?: (v: number) => string;
  emptyLabel?: string;
}) {
  const gridId = useId().replace(/:/g, "");
  const values = points.map((p) => p.value);
  const autoMax = values.length > 0 ? Math.max(...values, 0) : 1;
  const min = yMin ?? 0;
  const max =
    yMax ??
    (yMin === undefined && yMax === undefined && autoMax <= 1 ? 1 : Math.max(autoMax, 1));
  const yLabels = buildLinearYAxisLabels(min, max, 4);
  const fmtY = formatY ?? ((v: number) => (max <= 1 ? `${(v * 100).toFixed(0)}%` : v.toFixed(0)));
  const fmtVal = formatValue ?? fmtY;

  const linePoints = points
    .map((p, i) => `${chartX(i, points.length)},${chartY(p.value, min, max)}`)
    .join(" ");

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
      {points.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-nexus-text-muted">{emptyLabel}</p>
      ) : (
        <>
          <div className="mb-1 overflow-x-auto rounded-md border border-nexus-border/70 bg-nexus-bg-surface/60 p-2">
            <svg width={CHART_WIDTH} height={CHART_HEIGHT} className="min-w-[320px]">
              <defs>
                <pattern
                  id={`grid-${gridId}`}
                  width="32"
                  height="32"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 32 0 L 0 0 0 32"
                    fill="none"
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth="1"
                  />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill={`url(#grid-${gridId})`} />

              {yLabels.map((label) => (
                <text
                  key={label.ratio}
                  x={CHART_PADDING - 8}
                  y={chartY(label.value, min, max) + 4}
                  textAnchor="end"
                  className="fill-zinc-400 text-[10px]"
                >
                  {fmtY(label.value)}
                </text>
              ))}

              {points.map((p, i) => {
                const x = chartX(i, points.length);
                return (
                  <text
                    key={`x-${p.id}-${i}`}
                    x={x}
                    y={CHART_HEIGHT - 6}
                    textAnchor="end"
                    transform={`rotate(-40, ${x}, ${CHART_HEIGHT - 6})`}
                    className="fill-zinc-500 text-[9px]"
                  >
                    {p.id}
                  </text>
                );
              })}

              {points.length > 1 ? (
                <polyline
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  points={linePoints}
                  className="drop-shadow-sm"
                />
              ) : null}

              {points.map((p, i) => (
                <circle
                  key={`pt-${p.id}-${i}`}
                  cx={chartX(i, points.length)}
                  cy={chartY(p.value, min, max)}
                  r={4}
                  fill={color}
                />
              ))}
            </svg>
          </div>

          <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto">
            {points.map((p) => (
              <li
                key={p.id}
                className="rounded-md border border-nexus-border/60 bg-nexus-bg-base/40 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12px] font-medium text-nexus-text-secondary">
                    ID {p.id}
                  </span>
                  <span
                    className="shrink-0 rounded px-2 py-0.5 text-[12px] font-semibold tabular-nums"
                    style={{ color }}
                  >
                    {fmtVal(p.value)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
