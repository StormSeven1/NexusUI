"use client";

import {
  Cpu,
  HardDrive,
  Wifi,
  Signal,
  Eye,
  ShieldCheck,
  Activity,
  Zap,
} from "lucide-react";
import {
  NxPanelHeader,
  NxSectionHeader,
  NxGauge,
  NxStatCard,
  NxCard,
} from "@/components/nexus";

const GAUGE_DATA = [
  { label: "CPU 负载", value: 67, icon: <Cpu size={14} className="text-emerald-400" />, ring: "stroke-emerald-400" },
  { label: "内存占用", value: 43, icon: <HardDrive size={14} className="text-sky-400" />, ring: "stroke-sky-400" },
  { label: "网络吞吐", value: 82, icon: <Wifi size={14} className="text-amber-400" />, ring: "stroke-amber-400" },
  { label: "信号强度", value: 91, icon: <Signal size={14} className="text-purple-400" />, ring: "stroke-purple-400" },
];

const KPI_DATA = [
  { label: "探测目标", value: "247", trend: "up" as const, change: "+12", icon: <Eye size={12} /> },
  { label: "处置完成", value: "189", trend: "up" as const, change: "+8", icon: <ShieldCheck size={12} /> },
  { label: "活动传感器", value: "34", trend: "down" as const, change: "-2", icon: <Activity size={12} /> },
  { label: "系统可用率", value: "99.7%", trend: "flat" as const, change: "0", icon: <Zap size={12} /> },
];

const SPARKLINE_DATA = [
  { label: "航迹检测率", data: [20, 35, 28, 42, 38, 50, 45, 60, 55, 48, 62, 70], unit: "/h" },
  { label: "威胁评估", data: [5, 8, 3, 12, 7, 9, 4, 11, 6, 8, 14, 10], unit: "次" },
  { label: "通信流量", data: [120, 180, 150, 200, 170, 220, 190, 250, 210, 240, 260, 280], unit: "KB/s" },
];

export function DashboardPanel() {
  return (
    <div className="flex h-full flex-col">
      <NxPanelHeader title="系统仪表盘" />

      <div className="flex-1 overflow-y-auto">
        {/* 环形仪表 */}
        <div className="border-b border-white/[0.06] p-4">
          <NxSectionHeader className="mb-3">资源监控</NxSectionHeader>
          <div className="grid grid-cols-2 gap-3">
            {GAUGE_DATA.map((g) => (
              <NxGauge key={g.label} value={g.value} label={g.label} icon={g.icon} ringColor={g.ring} />
            ))}
          </div>
        </div>

        {/* KPI 卡片 */}
        <div className="border-b border-white/[0.06] p-4">
          <NxSectionHeader className="mb-3">关键指标</NxSectionHeader>
          <div className="grid grid-cols-2 gap-2">
            {KPI_DATA.map((kpi) => (
              <NxStatCard key={kpi.label} {...kpi} />
            ))}
          </div>
        </div>

        {/* 趋势迷你图 */}
        <div className="p-4">
          <NxSectionHeader className="mb-3">实时趋势</NxSectionHeader>
          <div className="space-y-3">
            {SPARKLINE_DATA.map((s) => (
              <SparklineCard key={s.label} {...s} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SparklineCard({ label, data, unit }: (typeof SPARKLINE_DATA)[number]) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const h = 32;
  const w = 200;
  const step = w / (data.length - 1);

  const points = data.map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 4) - 2}`).join(" ");
  const current = data[data.length - 1];

  return (
    <NxCard padding="sm">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[11px] text-nexus-text-secondary">{label}</span>
        <span className="font-mono text-xs font-semibold text-nexus-text-primary">
          {current} <span className="text-nexus-text-muted">{unit}</span>
        </span>
      </div>
      <div className="mt-2 overflow-hidden">
        <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255,255,255,0.08)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
          </defs>
          <polygon points={`0,${h} ${points} ${w},${h}`} fill={`url(#grad-${label})`} />
          <polyline points={points} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx={(data.length - 1) * step} cy={h - ((current - min) / range) * (h - 4) - 2} r="2.5" fill="rgba(255,255,255,0.6)" />
        </svg>
      </div>
    </NxCard>
  );
}
