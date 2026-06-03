"use client";

import { useEffect, useRef, useState } from "react";
import { Circle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useDockStore,
  PanelWindowState,
  PanelId,
  PanelLocation,
} from "@/stores/dock-store";
import {
  isElectroOpticalDockPanel,
  useEoVideoPanelFocusStore,
} from "@/stores/eo-video-panel-focus-store";
import { SNAP_SIDEBAR_THRESHOLD } from "@/components/dock/types";
import {
  type DockPopupResizeEdge,
  DOCK_POPUP_RESIZE_EDGE_HIT,
  DOCK_POPUP_RESIZE_HANDLE_CLASS,
  resizeDockPopupRect,
} from "@/lib/dock/dockPopupResize";
import { DockGuideDashboard } from "@/components/dock/DockGuideDashboard";
import { DockPartitionDropPreview } from "@/components/dock/DockPartitionDropPreview";
import {
  type DockGuideZone,
  type PartitionSnapTarget,
  type SidebarSnapLayout,
  buildSnapTargetFromGuideZone,
  detectNearDockSide,
  findPartitionAtRelativeY,
  getPartitionViewportRect,
  getSidebarSnapLayout,
} from "@/lib/dock/dockGuideLayout";

function dockGuideZoneFromPoint(clientX: number, clientY: number): DockGuideZone | null {
  const el = document.elementFromPoint(clientX, clientY);
  const zone = el?.closest("[data-dock-guide-zone]")?.getAttribute("data-dock-guide-zone");
  if (zone === "top" || zone === "middle" || zone === "bottom") return zone;
  return null;
}

function isPointerOnDockGuide(clientX: number, clientY: number): boolean {
  const el = document.elementFromPoint(clientX, clientY);
  return !!el?.closest("[data-dock-guide-root]");
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
  /** popup 模式下是否允许鼠标拖拽边缘/角调整大小（默认 true） */
  resizable?: boolean;
}

