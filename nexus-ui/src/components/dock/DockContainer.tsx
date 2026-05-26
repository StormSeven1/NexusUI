"use client";

import { createPortal } from "react-dom";
import { Square } from "lucide-react";
import { useDockStore, PanelId } from "@/stores/dock-store";
import { DockWindow } from "./DockWindow";
import { getWindowConfig } from "./windowRegistry";

/**
 * 获取面板组件
 * 从windowRegistry中动态获取组件
 */
function getPanelComponent(panelId: PanelId): React.ComponentType {
  const config = getWindowConfig(panelId);
  if (config) {
    return config.component;
  }

  // 如果找不到配置，返回占位组件
  return () => <div className="p-4">未知面板: {panelId}</div>;
}

/**
 * 获取面板标题
 * 从windowRegistry中动态获取标题
 */
function getPanelTitle(panelId: PanelId): string {
  const config = getWindowConfig(panelId);
  return config?.title || "未知面板";
}

/**
 * 获取面板图标
 * 从windowRegistry中动态获取图标
 */
function getPanelIcon(panelId: PanelId): React.ComponentType<{ size?: number; className?: string }> | undefined {
  const config = getWindowConfig(panelId);
  return config?.icon;
}

export function DockContainer() {
  const {
    panels,
    updatePanelState,
    closePanel,
    highlightedPanelId,
  } = useDockStore();

  // 只渲染popup模式的面板
  const visiblePanels = (panels || []).filter(
    (panel) => panel.mode === "popup"
  );

  // 按zIndex排序，确保层级正确
  const sortedPanels = [...visiblePanels].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <>
      {sortedPanels.map((panel) => {
        const config = getWindowConfig(panel.id);
        const PanelComponent = getPanelComponent(panel.id);
        const Icon = getPanelIcon(panel.id) ?? Square;
        const title = getPanelTitle(panel.id);
        const isHighlighted = highlightedPanelId === panel.id;
        const resizable = config?.resizable !== false;

        const dockWindow = (
          <DockWindow
            key={panel.id}
            panelId={panel.id}
            title={title}
            icon={Icon}
            initialState={panel}
            onStateChange={(newState) => updatePanelState(panel.id, newState)}
            onClose={() => closePanel(panel.id)}
            highlight={isHighlighted}
            resizable={resizable}
          >
            <PanelComponent />
          </DockWindow>
        );

        // 使用Portal渲染到body，确保窗口在最上层
        return createPortal(dockWindow, document.body);
      })}
    </>
  );
}
