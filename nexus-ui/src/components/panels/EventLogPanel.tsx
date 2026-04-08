"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  Eye,
  Radio,
  Shield,
  Plane,
} from "lucide-react";
import {
  NxPanelHeader,
  NxFilterChip,
  NxButton,
  NxStatusDot,
} from "@/components/nexus";

type EventSeverity = "critical" | "warning" | "info" | "debug";
type EventCategory = "detection" | "tracking" | "system" | "comm" | "threat";

interface LogEvent {
  id: string;
  timestamp: string;
  severity: EventSeverity;
  category: EventCategory;
  source: string;
  message: string;
}

const EVENTS: LogEvent[] = [
  { id: "ev01", timestamp: "14:02:41", severity: "critical", category: "threat", source: "系统", message: "SHARK-27 进入限制区域 ZONE-ALPHA" },
  { id: "ev02", timestamp: "14:02:40", severity: "info", category: "tracking", source: "雷达 Alpha", message: "TRK-011 (FALCON-22) 轨迹更新：航向 120°, 高度 6100ft" },
  { id: "ev03", timestamp: "14:02:39", severity: "critical", category: "detection", source: "雷达 Alpha", message: "新空中目标 SHARK-27 首次探测，自动归类为敌方" },
  { id: "ev04", timestamp: "14:02:38", severity: "info", category: "tracking", source: "Tower 6.5", message: "TRK-005 (不明人员) 移动速度下降至 1.0 mph" },
  { id: "ev05", timestamp: "14:02:37", severity: "warning", category: "threat", source: "围界系统", message: "SHADOW-15 距周界围栏 200m，触发预警" },
  { id: "ev06", timestamp: "14:02:35", severity: "info", category: "tracking", source: "AIS 海岸站", message: "VIPER-03 航向变更 315°，偏离预定航路" },
  { id: "ev07", timestamp: "14:02:30", severity: "debug", category: "system", source: "系统", message: "全局态势图刷新完成（周期 5s）" },
  { id: "ev08", timestamp: "14:02:28", severity: "info", category: "tracking", source: "AIS 海岸站", message: "TRK-012 (渔船 FV-Lucky) 航迹稳定，航向 90°" },
  { id: "ev09", timestamp: "14:02:25", severity: "debug", category: "comm", source: "通信模块", message: "数据链路心跳正常，延迟 12ms" },
  { id: "ev10", timestamp: "14:02:20", severity: "info", category: "detection", source: "雷达 Bravo", message: "TRK-004 (BLUEJAY-12) 进入观察扇区 SECTOR-3" },
  { id: "ev11", timestamp: "14:01:50", severity: "warning", category: "comm", source: "通信模块", message: "战术二组频道通信质量下降（SNR: -3dB）" },
  { id: "ev12", timestamp: "14:01:15", severity: "warning", category: "system", source: "雷达 Charlie", message: "接收机功率衰减，覆盖范围降至 60km" },
  { id: "ev13", timestamp: "14:00:52", severity: "info", category: "tracking", source: "雷达 Bravo", message: "BLUEJAY-12 IFF 应答器确认为友方" },
  { id: "ev14", timestamp: "14:00:30", severity: "info", category: "comm", source: "指挥中心", message: "EAGLE-09 报告任务完成，请求返回基地" },
  { id: "ev15", timestamp: "14:00:00", severity: "debug", category: "system", source: "系统", message: "值班交接完成：B班 → A班" },
];

const SEVERITY_CONFIG: Record<EventSeverity, { icon: typeof AlertTriangle; color: string; dotColor: string; label: string }> = {
  critical: { icon: AlertTriangle, color: "text-red-400", dotColor: "bg-red-400", label: "严重" },
  warning: { icon: AlertCircle, color: "text-amber-400", dotColor: "bg-amber-400", label: "警告" },
  info: { icon: Info, color: "text-zinc-400", dotColor: "bg-zinc-400", label: "信息" },
  debug: { icon: Eye, color: "text-nexus-text-muted", dotColor: "bg-zinc-600", label: "调试" },
};

const CATEGORY_LABELS: Record<EventCategory, string> = {
  detection: "探测",
  tracking: "追踪",
  system: "系统",
  comm: "通信",
  threat: "威胁",
};

export function EventLogPanel() {
  const [severityFilter, setSeverityFilter] = useState<EventSeverity | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<EventCategory | "all">("all");
  const [autoScroll, setAutoScroll] = useState(true);

  const filtered = EVENTS.filter((e) => {
    if (severityFilter !== "all" && e.severity !== severityFilter) return false;
    if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
    return true;
  });

  return (
    <div className="flex h-full flex-col">
      <NxPanelHeader
        title="事件日志"
        right={
          <span className="font-mono text-[10px] text-nexus-text-muted">
            {filtered.length} / {EVENTS.length}
          </span>
        }
      />

      {/* 严重程度筛选 */}
      <div className="flex flex-wrap gap-1.5 border-b border-white/[0.06] px-3 py-2">
        <NxFilterChip label="全部" active={severityFilter === "all"} onClick={() => setSeverityFilter("all")} />
        {(["critical", "warning", "info", "debug"] as EventSeverity[]).map((s) => (
          <NxFilterChip
            key={s}
            label={SEVERITY_CONFIG[s].label}
            active={severityFilter === s}
            onClick={() => setSeverityFilter(s)}
            dotColor={SEVERITY_CONFIG[s].dotColor}
          />
        ))}
      </div>

      {/* 分类筛选 */}
      <div className="flex flex-wrap gap-1.5 border-b border-white/[0.06] px-3 py-2">
        <NxFilterChip label="全部" active={categoryFilter === "all"} onClick={() => setCategoryFilter("all")} />
        {(["detection", "tracking", "system", "comm", "threat"] as EventCategory[]).map((c) => (
          <NxFilterChip key={c} label={CATEGORY_LABELS[c]} active={categoryFilter === c} onClick={() => setCategoryFilter(c)} />
        ))}
      </div>

      {/* 日志列表 */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map((event) => {
          const sev = SEVERITY_CONFIG[event.severity];
          const SevIcon = sev.icon;

          return (
            <div
              key={event.id}
              className={cn(
                "flex items-start gap-2 border-b border-white/[0.03] px-3 py-2 hover:bg-white/[0.02]",
                event.severity === "critical" && "bg-red-500/[0.03]"
              )}
            >
              <SevIcon size={12} className={cn("mt-0.5 shrink-0", sev.color)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-nexus-text-muted">{event.timestamp}</span>
                  <span className="rounded bg-white/[0.06] px-1 py-0.5 text-[9px] font-medium text-nexus-text-muted">
                    {CATEGORY_LABELS[event.category]}
                  </span>
                  <span className="text-[10px] text-nexus-text-muted">{event.source}</span>
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-nexus-text-primary">{event.message}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* 底栏 */}
      <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-1.5">
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={cn("flex items-center gap-1 text-[10px]", autoScroll ? "text-emerald-400" : "text-nexus-text-muted")}
        >
          <NxStatusDot status={autoScroll ? "online" : "neutral"} animate={autoScroll} />
          {autoScroll ? "自动滚动" : "已暂停"}
        </button>
        <NxButton variant="ghost" size="xs" onClick={() => { setSeverityFilter("all"); setCategoryFilter("all"); }}>
          重置筛选
        </NxButton>
      </div>
    </div>
  );
}
