"use client";

import type { DockPartition } from "@/components/dock/types";
import type { DockGuideZone, PartitionSnapTarget, SidebarSnapLayout } from "@/lib/dock/dockGuideLayout";
import { getPartitionViewportRect } from "@/lib/dock/dockGuideLayout";

interface DockPartitionDropPreviewProps {
  target: PartitionSnapTarget;
  partitions: DockPartition[];
  layout: SidebarSnapLayout;
  activeZone: DockGuideZone | null;
}

/** 停靠预览：中区高亮已有分区，上/下显示将新建的分区条 */
export function DockPartitionDropPreview({
  target,
  partitions,
  layout,
  activeZone,
}: DockPartitionDropPreviewProps) {
  if (!target.side || !target.partitionId || !activeZone) return null;

  const partitionIndex = partitions.findIndex((p) => p.id === target.partitionId);
  if (partitionIndex < 0) return null;

  if (activeZone === "middle") {
    const rect = getPartitionViewportRect(partitionIndex, partitions, layout);
    return (
      <div
        className="pointer-events-none fixed z-[9998] rounded-md border-2 border-cyan-400/80 bg-cyan-400/10"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        }}
      />
    );
  }

  const newHeightRatio = 1 / (partitions.length + 1);
  const compressionFactor = 1 - newHeightRatio;
  const newPartitionHeight = newHeightRatio * layout.containerHeight;

  let previewTop = layout.containerTop;
  const targetIdx = partitionIndex;

  if (activeZone === "top") {
    for (let i = 0; i < targetIdx; i++) {
      previewTop += partitions[i].heightRatio * compressionFactor * layout.containerHeight;
    }
  } else {
    for (let i = 0; i <= targetIdx; i++) {
      previewTop += partitions[i].heightRatio * compressionFactor * layout.containerHeight;
    }
  }

  return (
    <div
      className="pointer-events-none fixed z-[9998] rounded-md border border-solid border-cyan-400/60 bg-cyan-400/10"
      style={{
        top: previewTop,
        left: layout.contentLeft,
        width: Math.max(layout.contentWidth, 120),
        height: newPartitionHeight,
      }}
    />
  );
}
