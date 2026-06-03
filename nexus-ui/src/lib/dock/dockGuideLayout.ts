import type { DockPartition } from "@/components/dock/types";

/** 顶栏 / 底栏高度（与 AppShell TopNav h-12、StatusBar h-8 一致） */
export const DOCK_LAYOUT_TOP_NAV = 48;
export const DOCK_LAYOUT_STATUS_BAR = 32;
/** 侧边栏图标竖条宽度 w-12 */
export const DOCK_LAYOUT_ICON_STRIP = 48;

export type DockGuideZone = "top" | "middle" | "bottom";

export interface PartitionSnapTarget {
  partitionId: string | null;
  edgePosition: DockGuideZone | null;
  insertIndex: number | null;
  side: "left" | "right" | null;
  willCreatePartition: boolean;
}

export interface SidebarSnapLayout {
  side: "left" | "right";
  contentLeft: number;
  contentWidth: number;
  containerTop: number;
  containerHeight: number;
}

/** 侧边栏内容区（不含图标竖条）在视口中的几何信息 */
export function getSidebarSnapLayout(
  side: "left" | "right",
  opts: {
    leftSidebarOpen: boolean;
    leftSidebarWidth: number;
    rightSidebarOpen: boolean;
    rightSidebarWidth: number;
  },
): SidebarSnapLayout {
  const containerTop = DOCK_LAYOUT_TOP_NAV;
  const containerHeight =
    window.innerHeight - DOCK_LAYOUT_TOP_NAV - DOCK_LAYOUT_STATUS_BAR;

  if (side === "left") {
    const totalW = opts.leftSidebarOpen ? opts.leftSidebarWidth : DOCK_LAYOUT_ICON_STRIP;
    const contentWidth = Math.max(0, totalW - DOCK_LAYOUT_ICON_STRIP);
    return {
      side: "left",
      contentLeft: DOCK_LAYOUT_ICON_STRIP,
      contentWidth,
      containerTop,
      containerHeight,
    };
  }

  const totalW = opts.rightSidebarOpen ? opts.rightSidebarWidth : DOCK_LAYOUT_ICON_STRIP;
  const contentWidth = Math.max(0, totalW - DOCK_LAYOUT_ICON_STRIP);
  return {
    side: "right",
    contentLeft: window.innerWidth - totalW + DOCK_LAYOUT_ICON_STRIP,
    contentWidth,
    containerTop,
    containerHeight,
  };
}

/** 鼠标是否靠近可停靠的侧边栏 */
export function detectNearDockSide(
  clientX: number,
  threshold: number,
  opts: {
    leftSidebarOpen: boolean;
    leftSidebarWidth: number;
    rightSidebarOpen: boolean;
    rightSidebarWidth: number;
  },
): "left" | "right" | null {
  const leftEdge = opts.leftSidebarOpen
    ? opts.leftSidebarWidth
    : DOCK_LAYOUT_ICON_STRIP;
  const rightEdge = opts.rightSidebarOpen
    ? opts.rightSidebarWidth
    : DOCK_LAYOUT_ICON_STRIP;

  if (clientX < leftEdge + threshold) return "left";
  if (clientX > window.innerWidth - rightEdge - threshold) return "right";
  return null;
}

/** 根据 Y 坐标命中分区（相对侧边栏内容区顶部） */
export function findPartitionAtRelativeY(
  relativeY: number,
  partitions: DockPartition[],
  containerHeight: number,
): { partition: DockPartition; index: number } | null {
  if (partitions.length === 0 || containerHeight <= 0) return null;

  let accumulated = 0;
  for (let i = 0; i < partitions.length; i++) {
    const partition = partitions[i];
    const top = accumulated * containerHeight;
    const bottom = (accumulated + partition.heightRatio) * containerHeight;
    if (relativeY >= top && relativeY < bottom) {
      return { partition, index: i };
    }
    accumulated += partition.heightRatio;
  }

  const last = partitions[partitions.length - 1];
  return { partition: last, index: partitions.length - 1 };
}

/** 分区在视口中的矩形（用于仪表盘锚定与预览） */
export function getPartitionViewportRect(
  partitionIndex: number,
  partitions: DockPartition[],
  layout: SidebarSnapLayout,
): { top: number; left: number; width: number; height: number } {
  let accumulated = 0;
  for (let i = 0; i < partitionIndex; i++) {
    accumulated += partitions[i].heightRatio;
  }
  const height =
    partitions[partitionIndex].heightRatio * layout.containerHeight;
  const top = layout.containerTop + accumulated * layout.containerHeight;

  return {
    top,
    left: layout.contentLeft,
    width: Math.max(layout.contentWidth, 120),
    height,
  };
}

/** 由仪表盘选区生成吸附目标 */
export function buildSnapTargetFromGuideZone(
  zone: DockGuideZone,
  partition: DockPartition,
  partitionIndex: number,
  side: "left" | "right",
): PartitionSnapTarget {
  if (zone === "middle") {
    return {
      partitionId: partition.id,
      edgePosition: "middle",
      insertIndex: partitionIndex,
      side,
      willCreatePartition: false,
    };
  }
  if (zone === "top") {
    return {
      partitionId: partition.id,
      edgePosition: "top",
      insertIndex: partitionIndex,
      side,
      willCreatePartition: true,
    };
  }
  return {
    partitionId: partition.id,
    edgePosition: "bottom",
    insertIndex: partitionIndex + 1,
    side,
    willCreatePartition: true,
  };
}
