/**
 * Dock 模块导出文件
 *
 * 这个文件统一导出所有 dock 相关的组件、类型和方法
 * 提供清晰的公共 API
 */

// ============ 组件导出 ============

export { DockProvider, useDockContext, useDockStoreContext } from "./DockProvider";
export {
  usePanels,
  useActivePanelId,
  usePanelState,
  usePanelsByLocation,
  useDockActions,
  withDockStore,
} from "./DockProvider";
export { DockWindow } from "./DockWindow";
export { DockContainer } from "./DockContainer";
export { DockIcon } from "./DockIcon";

// ============ Store 导出 ============

export {
  useDockStore,
  getAllPanels,
  getPanelState,
  getPanelsByLocation,
  handlePanelClick,
  snapPanelToArea,
  bringToFront,
  updatePanelState,
  closePanel,
  registerPanel,
  registerPanels,
  unregisterPanel,
  getPanelConfig,
  getAllPanelConfigs,
} from "@/stores/dock-store";

// ============ 类型导出 ============

export type {
  // 基础类型
  PanelId,
  PanelLocation,
  PanelMode,
  // 面板状态接口
  PanelWindowState,
  // 面板配置接口
  PanelConfig,
  PanelRegistry,
  // Store 接口
  DockStoreState,
  DockStoreActions,
  DockStore,
  DockStoreWithSidebar,
  // Context 类型
  DockContextValue,
  // 调试类型
  LogLevel,
  LogEntry,
} from "./types";

// ============ 常量导出 ============

export {
  DEFAULT_WINDOW_SIZE,
  DEFAULT_WINDOW_POSITION,
  MIN_WINDOW_SIZE,
  MAX_WINDOW_SIZE,
  SNAP_THRESHOLD,
  DEFAULT_Z_INDEX,
  DEFAULT_DISPLAY_ORDER,
} from "./types";

// ============ Provider Props 导出 ============

export type { DockProviderProps } from "./DockProvider";
