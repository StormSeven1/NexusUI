"use client";

/**
 * Dock 光电容器：无外框留白，整块区域即为 `EoVideoPanel`；「放大」为独立浮动窗（见 `EoVideoExpandFloatingFrame`）。
 */
import { cn } from "@/lib/utils";
import { EoVideoPanel } from "./EoVideoPanel";

export interface EoVideoDockPanelProps {
  className?: string;
  panelId?: string;
  entityId?: string;
  expandedMode?: boolean;
  /** 经典布局：隐藏放大/弹出，禁止独立放大窗 */
  disableExpand?: boolean;
  /** 经典布局主窗：固定放大态，可直接键盘手控无人机 */
  classicFixedExpanded?: boolean;
  /** 经典布局小窗：工具栏仅录屏/截图 */
  classicToolsCaptureOnly?: boolean;
  /** 经典布局小窗：右键「设为主屏」 */
  onClassicSetAsMain?: () => void;
}

export function EoVideoDockPanel({
  className,
  panelId = "electro-optical",
  entityId = "camera_004",
  expandedMode = false,
  disableExpand = false,
  classicFixedExpanded = false,
  classicToolsCaptureOnly = false,
  onClassicSetAsMain,
}: EoVideoDockPanelProps) {
  return (
    <div className={cn("h-full min-h-0 w-full overflow-hidden bg-black", className)}>
      <EoVideoPanel
        className="h-full min-h-0 rounded-none border-0 shadow-none"
        entityId={entityId}
        streamPersistKey={panelId}
        dockPanelId={panelId}
        expandedMode={expandedMode}
        disableExpand={disableExpand}
        classicFixedExpanded={classicFixedExpanded}
        classicToolsCaptureOnly={classicToolsCaptureOnly}
        onClassicSetAsMain={onClassicSetAsMain}
      />
    </div>
  );
}
