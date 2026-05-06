"use client";

import { useEffect, useRef, useState } from "react";
import { X, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useDockStore,
  PanelWindowState,
  PanelId,
  PanelLocation,
  DockPartition,
} from "@/stores/dock-store";
import {
  SNAP_SIDEBAR_THRESHOLD,
} from "@/components/dock/types";

// 分区吸附目标类型
interface PartitionSnapTarget {
  partitionId: string | null;
  edgePosition: "top" | "bottom" | "middle" | null;
  insertIndex: number | null;
  side: "left" | "right" | null;
  // 新增：是否创建新分区
  willCreatePartition: boolean;
}

/**
 * 新分区预览组件
 * 显示将要创建的新分区的视觉效果
 */
interface NewPartitionPreviewProps {
  target: PartitionSnapTarget;
  partitions: DockPartition[];
}

function NewPartitionPreview({ target, partitions }: NewPartitionPreviewProps) {
  if (!target.side) return null;

  // 使用与边缘检测相同的容器高度计算
  const topNavHeight = 48;
  const statusBarHeight = 32;
  const containerTop = topNavHeight;
  const containerHeight = window.innerHeight - topNavHeight - statusBarHeight;

  // 新分区的高度（按照实际创建时的比例）
  const newHeightRatio = 1 / (partitions.length + 1);
  const newPartitionHeight = newHeightRatio * containerHeight;

  // 计算压缩系数
  const compressionFactor = 1 - newHeightRatio;

  let previewTop = 0;
  const targetIndex = partitions.findIndex(p => p.id === target.partitionId);

  // 根据边缘位置计算预览位置
  if (target.edgePosition === "top") {
    // 在目标分区的上方插入
    // 计算插入点之前所有分区压缩后的累积高度
    for (let i = 0; i < targetIndex; i++) {
      previewTop += partitions[i].heightRatio * compressionFactor * containerHeight;
    }
  } else if (target.edgePosition === "bottom") {
    // 在目标分区的下方插入
    // 计算插入点之前（包括目标分区）所有分区压缩后的累积高度
    for (let i = 0; i <= targetIndex; i++) {
      previewTop += partitions[i].heightRatio * compressionFactor * containerHeight;
    }
  }

  previewTop += containerTop;

  return (
    <>
      {/* 预览框：青色实线边框 + 半透明填充 + 圆角 */}
      <div
        className="fixed border border-solid z-40 pointer-events-none"
        style={{
          top: previewTop,
          left: target.side === "left" ? 48 : "auto",
          right: target.side === "right" ? 48 : "auto",
          width: "312px",
          height: newPartitionHeight,
          borderColor: "rgba(34, 211, 238, 0.6)",
          backgroundColor: "rgba(34, 211, 238, 0.1)",
          borderRadius: "0.5rem",
        }}
      />
    </>
  );
}

/**
 * 已有分区高亮组件
 * 显示将要吸附到的已有分区的高亮效果
 */
interface ExistingPartitionHighlightProps {
  target: PartitionSnapTarget;
  partitions: DockPartition[];
}

function ExistingPartitionHighlight({ target, partitions }: ExistingPartitionHighlightProps) {
  // 吸附到已有分区时不显示预览
  return null;
}

interface DockWindowProps {
  panelId: PanelId;
  children: React.ReactNode;
  title: string;
  icon: React.ComponentType<{ size?: number }>;
  initialState: PanelWindowState;
  onStateChange: (state: PanelWindowState) => void;
  onClose: () => void;
  highlight?: boolean; // 是否显示高亮效果
  /** 无外框标题栏，内容区铺满（如光电视频）；顶部窄条可拖拽，右上角关闭 */
  chromeless?: boolean;
}

