/**
 * Dock 模块类型定义
 *
 * 这个文件包含所有 dock 相关的 TypeScript 类型和接口
 * 用于支持独立的面板管理系统
 */

// ============ 基础类型 ============

/**
 * 窗体能力类型
 * - dockable: 可停靠的窗体，具备窗体icon，用于吸附后显示在导航栏上的图标，窗体的灵活布局要求高一些
 * - undockable: 不可停靠的窗体，无需窗体icon，窗体布局不需要大动，主要用于设置类弹窗
 */
export type WindowCapability = "dockable" | "undockable";

/**
 * 窗体组件形式
 * - popup: 可以自由移动位置的弹窗
 * - dock: 吸附在侧边面板上的dock窗
 */
export type WindowForm = "popup" | "dock";

/**
 * 窗体类别
 * 用于在菜单中组织和分类窗体
 */
export type WindowCategory =
  | "target"        // 目标相关
  | "electro-optical"  // 光电相关
  | "settings"      // 设置相关
  | "system"        // 系统相关
  | "tools"         // 工具相关
  | "other";        // 其他

/**
 * 面板 ID 类型
 * 所有可用的面板标识符（保留向后兼容）
 */
export type PanelId =
  | "tracks"
  | "track-display"
  | "alerts"
  | "layers"
  | "assets"
  | "electro-optical"
  | "electro-optical-1"
  | "electro-optical-2"
  | "electro-optical-3"
  | "electro-optical-4"
  | "chat"
  /** 系统评估（含航迹/相机/算法等子 Tab） */
  | "system-evaluation"
  /** @deprecated 已更名为 system-evaluation，保留类型以兼容旧布局持久化 */
  | "track-evaluation"
  /** 地图双击航迹：右侧栏上方目标档案（航迹信息 + 查证相册） */
  | "target-profile"
  | "overview"
  | "eventlog"
  | "comm"
  // 新增窗体ID
  | "shore-camera"
  | "drone-camera"
  | "settings-electro-optical"
  | "settings-radar"
  | "settings-drone"
  | "entity-management"
  | "center-point"
  | "system-status"
  | "system-log";

/**
 * 窗体配置接口
 * 统一的窗体定义，包含dockable和undockable类型
 */
export interface WindowConfig {
  /** 窗体唯一ID */
  id: PanelId;
  /** 窗体标题 */
  title: string;
  /** 窗体能力类型：dockable 或 undockable */
  capability: WindowCapability;
  /** 窗体所属类别（用于菜单组织） */
  category: WindowCategory;
  /** 在菜单中显示的标签 */
  menuLabel: string;
  /** 窗体图标组件（仅dockable窗体需要） */
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  /** 窗体内容组件 */
  component: React.ComponentType;
  /** 默认停靠位置（仅dockable窗体） - 支持传统和现代格式 */
  defaultLocation?: PanelLocation | LegacyPanelLocation;
  /** 默认窗口大小 */
  defaultSize?: { width: number; height: number };
  /** 是否可以关闭 */
  closable?: boolean;
  /** 是否可以拖拽（popup模式下） */
  draggable?: boolean;
  /** 是否可以调整大小（popup模式下） */
  resizable?: boolean;
  /** 描述信息 */
  description?: string;
}

/**
 * 分区位置类型（动态分区系统）
 * 格式：side-index，例如 "left-0", "left-1", "right-0", "right-1"
 */
export type PartitionLocation = `left-${number}` | `right-${number}`;

/**
 * 面板停靠位置
 * null 表示不在任何停靠区域（hidden 或 popup 但不在边缘）
 */
export type PanelLocation = PartitionLocation | null;

/**
 * 传统面板停靠位置（用于向后兼容）
 */
export type LegacyPanelLocation =
  | "left-top"
  | "left-bottom"
  | "right-top"
  | "right-bottom";

/**
 * 面板显示模式
 * - hidden: 隐藏（不显示）
 * - docked: 停靠在侧边栏
 * - popup: 弹出为独立窗口
 */
export type PanelMode = "hidden" | "docked" | "popup";

// ============ 面板状态接口 ============

/**
 * 统一的面板窗口状态
 * 管理每个面板的位置、大小、模式等信息
 */
export interface PanelWindowState {
  /** 面板 ID */
  id: PanelId;
  /** 面板停靠位置，null 表示不在任何停靠区域 */
  location: PanelLocation;
  /** 面板显示模式 */
  mode: PanelMode;
  /** popup 模式下的窗口位置 */
  position: { x: number; y: number };
  /** 窗口大小 */
  size: { width: number; height: number };
  /** 层级 */
  zIndex: number;
  /** 上次 popup 位置记录 */
  lastPopupPosition: { x: number; y: number } | null;
  /** 在当前位置的显示顺序（用于导航栏图标排序） */
  displayOrder: number;
}

// ============ 面板配置接口 ============

/**
 * 面板配置
 * 定义面板的基本属性和默认行为
 */
