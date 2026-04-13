"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  CloudSun,
  Wind,
  Eye,
  Thermometer,
  Droplets,
  Compass,
  Sun,
  Moon,
  Clock,
  ShieldAlert,
  Timer,
  CloudRain,
  Gauge,
} from "lucide-react";
import {
  NxPanelHeader,
  NxSectionHeader,
  NxCard,
  NxProgress,
} from "@/components/nexus";

export function EnvironmentPanel() {
  const [missionSeconds, setMissionSeconds] = useState(37320);

  useEffect(() => {
    const timer = setInterval(() => setMissionSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex h-full flex-col">
      <NxPanelHeader title="环境态势" />

      <div className="flex-1 overflow-y-auto">
        {/* 任务时钟 */}
        <div className="border-b border-white/[0.06] p-4">
          <NxSectionHeader className="mb-3">任务时钟</NxSectionHeader>
          <div className="grid grid-cols-2 gap-2">
            <NxCard>
              <div className="flex items-center gap-1.5">
                <Clock size={10} className="text-nexus-text-muted" />
                <span className="text-[10px] text-nexus-text-muted">任务用时</span>
              </div>
              <div className="mt-1.5 font-mono text-lg font-bold tabular-nums text-nexus-text-primary">
                {formatTime(missionSeconds)}
              </div>
            </NxCard>
            <NxCard>
              <div className="flex items-center gap-1.5">
                <Timer size={10} className="text-nexus-text-muted" />
                <span className="text-[10px] text-nexus-text-muted">日落倒计时</span>
              </div>
              <div className="mt-1.5 font-mono text-lg font-bold tabular-nums text-amber-400">02:37:15</div>
            </NxCard>
            <NxCard>
              <div className="flex items-center gap-1.5">
                <Sun size={10} className="text-amber-400" />
                <span className="text-[10px] text-nexus-text-muted">日出</span>
              </div>
              <div className="mt-1 font-mono text-sm text-nexus-text-primary">05:42 UTC</div>
            </NxCard>
            <NxCard>
              <div className="flex items-center gap-1.5">
                <Moon size={10} className="text-indigo-400" />
                <span className="text-[10px] text-nexus-text-muted">日落</span>
              </div>
              <div className="mt-1 font-mono text-sm text-nexus-text-primary">19:48 UTC</div>
            </NxCard>
          </div>
        </div>

        {/* 威胁等级 */}
        <div className="border-b border-white/[0.06] p-4">
          <NxSectionHeader className="mb-3">威胁等级</NxSectionHeader>
          <div className="space-y-2">
            {[
              { level: "BRAVO", label: "综合威胁", color: "amber" as const },
              { level: "ALPHA", label: "空中威胁", color: "red" as const },
              { level: "CHARLIE", label: "地面威胁", color: "amber" as const },
              { level: "DELTA", label: "海上威胁", color: "emerald" as const },
              { level: "BRAVO", label: "电子威胁", color: "amber" as const },
            ].map((t, i) => {
              const colors = {
                red: { text: "text-red-400", bar: "bg-red-400/60", pct: 85 },
                amber: { text: "text-amber-400", bar: "bg-amber-400/60", pct: 55 },
                emerald: { text: "text-emerald-400", bar: "bg-emerald-400/60", pct: 25 },
              }[t.color];
              return (
                <div key={i} className="flex items-center gap-2 rounded-md border border-white/[0.04] bg-white/[0.02] px-2.5 py-2">
                  <ShieldAlert size={12} className={colors.text} />
                  <span className="w-16 text-[11px] text-nexus-text-secondary">{t.label}</span>
                  <div className="flex-1">
                    <NxProgress value={colors.pct} color={colors.bar} />
                  </div>
                  <span className={cn("w-14 text-right font-mono text-[10px] font-bold", colors.text)}>{t.level}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 气象条件 */}
        <div className="border-b border-white/[0.06] p-4">
          <NxSectionHeader className="mb-3">气象条件</NxSectionHeader>
          <NxCard padding="sm" className="mb-3">
            <div className="flex items-center gap-3">
              <CloudSun size={28} className="shrink-0 text-amber-400" />
              <div>
                <div className="text-sm font-semibold text-nexus-text-primary">多云转晴</div>
                <div className="text-[10px] text-nexus-text-muted">部分多云，视野良好</div>
              </div>
            </div>
          </NxCard>
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: Thermometer, label: "温度", value: "18°C" },
              { icon: Droplets, label: "湿度", value: "65%" },
              { icon: Wind, label: "风速", value: "12 kn" },
              { icon: Compass, label: "风向", value: "NW 315°" },
              { icon: Eye, label: "能见度", value: "15 km" },
              { icon: Gauge, label: "气压", value: "1013 hPa" },
            ].map((s) => (
              <div key={s.label} className="rounded-md border border-white/[0.04] bg-white/[0.02] p-2 text-center">
                <s.icon size={12} className="mx-auto text-nexus-text-muted" />
                <div className="mt-1 font-mono text-[11px] font-semibold text-nexus-text-primary">{s.value}</div>
                <div className="text-[9px] text-nexus-text-muted">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 天气预报 */}
        <div className="p-4">
          <NxSectionHeader className="mb-3">未来 6 小时预报</NxSectionHeader>
          <div className="space-y-1.5">
            {[
              { time: "+1h", icon: CloudSun, temp: "17°C", wind: "13 kn", vis: "14 km" },
              { time: "+2h", icon: CloudSun, temp: "16°C", wind: "15 kn", vis: "12 km" },
              { time: "+3h", icon: CloudRain, temp: "14°C", wind: "18 kn", vis: "8 km" },
              { time: "+4h", icon: CloudRain, temp: "13°C", wind: "20 kn", vis: "6 km" },
              { time: "+5h", icon: Moon, temp: "12°C", wind: "16 kn", vis: "10 km" },
              { time: "+6h", icon: Moon, temp: "11°C", wind: "12 kn", vis: "14 km" },
            ].map((f) => (
              <div key={f.time} className="flex items-center gap-3 rounded border border-white/[0.04] bg-white/[0.02] px-2.5 py-1.5">
                <span className="w-7 font-mono text-[10px] font-semibold text-nexus-text-muted">{f.time}</span>
                <f.icon size={14} className="shrink-0 text-nexus-text-secondary" />
                <span className="w-10 font-mono text-[10px] text-nexus-text-primary">{f.temp}</span>
                <Wind size={10} className="text-nexus-text-muted" />
                <span className="w-10 font-mono text-[10px] text-nexus-text-muted">{f.wind}</span>
                <Eye size={10} className="text-nexus-text-muted" />
                <span className="font-mono text-[10px] text-nexus-text-muted">{f.vis}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
