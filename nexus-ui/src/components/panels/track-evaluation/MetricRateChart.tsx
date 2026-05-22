"use client";

import { cn } from "@/lib/utils";

export interface RateChartPoint {
  id: string;
  value: number;
}

export function MetricRateChart({
  title,
  series,
  description,
}: {
  title: string;
  series: { label: string; color: string; points: RateChartPoint[] }[];
  description?: string;
}) {
  const chartWidth = 320;
  const chartHeight = 160;
  const pad = 40;

  return (
    <section className="mb-4">
      <h4 className="mb-1 text-xs font-semibold text-nexus-text-secondary">{title}</h4>
      {description ? (
        <p className="mb-2 text-[10px] leading-relaxed text-nexus-text-muted">{description}</p>
      ) : null}
      {series.every((s) => s.points.length === 0) ? (
        <p className="text-[11px] text-nexus-text-muted">暂无数据</p>
      ) : (
        series.map((s) => (
          <div key={s.label} className="mb-3">
            <div className="mb-1 text-[10px] text-nexus-text-muted">{s.label}</div>
            <div className="overflow-x-auto rounded border border-nexus-border/60 bg-nexus-bg-base/40 p-1">
              <svg width={chartWidth} height={chartHeight} className="min-w-[280px]">
                {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                  <text
                    key={v}
                    x={pad - 6}
                    y={pad + (chartHeight - pad * 2) * (1 - v) + 4}
                    textAnchor="end"
                    className="fill-zinc-500 text-[9px]"
                  >
                    {(v * 100).toFixed(0)}%
                  </text>
                ))}
                {s.points.length > 0 ? (
                  <polyline
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    points={s.points
                      .map((p, i) => {
                        const x =
                          pad +
                          ((chartWidth - pad * 2) * i) / Math.max(1, s.points.length - 1);
                        const y = pad + (chartHeight - pad * 2) * (1 - Math.min(1, p.value));
                        return `${x},${y}`;
                      })
                      .join(" ")}
                  />
                ) : null}
              </svg>
            </div>
            <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto">
              {s.points.slice(0, 12).map((p) => (
                <li
                  key={p.id}
                  className="flex justify-between font-mono text-[10px] text-nexus-text-muted"
                >
                  <span className="truncate pr-2">ID {p.id}</span>
                  <span
                    className={cn(
                      p.value >= 0.8
                        ? "text-emerald-400"
                        : p.value >= 0.6
                          ? "text-amber-400"
                          : "text-red-400",
                    )}
                  >
                    {(p.value * 100).toFixed(2)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