export interface PanelConfig {
  /** 面板 ID */
  id: PanelId;
  /** 面板标题 */
  title: string;
  /** 面板图标组件 */
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /** 面板内容组件 */
  component: React.ComponentType;
  /** 默认停靠位置 - 支持传统和现代格式 */
  defaultLocation: PanelLocation | LegacyPanelLocation;
  /** 默认窗口大小 */
  defaultSize?: { width: number; height: number };
  /** 是否可以关闭 */
  closable?: boolean;
  /** 是否可以拖拽 */
  draggable?: boolean;
  /** 是否可以调整大小 */
  resizable?: boolean;
}

/**
 * 面板注册表
 * 管理所有已注册的面板配置
 */
export interface PanelRegistry {
  /** 注册的面板映射表 */
  [key: string]: PanelConfig;
}

// ============ Store 状态接口 ============

/**
 * Dock Store 状态
 * 包含所有 dock 管理需要的状态
 */
export interface DockStoreState {
  /** 所有面板的状态列表 */
  panels: PanelWindowState[];
  /** 当前激活的面板 ID */
  activePanelId: PanelId | null;
  /** 下一个可用的 z-index 值 */
  nextZIndex: number;

  // 区域特定状态（用于控制哪个面板在当前显示）
  /** 左上区域当前显示的面板 */
  leftUpperPanelTab: PanelId;
  /** 左下区域当前显示的面板 */
  leftLowerPanelTab: PanelId;
  /** 右上区域当前显示的面板 */
  rightUpperPanelTab: PanelId;
  /** 右下区域当前显示的面板 */
  rightLowerPanelTab: PanelId;
}

/**
 * Dock Store 方法
 * 包含所有 dock 管理需要的方法
 */
export interface DockStoreActions {
  /**
   * 统一的点击处理器
   * 根据面板当前状态决定行为：
   * - hidden -> docked: 显示并停靠
   * - docked + 当前显示 -> popup: 弹出为窗口
   * - docked + 非当前显示 -> 切换为当前显示
   * - popup -> 无操作
   */
  handlePanelClick: (panelId: PanelId) => void;

  /**
   * 吸附面板到指定区域
   * 将面板从 popup 或其他位置移动到指定的停靠区域
   */
  snapPanelToArea: (panelId: PanelId, area: PanelLocation) => void;

  /**
   * 将面板提升到最前层
   * 增加 z-index 并设置为激活面板
   */
  bringToFront: (panelId: PanelId) => void;

  /**
   * 更新面板状态
   * 部分更新面板的状态信息
   */
  updatePanelState: (
    panelId: PanelId,
    updates: Partial<PanelWindowState>
  ) => void;

  /**
   * 关闭面板
   * 将面板模式设置为 hidden
   */
  closePanel: (panelId: PanelId) => void;

  /**
   * 获取面板状态
   * 返回指定面板的完整状态信息
   */
  getPanelState: (panelId: PanelId) => PanelWindowState | undefined;

  /**
   * 获取指定位置的所有面板
   * 返回在指定停靠区域且模式为 docked 的所有面板
   * 支持新的分区位置和传统位置（向后兼容）
   */
  getPanelsByLocation: (location: PanelLocation | LegacyPanelLocation) => PanelWindowState[];

  /**
   * 注册面板
   * 向系统中注册新的面板配置
   */
  registerPanel: (config: PanelConfig) => void;

  /**
   * 批量注册面板
   * 一次性注册多个面板配置
   */
  registerPanels: (configs: PanelConfig[]) => void;

  /**
   * 注销面板
   * 从系统中移除面板配置
   */
  unregisterPanel: (panelId: PanelId) => void;

  /**
   * 获取面板配置
   * 返回指定面板的配置信息
   */
  getPanelConfig: (panelId: PanelId) => PanelConfig | undefined;

  /**
   * 获取所有已注册的面板
   * 返回所有已注册的面板配置列表
   */
  getAllPanelConfigs: () => PanelConfig[];
}

/**
 * 完整的 Dock Store 接口
 * 结合状态和方法
 */
export interface DockStore extends DockStoreState, DockStoreActions {}

// ============ 上下文类型 ============

/**
 * Dock Context 值
 * 提供给消费者的上下文数据
 */
export interface DockContextValue extends DockStore {}

// ============ 调试和日志类型 ============

/**
 * 日志级别
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * 日志条目
 */
export interface LogEntry {
  /** 时间戳 */
  timestamp: string;
  /** 日志级别 */
  level: LogLevel;
  /** 日志消息 */
  message: string;
  /** 相关数据 */
  data?: any;
}

// ============ 分区系统接口 ============

/**
 * Dock 分区配置
 * 定义侧边栏中的一个分区（分区是用户可动态创建的垂直区域）
 */
export interface DockPartition {
  /** 分区唯一标识符，格式为 "side-timestamp" 或 "side-index" */
  id: string;
  /** 所属侧边栏 */
  side: "left" | "right";
  /** 从上到下的索引位置（0-based） */
  index: number;
  /** 高度比例（0-1之间），同侧所有分区的 heightRatio 总和应为 1.0 */
  heightRatio: number;
  /** 当前显示的面板ID */
  currentPanelId: PanelId | null;
}

/**
 * 分区管理器状态
 * 管理所有分区的配置和约束
 */
