"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { useDragSplit } from "@/hooks/useDragSplit";
import { EoVideoDockPanel } from "@/components/eo-video/EoVideoDockPanel";
import { getWindowConfig } from "@/components/dock/windowRegistry";
import { useDockStore } from "@/stores/dock-store";
import { useAppConfigStore } from "@/stores/app-config-store";
import { cameraEntityIdFromIndex } from "@/lib/camera-management-client";
import {
  CLASSIC_MAIN_EO_PANEL_ID,
  CLASSIC_SUB_EO_PANEL_IDS,
  MIN_CLASSIC_RATIO,
  clampClassicRightWidth,
} from "@/lib/layout/classic-layout-config";
import type { PanelId } from "@/components/dock/types";
import {
  isElectroOpticalDockPanel,
  useEoVideoPanelFocusStore,
} from "@/stores/eo-video-panel-focus-store";

function SplitHandle(props: {
  axis: "horizontal" | "vertical";
  onMouseDown: () => void;
  dragging?: boolean;
}) {
  const { axis, onMouseDown, dragging } = props;
  return (
    <div
      role="separator"
      aria-orientation={axis === "horizontal" ? "vertical" : "horizontal"}
      className={cn(
        "z-[1] shrink-0 bg-nexus-border transition-colors hover:bg-nexus-accent/40",
        axis === "horizontal" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
        dragging && "bg-nexus-accent/55",
      )}
      onMouseDown={(e) => {
        e.preventDefault();
        onMouseDown();
      }}
    />
  );
}

function ClassicPanelFrame(props: {
  title: string;
  panelId?: PanelId;
  children: React.ReactNode;
  className?: string;
}) {
  const { title, panelId, children, className } = props;
  const eoFocusedDockId = useEoVideoPanelFocusStore((s) => s.focusedDockPanelId);
  const setEoFocusedDockPanel = useEoVideoPanelFocusStore((s) => s.setFocusedDockPanel);
  const isEo = panelId && isElectroOpticalDockPanel(panelId);

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-nexus-bg-base",
        className,
      )}
      onPointerDown={() => {
        if (panelId && isEo) setEoFocusedDockPanel(panelId);
      }}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 border-b border-nexus-border px-2 py-1",
          isEo && eoFocusedDockId === panelId && "bg-sky-950/25",
        )}
      >
        <span className="truncate text-xs font-medium text-nexus-text-secondary">{title}</span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0 min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

function useClassicEoEntityMap(): Record<string, string> {
  const seaIndex = useAppConfigStore((s) => s.config?.cameraManagement?.seaCameraIndex ?? 1);
  const skyIndex = useAppConfigStore((s) => s.config?.cameraManagement?.skyCameraIndex ?? 4);
  return useMemo(() => {
    const sea = cameraEntityIdFromIndex(seaIndex);
    const sky = cameraEntityIdFromIndex(skyIndex);
    return {
      [CLASSIC_MAIN_EO_PANEL_ID]: sky,
      [CLASSIC_SUB_EO_PANEL_IDS[0]]: sea,
      [CLASSIC_SUB_EO_PANEL_IDS[1]]: sky,
      [CLASSIC_SUB_EO_PANEL_IDS[2]]: sea,
    };
  }, [seaIndex, skyIndex]);
}

