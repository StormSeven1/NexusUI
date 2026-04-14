"use client";

import { NxCard } from "@/components/nexus";
import { BarChart3, PieChart as PieChartIcon } from "lucide-react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const CHART_COLORS = [
  "#38bdf8", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16",
];

interface ChartData {
  label: string;
  value: number;
  key?: string;
  group?: string;
}

interface ChartCardProps {
  chartType: "bar" | "pie";
  data: ChartData[];
  title: string;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: ChartData }> }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="rounded-md border border-white/10 bg-[#1a1f2e] px-3 py-2 text-[10px] shadow-lg">
      <p className="text-nexus-text-secondary">{item.payload.label}</p>
      <p className="font-semibold text-nexus-text-primary">{item.value}</p>
    </div>
  );
}

export function ChartCard({ chartType, data, title }: ChartCardProps) {
  const Icon = chartType === "pie" ? PieChartIcon : BarChart3;

  return (
    <NxCard padding="sm" className="my-1.5">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded bg-indigo-500/10">
          <Icon size={11} className="text-indigo-400" />
        </div>
        <span className="text-[10px] font-semibold tracking-wider text-nexus-text-secondary uppercase">
          {title}
        </span>
      </div>

      <div className="h-[160px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === "pie" ? (
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                outerRadius={55}
                innerRadius={25}
                paddingAngle={2}
                strokeWidth={0}
              >
                {data.map((_, idx) => (
                  <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: "10px", color: "#94a3b8" }}
                iconSize={8}
              />
            </PieChart>
          ) : (
            <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: "#94a3b8" }}
                axisLine={{ stroke: "#334155" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 9, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
              <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={32}>
                {data.map((_, idx) => (
                  <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </NxCard>
  );
}