export interface PartitionManagerState {
  /** 左侧边栏的所有分区 */
  leftPartitions: DockPartition[];
  /** 右侧边栏的所有分区 */
  rightPartitions: DockPartition[];
  /** 最小分区高度比例（防止分区过小） */
  minPartitionHeight: number;
  /** 最大分区数量限制 */
  maxPartitionCount: number;
}

// ============ 默认值常量 ============

/**
 * 默认窗口大小
 */
export const DEFAULT_WINDOW_SIZE = {
  width: 400,
  height: 500,
};

/**
 * 默认窗口位置
 */
export const DEFAULT_WINDOW_POSITION = {
  x: 100,
  y: 100,
};

/**
 * 最小窗口尺寸
 */
export const MIN_WINDOW_SIZE = {
  width: 300,
  height: 200,
};

/**
 * 最大窗口尺寸
 */
export const MAX_WINDOW_SIZE = {
  width: 800,
  height: 600,
};

/**
 * 吸附距离阈值（像素）
 * 当窗口距离侧边栏小于此值时显示吸附提示
 */
export const SNAP_THRESHOLD = 120;

/**
 * 默认 z-index 起始值
 */
export const DEFAULT_Z_INDEX = 10;

/**
 * 默认 displayOrder 起始值
 */
export const DEFAULT_DISPLAY_ORDER = 1;

// ============ 分区系统常量 ============

/**
 * 最小分区高度比例（10%）
 */
export const MIN_PARTITION_HEIGHT = 0.1;

/**
 * 最大分区数量
 */
export const MAX_PARTITION_COUNT = 10;

/**
 * 分区边缘检测阈值（像素）
 * 拖拽到距离分区边缘多少像素时触发创建新分区
 */
export const PARTITION_EDGE_THRESHOLD = 50;

/**
 * 侧边栏吸附距离阈值（像素）
 * 拖拽到距离侧边栏多少像素时触发吸附检测
 */
export const SNAP_SIDEBAR_THRESHOLD = 120;

// ============ 扩展 Store 类型（包含侧边栏控制） ============

/**
 * 扩展的 Dock Store 接口（包含侧边栏控制）
 * 结合基础 dock 功能和侧边栏显示控制
 */
export interface DockStoreWithSidebar extends DockStore {
  /** 面板注册表 */
  panelRegistry: PanelRegistry;
  /** 左侧边栏是否打开 */
  leftSidebarOpen: boolean;
  /** 右侧边栏是否打开 */
  rightSidebarOpen: boolean;
  /** 左侧边栏分割比例 (0-1之间，表示上部分的高度占比) - 保留用于向后兼容 */
  leftSidebarSplitRatio: number;
  /** 右侧边栏分割比例 (0-1之间，表示上部分的高度占比) - 保留用于向后兼容 */
  rightSidebarSplitRatio: number;
  /** 左侧栏宽度（像素） */
  leftSidebarWidth: number;
  /** 右侧栏宽度（像素） */
  rightSidebarWidth: number;
  /** 切换左侧边栏显示/隐藏 */
  toggleLeftSidebar: () => void;
  /** 切换右侧边栏显示/隐藏 */
  toggleRightSidebar: () => void;
  /** 设置左侧边栏分割比例 */
  setLeftSidebarSplitRatio: (ratio: number) => void;
  /** 设置右侧边栏分割比例 */
  setRightSidebarSplitRatio: (ratio: number) => void;
  /** 设置左侧栏宽度 */
  setLeftSidebarWidth: (width: number) => void;
  /** 设置右侧栏宽度 */
  setRightSidebarWidth: (width: number) => void;
  /** 高亮的面板ID（用于菜单点击反馈） */
  highlightedPanelId: PanelId | null;
  /** 设置高亮面板ID */
  setHighlightedPanelId: (panelId: PanelId | null) => void;

  // ============ 动态分区系统 ============

  /** 左侧边栏的所有分区 */
  leftPartitions: DockPartition[];
  /** 右侧边栏的所有分区 */
  rightPartitions: DockPartition[];

  /** 创建新分区 */
  createPartition: (side: "left" | "right", atIndex: number) => string;
  /** 删除分区 */
  removePartition: (partitionId: string) => void;
  /** 调整分区高度 */
  adjustPartitionHeight: (partitionId: string, newRatio: number) => void;
  /** 合并相邻分区 */
  mergePartitions: (sourceId: string, targetId: string) => void;
  /** 清理空分区 */
  cleanupEmptyPartitions: (side: "left" | "right") => void;

  /** 将面板分配到分区 */
  assignPanelToPartition: (panelId: PanelId, partitionId: string) => void;
  /** 获取分区中的所有面板 */
  getPanelsInPartition: (partitionId: string) => PanelWindowState[];
  /** 根据面板获取其所在分区 */
  getPartitionByPanel: (panelId: PanelId) => DockPartition | null;

  /** 从固定区域迁移到动态分区 */
  migrateFromFixedAreas: () => void;
  /** 获取传统位置对应的分区ID */
  getPartitionIdByLegacyLocation: (location: LegacyPanelLocation) => PartitionLocation;
}
