"use client";

import { Camera, Plane } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAssetStore } from "@/stores/asset-store";
import type { WorkflowDeviceCard } from "@/lib/langgraph-workflow-context";
import { useEoVideoDdsTaskLine } from "@/hooks/useEoVideoDdsTaskLine";

function resolveDeviceLabel(card: WorkflowDeviceCard, assets: { id: string; name: string }[]): string {
  const asset = assets.find((a) => a.id === card.id || a.id.toLowerCase() === card.id.toLowerCase());
  const name = asset?.name?.trim() || card.id;
  if (card.kind === "camera") return `相机：${name}`;
  if (card.kind === "uav") return `无人机：${name}`;
  return name;
}

function WorkflowDeviceCardItem({ device }: { device: WorkflowDeviceCard }) {
  const assets = useAssetStore((s) => s.assets);
  /** 与光电视频右下角 `taskLine` 同源（相机/无人机 DDS） */
  const taskLine = useEoVideoDdsTaskLine({
    variant: device.kind === "uav" ? "uav" : "camera",
    cameraEntityId: device.kind === "camera" ? device.id : null,
    droneEntityId: device.kind === "uav" ? device.id : null,
  });
  const Icon = device.kind === "uav" ? Plane : Camera;

  return (
    <div
      className={cn(
        "min-w-[140px] max-w-[220px] flex-1 rounded-md border border-white/[0.08] bg-[#1a2332]/90 px-2.5 py-2 shadow-sm",
      )}
    >
      <div className="flex items-start gap-1.5">
        <Icon size={12} className="mt-0.5 shrink-0 text-sky-400/90" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium leading-snug text-nexus-text-primary">
            {resolveDeviceLabel(device, assets)}
          </p>
          <p
            className={cn(
              "mt-0.5 truncate text-[10px]",
              taskLine === "空闲中" ? "text-nexus-text-muted" : "text-cyan-400/90",
            )}
            title={taskLine}
          >
            {taskLine}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * 工作流会话顶部设备条：名称来自资产表；状态与光电窗右下角 DDS 任务文案一致并实时更新。
 */
export function WorkflowDeviceStrip({ devices }: { devices: WorkflowDeviceCard[] }) {
  if (!devices.length) return null;

  return (
    <div className="shrink-0 border-b border-nexus-border/80 bg-nexus-bg-base/60 px-2.5 py-2">
      <div className="flex flex-wrap gap-2">
        {devices.map((d) => (
          <WorkflowDeviceCardItem key={`${d.kind}-${d.id}`} device={d} />
        ))}
      </div>
    </div>
  );
}