/** 经典布局右侧固定栏：光电区 + 信息区 */
export function ClassicRightColumn(props: { workspaceRowRef: RefObject<HTMLDivElement | null> }) {
  const { workspaceRowRef } = props;
  const panelRegistry = useDockStore((s) => s.panelRegistry);
  const classicSplitRatios = useDockStore((s) => s.classicSplitRatios);
  const setClassicSplitRatio = useDockStore((s) => s.setClassicSplitRatio);
  const adjustClassicEoSubHeight = useDockStore((s) => s.adjustClassicEoSubHeight);
  const rightSidebarWidth = useDockStore((s) => s.rightSidebarWidth);
  const classicRightWidthRatio = useDockStore((s) => s.classicRightWidthRatio);
  const setRightSidebarWidth = useDockStore((s) => s.setRightSidebarWidth);

  const syncWidthFromRow = useCallback(() => {
    const row = workspaceRowRef.current;
    if (!row) return;
    const rowWidth = row.getBoundingClientRect().width;
    if (rowWidth <= 0) return;
    const target = clampClassicRightWidth(rowWidth * classicRightWidthRatio, rowWidth);
    if (Math.abs(target - useDockStore.getState().rightSidebarWidth) > 1) {
      setRightSidebarWidth(target, { containerWidth: rowWidth });
    }
  }, [classicRightWidthRatio, setRightSidebarWidth, workspaceRowRef]);

  useLayoutEffect(() => {
    syncWidthFromRow();
  }, [syncWidthFromRow]);

  useEffect(() => {
    const row = workspaceRowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => syncWidthFromRow());
    ro.observe(row);
    window.addEventListener("resize", syncWidthFromRow);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncWidthFromRow);
    };
  }, [syncWidthFromRow, workspaceRowRef]);

  const eoEntityMap = useClassicEoEntityMap();
  const setEoFocusedDockPanel = useEoVideoPanelFocusStore((s) => s.setFocusedDockPanel);

  useEffect(() => {
    setEoFocusedDockPanel(CLASSIC_MAIN_EO_PANEL_ID);
  }, [setEoFocusedDockPanel]);

  const columnRef = useRef<HTMLDivElement>(null);
  const eoMainRowRef = useRef<HTMLDivElement>(null);
  const infoRowRef = useRef<HTMLDivElement>(null);
  const eoSubColRef = useRef<HTMLDivElement>(null);

  const onEoAreaRatio = useCallback(
    (ratio: number) => {
      setClassicSplitRatio(
        "eoAreaRatio",
        Math.max(MIN_CLASSIC_RATIO, Math.min(1 - MIN_CLASSIC_RATIO, ratio)),
      );
    },
    [setClassicSplitRatio],
  );

  const onEoMainRatio = useCallback(
    (ratio: number) => {
      setClassicSplitRatio(
        "eoMainRatio",
        Math.max(MIN_CLASSIC_RATIO, Math.min(1 - MIN_CLASSIC_RATIO, ratio)),
      );
    },
    [setClassicSplitRatio],
  );

  const onInfoLeftRatio = useCallback(
    (ratio: number) => {
      setClassicSplitRatio(
        "infoLeftRatio",
        Math.max(MIN_CLASSIC_RATIO, Math.min(1 - MIN_CLASSIC_RATIO, ratio)),
      );
    },
    [setClassicSplitRatio],
  );

  const onEoSubDivider0 = useCallback(
    (ratio: number) => adjustClassicEoSubHeight(0, ratio),
    [adjustClassicEoSubHeight],
  );

  const onEoSubDivider1 = useCallback(
    (ratio: number) => {
      const [r0] = classicSplitRatios.eoSubRatios;
      adjustClassicEoSubHeight(1, ratio - r0);
    },
    [adjustClassicEoSubHeight, classicSplitRatios.eoSubRatios],
  );

  const { dragging: draggingEoArea, startDrag: startEoAreaDrag } = useDragSplit({
    enabled: true,
    axis: "vertical",
    containerRef: columnRef,
    onRatio: onEoAreaRatio,
  });

  const { dragging: draggingEoMain, startDrag: startEoMainDrag } = useDragSplit({
    enabled: true,
    axis: "horizontal",
    containerRef: eoMainRowRef,
    onRatio: onEoMainRatio,
  });

  const { dragging: draggingInfo, startDrag: startInfoDrag } = useDragSplit({
    enabled: true,
    axis: "horizontal",
    containerRef: infoRowRef,
    onRatio: onInfoLeftRatio,
  });

  const { dragging: draggingSub0, startDrag: startSub0Drag } = useDragSplit({
    enabled: true,
    axis: "vertical",
    containerRef: eoSubColRef,
    onRatio: onEoSubDivider0,
  });

  const { dragging: draggingSub1, startDrag: startSub1Drag } = useDragSplit({
    enabled: true,
    axis: "vertical",
    containerRef: eoSubColRef,
    onRatio: onEoSubDivider1,
  });

  const TargetProfileComp = panelRegistry["target-profile"]?.component;
  const ChatComp = panelRegistry.chat?.component;

  const { eoAreaRatio, eoMainRatio, infoLeftRatio, eoSubRatios } = classicSplitRatios;
  const infoAreaRatio = 1 - eoAreaRatio;

  return (
    <aside
      className="relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-l border-nexus-border bg-nexus-bg-base"
      style={{ width: `${rightSidebarWidth}px` }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        className="absolute left-0 top-0 z-20 h-full w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-nexus-accent/25"
        onMouseDown={(e) => {
          e.preventDefault();
          const row = workspaceRowRef.current;
          if (!row) return;
          const onMove = (ev: MouseEvent) => {
            const rect = row.getBoundingClientRect();
            const width = rect.right - ev.clientX;
            setRightSidebarWidth(width, { containerWidth: rect.width });
          };
          const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }}
      />

      <div ref={columnRef} className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        {/* 光电区 */}
        <div
          className="flex min-h-0 min-w-0 flex-col overflow-hidden"
          style={{ flex: `${eoAreaRatio} 1 0`, minHeight: 0 }}
        >
          <div ref={eoMainRowRef} className="flex h-full min-h-0 w-full overflow-hidden">
            <div
              className="h-full min-h-0 min-w-0 overflow-hidden"
              style={{ flex: `${eoMainRatio} 1 0`, minWidth: 0 }}
            >
              <ClassicPanelFrame
                title={getWindowConfig(CLASSIC_MAIN_EO_PANEL_ID)?.title ?? "光电"}
                panelId={CLASSIC_MAIN_EO_PANEL_ID}
              >
                <EoVideoDockPanel
                  panelId={CLASSIC_MAIN_EO_PANEL_ID}
                  entityId={eoEntityMap[CLASSIC_MAIN_EO_PANEL_ID]}
                  classicFixedExpanded
                  disableExpand
                />
              </ClassicPanelFrame>
            </div>
            <SplitHandle
              axis="horizontal"
              dragging={draggingEoMain}
              onMouseDown={startEoMainDrag}
            />
            <div
              ref={eoSubColRef}
              className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
              style={{ flex: `${1 - eoMainRatio} 1 0`, minWidth: 0 }}
            >
              {CLASSIC_SUB_EO_PANEL_IDS.map((pid, idx) => (
                <Fragment key={pid}>
                  {idx > 0 ? (
                    <SplitHandle
                      axis="vertical"
                      dragging={idx === 1 ? draggingSub0 : draggingSub1}
                      onMouseDown={idx === 1 ? startSub0Drag : startSub1Drag}
                    />
                  ) : null}
                  <div
                    className="min-h-0 min-w-0 overflow-hidden"
                    style={{ flex: `${eoSubRatios[idx]} 1 0`, minHeight: 0 }}
                  >
                    <ClassicPanelFrame title={getWindowConfig(pid)?.title ?? pid} panelId={pid}>
                      <EoVideoDockPanel
                        panelId={pid}
                        entityId={eoEntityMap[pid]}
                        disableExpand
                      />
                    </ClassicPanelFrame>
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        </div>

        <SplitHandle axis="vertical" dragging={draggingEoArea} onMouseDown={startEoAreaDrag} />

        {/* 信息展示区 */}
        <div
          className="flex min-h-0 min-w-0 flex-col overflow-hidden"
          style={{ flex: `${infoAreaRatio} 1 0`, minHeight: 0 }}
        >
          <div ref={infoRowRef} className="flex h-full min-h-0 w-full overflow-hidden">
            <div
              className="h-full min-h-0 min-w-0 overflow-hidden"
              style={{ flex: `${infoLeftRatio} 1 0`, minWidth: 0 }}
            >
              <ClassicPanelFrame title="目标档案">
                {TargetProfileComp ? <TargetProfileComp /> : null}
              </ClassicPanelFrame>
            </div>
            <SplitHandle axis="horizontal" dragging={draggingInfo} onMouseDown={startInfoDrag} />
            <div
              className="h-full min-h-0 min-w-0 overflow-hidden"
              style={{ flex: `${1 - infoLeftRatio} 1 0`, minWidth: 0 }}
            >
              <ClassicPanelFrame title="智能助手">
                {ChatComp ? <ChatComp /> : null}
              </ClassicPanelFrame>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