export function DockWindow({
  panelId,
  children,
  title,
  icon: Icon,
  initialState,
  onStateChange,
  onClose,
  highlight = false,
  chromeless = false,
  resizable = true,
}: DockWindowProps) {
  const [position, setPosition] = useState(initialState.position);
  const [size, setSize] = useState(initialState.size);
  const [isDragging, setIsDragging] = useState(false);
  const [resizeEdge, setResizeEdge] = useState<DockPopupResizeEdge | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const {
    bringToFront,
    snapPanelToArea,
    createPartition,
    assignPanelToPartition,
    leftPartitions,
    rightPartitions,
    leftSidebarOpen,
    rightSidebarOpen,
    leftSidebarWidth,
    rightSidebarWidth,
  } = useDockStore();
  const eoFocusedDockId = useEoVideoPanelFocusStore((s) => s.focusedDockPanelId);
  const setEoFocusedDockPanel = useEoVideoPanelFocusStore((s) => s.setFocusedDockPanel);
  const isEoDock = isElectroOpticalDockPanel(panelId);
  const eoBarSelected = isEoDock && eoFocusedDockId === panelId;

  const [showSnapIndicator, setShowSnapIndicator] = useState(false);
  const [snapArea, setSnapArea] = useState<PanelLocation>(null);
  const [partitionSnapTarget, setPartitionSnapTarget] = useState<PartitionSnapTarget | null>(null);
  const [dockGuideVisible, setDockGuideVisible] = useState(false);
  const [dockGuideSide, setDockGuideSide] = useState<"left" | "right" | null>(null);
  const [dockGuideZone, setDockGuideZone] = useState<DockGuideZone | null>(null);
  const [dockGuideAnchorRect, setDockGuideAnchorRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [dockGuideLayout, setDockGuideLayout] = useState<SidebarSnapLayout | null>(null);
  const showSnapIndicatorRef = useRef(false);
  const snapAreaRef = useRef<PanelLocation>(null);
  const partitionSnapTargetRef = useRef<PartitionSnapTarget | null>(null);
  const guideAnchorRef = useRef<{
    side: "left" | "right";
    partitionId: string;
    partitionIndex: number;
    layout: SidebarSnapLayout;
  } | null>(null);

  const sidebarLayoutOpts = {
    leftSidebarOpen,
    leftSidebarWidth,
    rightSidebarOpen,
    rightSidebarWidth,
  };

  const applyGuideSelection = (
    zone: DockGuideZone | null,
    anchor: typeof guideAnchorRef.current,
  ) => {
    setDockGuideZone(zone);
    if (!zone || !anchor) {
      setPartitionSnapTarget(null);
      setShowSnapIndicator(false);
      partitionSnapTargetRef.current = null;
      showSnapIndicatorRef.current = false;
      return;
    }
    const partitions =
      anchor.side === "left" ? leftPartitions : rightPartitions;
    const partition = partitions[anchor.partitionIndex];
    if (!partition) return;
    const target = buildSnapTargetFromGuideZone(
      zone,
      partition,
      anchor.partitionIndex,
      anchor.side,
    );
    setPartitionSnapTarget(target);
    setShowSnapIndicator(true);
    partitionSnapTargetRef.current = target;
    showSnapIndicatorRef.current = true;
  };

  const clearDockGuide = () => {
    setDockGuideVisible(false);
    setDockGuideSide(null);
    setDockGuideZone(null);
    setDockGuideAnchorRect(null);
    setDockGuideLayout(null);
    guideAnchorRef.current = null;
    setShowSnapIndicator(false);
    setPartitionSnapTarget(null);
    showSnapIndicatorRef.current = false;
    partitionSnapTargetRef.current = null;
    setSnapArea(null);
    snapAreaRef.current = null;
  };

  useEffect(() => {
    if (isDragging || resizeEdge) return;
    setPosition(initialState.position);
    setSize(initialState.size);
  }, [
    initialState.position.x,
    initialState.position.y,
    initialState.size.width,
    initialState.size.height,
    isDragging,
    resizeEdge,
  ]);

  const beginResize = (edge: DockPopupResizeEdge) => (e: React.MouseEvent) => {
    if (!resizable) return;
    e.preventDefault();
    e.stopPropagation();
    resizeStartRef.current = {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    };
    setResizeEdge(edge);
    bringToFront(initialState.id);
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

        const targetSide = detectNearDockSide(
          e.clientX,
          SNAP_SIDEBAR_THRESHOLD,
          sidebarLayoutOpts,
        );

        if (targetSide) {
          const layout = getSidebarSnapLayout(targetSide, sidebarLayoutOpts);
          const partitions =
            targetSide === "left" ? leftPartitions : rightPartitions;
          const relativeY = e.clientY - layout.containerTop;
          const hit = findPartitionAtRelativeY(
            relativeY,
            partitions,
            layout.containerHeight,
          );
          const onGuide = isPointerOnDockGuide(e.clientX, e.clientY);

          if (!onGuide && hit) {
            guideAnchorRef.current = {
              side: targetSide,
              partitionId: hit.partition.id,
              partitionIndex: hit.index,
              layout,
            };
            setDockGuideAnchorRect(
              getPartitionViewportRect(hit.index, partitions, layout),
            );
          }

          setDockGuideVisible(true);
          setDockGuideSide(targetSide);
          setDockGuideLayout(layout);

          const zone = dockGuideZoneFromPoint(e.clientX, e.clientY);
          applyGuideSelection(zone, guideAnchorRef.current);
        } else {
          clearDockGuide();
        }
      }

      if (resizeEdge && resizeStartRef.current) {
        const next = resizeDockPopupRect(resizeStartRef.current, resizeEdge, e.clientX, e.clientY);
        setPosition({ x: next.x, y: next.y });
        setSize({ width: next.width, height: next.height });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (isDragging || resizeEdge) {
        const wasResizing = !!resizeEdge;
        setIsDragging(false);
        setResizeEdge(null);
        resizeStartRef.current = null;

        let freshTarget: PartitionSnapTarget | null = null;
        if (isDragging) {
          const releaseZone = dockGuideZoneFromPoint(e.clientX, e.clientY);
          const anchor = guideAnchorRef.current;
          if (releaseZone && anchor) {
            const partitions =
              anchor.side === "left" ? leftPartitions : rightPartitions;
            const partition = partitions[anchor.partitionIndex];
            if (partition) {
              freshTarget = buildSnapTargetFromGuideZone(
                releaseZone,
                partition,
                anchor.partitionIndex,
                anchor.side,
              );
            }
          }
        }

        const releaseZone = dockGuideZoneFromPoint(e.clientX, e.clientY);
        const effectiveTarget = freshTarget ?? partitionSnapTargetRef.current;
        const effectiveShowSnap =
          !!effectiveTarget?.partitionId &&
          (!!releaseZone || showSnapIndicatorRef.current);

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

          clearDockGuide();
          return;
        }

        if (isDragging && snapAreaRef.current) {
          snapPanelToArea(initialState.id, snapAreaRef.current);
          clearDockGuide();
          return;
        }

        // 更新状态（拉伸结束用 DOM 矩形，避免闭包滞后）
        if (wasResizing && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          onStateChange({
            ...initialState,
            position: { x: rect.left, y: rect.top },
            size: { width: rect.width, height: rect.height },
          });
        } else if (!wasResizing) {
          onStateChange({
            ...initialState,
            position,
            size,
          });
        }

        clearDockGuide();
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
  }, [
    isDragging,
    resizeEdge,
    dragOffset,
    position,
    size,
    initialState,
    onStateChange,
    bringToFront,
    snapPanelToArea,
    createPartition,
    assignPanelToPartition,
    leftPartitions,
    rightPartitions,
    leftSidebarOpen,
    rightSidebarOpen,
    leftSidebarWidth,
    rightSidebarWidth,
  ]);

  // 窗口激活时提升层级；光电多窗时点任意处即记入「当前选中」
  const handleFocus = () => {
    bringToFront(initialState.id);
    if (isEoDock) setEoFocusedDockPanel(panelId);
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
      {dockGuideVisible && dockGuideAnchorRect && dockGuideSide ? (
        <DockGuideDashboard
          anchorRect={dockGuideAnchorRect}
          side={dockGuideSide}
          activeZone={dockGuideZone}
          onZoneChange={(zone) => applyGuideSelection(zone, guideAnchorRef.current)}
        />
      ) : null}

      {showSnapIndicator &&
      partitionSnapTarget &&
      dockGuideLayout &&
      dockGuideZone ? (
        <DockPartitionDropPreview
          target={partitionSnapTarget}
          partitions={
            partitionSnapTarget.side === "left" ? leftPartitions : rightPartitions
          }
          layout={dockGuideLayout}
          activeZone={dockGuideZone}
        />
      ) : null}

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
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div style={{ color: "#22d3ee", display: "flex", alignItems: "center", flexShrink: 0 }}>
                <Icon size={16} />
              </div>
              {eoBarSelected ? (
                <span className="shrink-0 text-sky-400" title="当前选中的光电窗口">
                  <Circle className="size-2.5 fill-current" strokeWidth={0} aria-hidden />
                </span>
              ) : (
                /* 占位与选中态宽度接近，标题不跳动 */
                isEoDock ? <span className="inline-block w-2.5 shrink-0 opacity-0" aria-hidden /> : null
              )}
              <span
                className="min-w-0 truncate text-sm text-nexus-text-secondary"
                style={{ color: "#d4d4d8" }}
              >
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

      {resizable
        ? (Object.keys(DOCK_POPUP_RESIZE_EDGE_HIT) as DockPopupResizeEdge[]).map((edge) => (
            <div
              key={edge}
              role="separator"
              aria-orientation={
                edge === "n" || edge === "s" ? "horizontal" : edge === "e" || edge === "w" ? "vertical" : undefined
              }
              aria-label="拖拽调整窗口大小"
              className={cn(DOCK_POPUP_RESIZE_HANDLE_CLASS, DOCK_POPUP_RESIZE_EDGE_HIT[edge])}
              onMouseDown={beginResize(edge)}
            />
          ))
        : null}
    </div>
  );
}