export function DockWindow({
  children,
  title,
  icon: Icon,
  initialState,
  onStateChange,
  onClose,
  highlight = false,
  chromeless = false,
}: DockWindowProps) {
  const [position, setPosition] = useState(initialState.position);
  const [size, setSize] = useState(initialState.size);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);

  const {
    bringToFront,
    snapPanelToArea,
    createPartition,
    assignPanelToPartition,
    leftPartitions,
    rightPartitions
  } = useDockStore();
  const [showSnapIndicator, setShowSnapIndicator] = useState(false);
  const [snapArea, setSnapArea] = useState<PanelLocation>(null);
  const [partitionSnapTarget, setPartitionSnapTarget] = useState<PartitionSnapTarget | null>(null);
  const showSnapIndicatorRef = useRef(false);
  const snapAreaRef = useRef<PanelLocation>(null);
  const partitionSnapTargetRef = useRef<PartitionSnapTarget | null>(null);

  /**
   * 检测分区吸附目标
   * 根据拖拽位置检测应该吸附到哪个分区的哪个边缘
   */
  const detectPartitionSnapTarget = (
    position: { x: number; y: number },
    side: "left" | "right",
    partitions: DockPartition[]
  ): PartitionSnapTarget => {
    // 检测是否靠近侧边栏
    // 左侧：从左边缘0px到阈值距离
    // 右侧：从右边缘向内阈值距离（考虑侧边栏宽度）
    const sidebarWidth = 360; // 侧边栏展开时的宽度
    const isNearSide = side === "left"
      ? position.x < SNAP_SIDEBAR_THRESHOLD
      : position.x > window.innerWidth - sidebarWidth - SNAP_SIDEBAR_THRESHOLD;

    if (!isNearSide || partitions.length === 0) {
      return { partitionId: null, edgePosition: null, insertIndex: null, side: null, willCreatePartition: false };
    }

    // 侧边栏容器的实际高度和位置
    // TopNav高度: 48px (h-12), StatusBar高度: 32px (h-8)
    const topNavHeight = 48;
    const statusBarHeight = 32;
    const containerTop = topNavHeight;
    const containerHeight = window.innerHeight - topNavHeight - statusBarHeight;

    // 将窗口的y坐标转换为相对于侧边栏容器的y坐标
    const relativeY = position.y - containerTop;

    // 命中某分区后按 20% / 60% / 20% 三段判定：
    // 上20% -> 在该分区上方新建
    // 中60% -> 挤入该分区
    // 下20% -> 在该分区下方新建
    let accumulatedHeight = 0;
    for (let i = 0; i < partitions.length; i++) {
      const partition = partitions[i];
      const partitionTop = accumulatedHeight * containerHeight;
      const partitionBottom = (accumulatedHeight + partition.heightRatio) * containerHeight;
      if (relativeY >= partitionTop && relativeY <= partitionBottom) {
        const partitionHeight = partitionBottom - partitionTop;
        const localY = relativeY - partitionTop;
        const topBand = partitionHeight * 0.2;
        const bottomBandStart = partitionHeight * 0.8;

        if (localY <= topBand) {
          return {
            partitionId: partition.id,
            edgePosition: "top",
            insertIndex: i,
            side,
            willCreatePartition: true,
          };
        }
        if (localY >= bottomBandStart) {
          return {
            partitionId: partition.id,
            edgePosition: "bottom",
            insertIndex: i + 1,
            side,
            willCreatePartition: true,
          };
        }
        return {
          partitionId: partition.id,
          edgePosition: "middle",
          insertIndex: i,
          side,
          willCreatePartition: false,
        };
      }

      accumulatedHeight += partition.heightRatio;
    }

    return { partitionId: null, edgePosition: null, insertIndex: null, side: null, willCreatePartition: false };
  };

  // 拖拽功能
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (headerRef.current?.contains(e.target as Node) && containerRef.current) {
        // 忽略按钮点击
        if ((e.target as HTMLElement).tagName === "BUTTON") return;

        const { left, top } = containerRef.current.getBoundingClientRect();
        setIsDragging(true);
        setDragOffset({
          x: e.clientX - left,
          y: e.clientY - top
        });

        // 提升窗口到最前
        bringToFront(initialState.id);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newPosition = {
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y
        };

        // 限制窗口不会完全移出屏幕
        // 允许窗口标题栏移动到距离屏幕边缘30px的位置，以便能触及分区边缘
        const maxX = window.innerWidth - 30;
        const maxY = window.innerHeight - 30;

        const constrainedPosition = {
          x: Math.max(-size.width + 30, Math.min(newPosition.x, maxX)),
          y: Math.max(-size.height + 30, Math.min(newPosition.y, maxY))
        };

        setPosition(constrainedPosition);

        // 检测目标侧边栏
        let targetSide: "left" | "right" | null = null;
        const sidebarWidth = 360; // 侧边栏展开时的宽度
        const isNearLeft = constrainedPosition.x < SNAP_SIDEBAR_THRESHOLD;
        const isNearRight = constrainedPosition.x > window.innerWidth - sidebarWidth - SNAP_SIDEBAR_THRESHOLD;

        if (isNearLeft) {
          targetSide = "left";
        } else if (isNearRight) {
          targetSide = "right";
        }

        // 检测分区吸附目标
        // 使用鼠标位置而不是窗口位置来检测，这样更准确
        let snapTarget: PartitionSnapTarget | null = null;
        if (targetSide) {
          const partitions = targetSide === "left" ? leftPartitions : rightPartitions;
          // 使用鼠标的实际位置来检测吸附目标
          const mousePosition = { x: e.clientX, y: e.clientY };
          snapTarget = detectPartitionSnapTarget(mousePosition, targetSide, partitions);
        }

        // 更新吸附提示
        if (snapTarget && snapTarget.partitionId) {
          setShowSnapIndicator(true);
          setPartitionSnapTarget(snapTarget);
          showSnapIndicatorRef.current = true;
          partitionSnapTargetRef.current = snapTarget;

          // 为了向后兼容，也设置旧的snapArea（转换为新的分区位置格式）
          if (snapTarget.side === "left") {
            setSnapArea(snapTarget.edgePosition === "top" ? "left-0" : "left-1");
            snapAreaRef.current = snapTarget.edgePosition === "top" ? "left-0" : "left-1";
          } else {
            setSnapArea(snapTarget.edgePosition === "top" ? "right-0" : "right-1");
            snapAreaRef.current = snapTarget.edgePosition === "top" ? "right-0" : "right-1";
          }
        } else {
          setShowSnapIndicator(false);
          setPartitionSnapTarget(null);
          setSnapArea(null);
          showSnapIndicatorRef.current = false;
          partitionSnapTargetRef.current = null;
          snapAreaRef.current = null;
        }
      }

      if (isResizing) {
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const newWidth = Math.max(300, e.clientX - rect.left);
        const newHeight = Math.max(200, e.clientY - rect.top);

        setSize({
          width: Math.min(newWidth, 800),
          height: Math.min(newHeight, 600)
        });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (isDragging || isResizing) {
        setIsDragging(false);
        setIsResizing(false);

        // 释放瞬间再计算一次吸附目标，避免 state 异步导致判定落后
        let freshTarget: PartitionSnapTarget | null = null;
        if (isDragging) {
          const sidebarWidth = 360;
          const side =
            e.clientX < SNAP_SIDEBAR_THRESHOLD
              ? "left"
              : e.clientX > window.innerWidth - sidebarWidth - SNAP_SIDEBAR_THRESHOLD
                ? "right"
                : null;
          if (side) {
            const stateNow = useDockStore.getState();
            const partitionsNow = side === "left" ? stateNow.leftPartitions : stateNow.rightPartitions;
            const releasePos = { x: e.clientX, y: e.clientY };
            const detected = detectPartitionSnapTarget(releasePos, side, partitionsNow);
            if (detected.partitionId) freshTarget = detected;
          }
        }

        const effectiveTarget = freshTarget ?? partitionSnapTargetRef.current;
        const effectiveShowSnap = showSnapIndicatorRef.current || !!effectiveTarget?.partitionId;

        // 检查是否应该吸附
        if (isDragging && effectiveShowSnap && effectiveTarget && effectiveTarget.side) {
          const { side, partitionId, willCreatePartition, insertIndex } = effectiveTarget;

          if (willCreatePartition && insertIndex !== null) {
            // 创建新分区并获取其ID
            const newPartitionId = createPartition(side, insertIndex);

            // 将面板分配到新分区
            if (newPartitionId) {
              assignPanelToPartition(initialState.id, newPartitionId);
            }
          } else {
            // 吸附到已有分区
            if (partitionId) {
              assignPanelToPartition(initialState.id, partitionId);
            }
          }

          setShowSnapIndicator(false);
          setPartitionSnapTarget(null);
          setSnapArea(null);
          showSnapIndicatorRef.current = false;
          partitionSnapTargetRef.current = null;
          snapAreaRef.current = null;
          return;
        }

        // 向后兼容：如果没有分区吸附目标，但固定区域吸附目标存在
        if (isDragging && effectiveShowSnap && snapAreaRef.current) {
          snapPanelToArea(initialState.id, snapAreaRef.current);
          setShowSnapIndicator(false);
          setSnapArea(null);
          showSnapIndicatorRef.current = false;
          partitionSnapTargetRef.current = null;
          snapAreaRef.current = null;
          return;
        }

        // 更新状态
        onStateChange({
          ...initialState,
          position,
          size
        });

        setShowSnapIndicator(false);
        setPartitionSnapTarget(null);
        setSnapArea(null);
        showSnapIndicatorRef.current = false;
        partitionSnapTargetRef.current = null;
        snapAreaRef.current = null;
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, isResizing, dragOffset, position, size, initialState, onStateChange, bringToFront]);

  // 窗口激活时提升层级
  const handleFocus = () => {
    bringToFront(initialState.id);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "fixed overflow-hidden transition-all duration-200",
        chromeless
          ? "rounded-md shadow-xl"
          : "nexus-glass rounded-lg",
        !chromeless &&
          cn(
            isDragging && "shadow-2xl",
            showSnapIndicator && "ring-2 ring-cyan-400 ring-opacity-50",
            highlight &&
              "ring-4 ring-cyan-400 ring-opacity-75 shadow-2xl shadow-cyan-400/50",
          ),
        chromeless &&
          cn(
            isDragging && "shadow-2xl",
            showSnapIndicator && "ring-2 ring-cyan-400/80",
            highlight && "ring-2 ring-cyan-400/90",
          ),
      )}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        zIndex: initialState.zIndex,
        border:
          chromeless
            ? showSnapIndicator || highlight
              ? "2px solid #22d3ee"
              : "none"
            : showSnapIndicator
              ? "2px solid #22d3ee"
              : highlight
                ? "2px solid #22d3ee"
                : "1px solid rgba(34, 211, 238, 0.3)",
        backgroundColor: chromeless ? "#000000" : "#19191D",
      }}
      onMouseDown={handleFocus}
    >
      {/* 新分区预览指示器 */}
      {showSnapIndicator && partitionSnapTarget && partitionSnapTarget.willCreatePartition && (
        <NewPartitionPreview
          target={partitionSnapTarget}
          partitions={partitionSnapTarget.side === "left" ? leftPartitions : rightPartitions}
        />
      )}

      {/* 已有分区高亮指示器 */}
      {showSnapIndicator && partitionSnapTarget && !partitionSnapTarget.willCreatePartition && (
        <ExistingPartitionHighlight
          target={partitionSnapTarget}
          partitions={partitionSnapTarget.side === "left" ? leftPartitions : rightPartitions}
        />
      )}

      {chromeless ? (
        <>
          {/* 顶层拖拽感应区（半透明，不挡视频主体） */}
          <div
            ref={headerRef}
            className="absolute left-0 right-0 top-0 z-20 h-10 cursor-move select-none bg-gradient-to-b from-black/55 to-transparent"
            title={`${title} · 拖拽移动`}
            aria-label="拖拽移动窗口"
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="absolute right-2 top-2 z-30 rounded-md bg-black/60 p-1.5 text-white/90 hover:bg-red-950/90"
            title="关闭"
          >
            <X size={16} strokeWidth={2} />
          </button>
          <div className="relative z-10 h-full w-full overflow-hidden bg-black">{children}</div>
        </>
      ) : (
        <>
          {/* 窗口标题栏 - 支持拖拽 */}
          <div
            ref={headerRef}
            className="flex cursor-move select-none items-center justify-between border-b border-nexus-border bg-nexus-bg-elevated px-3 py-2"
            style={{ backgroundColor: "#2F2F3A" }}
          >
            <div className="flex items-center gap-2">
              <div style={{ color: "#22d3ee", display: "flex", alignItems: "center" }}>
                <Icon size={16} />
              </div>
              <span className="text-sm text-nexus-text-secondary" style={{ color: "#d4d4d8" }}>
                {title}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="rounded p-1 transition-colors hover:bg-nexus-error"
                title="关闭"
              >
                <X size={14} className="text-nexus-text-muted" />
              </button>
            </div>
          </div>

          {/* 面板内容 */}
          <div
            className="overflow-auto"
            style={{
              height: "calc(100% - 40px)",
              backgroundColor: "#19191D",
            }}
          >
            {children}
          </div>
        </>
      )}

      {/* 调整大小手柄 */}
      <div
        ref={resizeHandleRef}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-center justify-center hover:bg-nexus-bg-elevated rounded-tl"
        onMouseDown={(e) => {
          e.stopPropagation();
          setIsResizing(true);
        }}
      >
        <Maximize2 size={14} className="text-nexus-text-muted" />
      </div>
    </div>
  );
}
