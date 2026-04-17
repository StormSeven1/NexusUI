"use client";

import { useTrackStore } from "@/stores/track-store";
import { cn } from "@/lib/utils";
import {
  Crosshair,
  ExternalLink,
  Share2,
  Flag,
  MessageSquare,
  Clock,
  ShieldAlert,
  UserCheck,
  ChevronRight,
} from "lucide-react";

interface ActionPanelProps {
  trackId: string;
}

export function ActionPanel({ trackId }: ActionPanelProps) {
  const track = useTrackStore((s) => s.tracks.find((t) => t.id === trackId));
  if (!track) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-nexus-text-muted">
        未找到航迹
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* 快捷操作 */}
      <div className="border-b border-white/[0.06] p-4">
        <h4 className="mb-3 text-[10px] font-semibold tracking-widest text-nexus-text-muted">
          快捷操作
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <ActionBtn icon={Crosshair} label="锁定跟踪" desc="持续追踪目标" primary />
          <ActionBtn icon={ShieldAlert} label="威胁评估" desc="生成评估报告" />
          <ActionBtn icon={Share2} label="共享态势" desc="分发至作战群" />
          <ActionBtn icon={Flag} label="标记关注" desc="加入监视清单" />
        </div>
      </div>

      {/* 指挥操作 */}
      <div className="border-b border-white/[0.06] p-4">
        <h4 className="mb-3 text-[10px] font-semibold tracking-widest text-nexus-text-muted">
          指挥操作
        </h4>
        <div className="space-y-1.5">
          <CommandRow icon={UserCheck} label="指派力量" desc="分配作战单元处置" />
          <CommandRow icon={ExternalLink} label="创建任务" desc="生成任务工单" />
          <CommandRow icon={MessageSquare} label="下达指令" desc="向部署单元发送指令" />
        </div>
      </div>

      {/* 操作日志 */}
      <div className="p-4">
        <h4 className="mb-3 text-[10px] font-semibold tracking-widest text-nexus-text-muted">
          操作日志
        </h4>
        <div className="space-y-0">
          <LogEntry time="14:02:41" text={`${track.id} 态势更新`} />
          <LogEntry time="14:02:39" text="系统自动分类为不明目标" />
          <LogEntry time="14:01:15" text="首次探测到该目标" />
          <LogEntry time="14:00:52" text="传感器开始追踪" />
        </div>
      </div>
    </div>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  desc,
  primary,
}: {
  icon: typeof Crosshair;
  label: string;
  desc: string;
  primary?: boolean;
}) {
  return (
    <button
      className={cn(
        "flex flex-col items-start gap-1.5 rounded-md border p-3 text-left transition-colors",
        primary
          ? "border-white/[0.12] bg-white/[0.06] hover:bg-white/[0.10]"
          : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.10] hover:bg-white/[0.04]"
      )}
    >
      <Icon size={16} className={primary ? "text-nexus-text-primary" : "text-nexus-text-muted"} />
      <div>
        <div className="text-[11px] font-medium text-nexus-text-primary">{label}</div>
        <div className="text-[10px] text-nexus-text-muted">{desc}</div>
      </div>
    </button>
  );
}

function CommandRow({
  icon: Icon,
  label,
  desc,
}: {
  icon: typeof UserCheck;
  label: string;
  desc: string;
}) {
  return (
    <button className="flex w-full items-center gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:border-white/[0.10] hover:bg-white/[0.04]">
      <Icon size={14} className="shrink-0 text-nexus-text-muted" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-nexus-text-primary">{label}</div>
        <div className="text-[10px] text-nexus-text-muted">{desc}</div>
      </div>
      <ChevronRight size={12} className="shrink-0 text-nexus-text-muted" />
    </button>
  );
}

function LogEntry({ time, text }: { time: string; text: string }) {
  return (
    <div className="flex items-start gap-2.5 border-l border-white/[0.08] py-2 pl-3">
      <div className="flex items-center gap-1.5">
        <Clock size={10} className="shrink-0 text-nexus-text-muted" />
        <span className="font-mono text-[10px] text-nexus-text-muted">{time}</span>
      </div>
      <span className="text-[11px] leading-snug text-nexus-text-secondary">{text}</span>
    </div>
  );
}
