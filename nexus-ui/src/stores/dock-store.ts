/**
 * Dock Store - 独立的面板管理系统
 *
 * 这个文件包含完整的 dock 面板管理逻辑
 * 从 app-store.ts 中提取并增强，支持面板注册系统
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  PanelId,
  PanelLocation,
  PanelMode,
  PanelWindowState,
  PanelConfig,
  PanelRegistry,
  DockStore,
  DockStoreWithSidebar,
} from "@/components/dock/types";
import {
  DEFAULT_WINDOW_SIZE,
  DEFAULT_WINDOW_POSITION,
  DEFAULT_Z_INDEX,
  DEFAULT_DISPLAY_ORDER,
  DockPartition,
  LegacyPanelLocation,
  PartitionLocation,
  MIN_PARTITION_HEIGHT,
  MAX_PARTITION_COUNT,
} from "@/components/dock/types";
import { getDockableWindows } from "@/components/dock/windowRegistry";
import { createEoElectroOpticalDefaultPanelStates } from "@/lib/eo-video/eoElectroOpticalDockPool";
import type { DockLayoutSnapshot } from "@/lib/dock/dock-layout-snapshot";
import {
  DEFAULT_CLASSIC_SPLIT_RATIOS,
  MIN_CLASSIC_RATIO,
  CLASSIC_RIGHT_DEFAULT_ROW_RATIO,
  classicRightWidthFromRow,
  classicRightRowRatioFromWidth,
  clampClassicRightWidth,
  clampClassicRightRowRatio,
  type ClassicSplitRatios,
} from "@/lib/layout/classic-layout-config";
import { adjustAdjacentRatios } from "@/lib/layout/adjust-split-ratios";

const DOCK_LAYOUT_STORAGE_KEY = "nexus-dock-layout-v1";
const DEFAULT_LEFT_SIDEBAR_WIDTH = 300;
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 440;

// 重新导出常用类型，方便其他文件使用
export type { PanelId, PanelLocation, PanelMode, PanelWindowState, DockStoreWithSidebar };
export type { DockPartition };

// ============ 调试日志配置 ============

/**
 * 调试模式开关
 * 设置为 true 启用详细日志输出
 */
const DOCK_DEBUG = true;

/**
 * 日志输出函数
 * @param level 日志级别
 * @param message 日志消息
 * @param data 相关数据
 */
function log(level: "debug" | "info" | "warn" | "error", message: string, data?: any) {
  if (!DOCK_DEBUG) return;

  const timestamp = new Date().toISOString();
  const prefix = `[DockStore ${timestamp}]`;

  switch (level) {
    case "debug":
      console.debug(prefix, message, data || "");
      break;
    case "info":
      console.info(prefix, message, data || "");
      break;
    case "warn":
      console.warn(prefix, message, data || "");
      break;
    case "error":
      console.error(prefix, message, data || "");
      break;
  }
}

// ============ 初始面板状态 ============

/**
 * 默认面板配置
 * 定义系统中所有可用的面板及其初始状态
 */
const DEFAULT_LEFT_PARTITIONS: DockPartition[] = [
  {
    id: "left-0",
    side: "left",
    index: 0,
    heightRatio: 0.5,
    currentPanelId: "tracks",
  },
  {
    id: "left-1",
    side: "left",
    index: 1,
    heightRatio: 0.5,
    currentPanelId: "electro-optical-1",
  },
];

function createDefaultEoPanelStates(): PanelWindowState[] {
  return createEoElectroOpticalDefaultPanelStates().map((p) =>
    p.id === "electro-optical-1"
      ? { ...p, location: "left-1", mode: "docked" as const }
      : p,
  );
}

const DEFAULT_PANELS: PanelWindowState[] = [
  // 左侧四工具共用一个分区 left-0，由分区 currentPanelId 切换
  {
    id: "tracks",
    location: "left-0",
    mode: "docked",
    position: { x: 100, y: 100 },
    size: { width: 360, height: 400 },
    zIndex: DEFAULT_Z_INDEX,
    lastPopupPosition: null,
    displayOrder: 1,
  },
  {
    id: "assets",
    location: "left-0",
    mode: "docked",
    position: { x: 200, y: 200 },
    size: { width: 360, height: 400 },
    zIndex: DEFAULT_Z_INDEX,
    lastPopupPosition: null,
    displayOrder: 2,
  },
  {
    id: "layers",
    location: "left-0",
    mode: "docked",
    position: { x: 250, y: 200 },
    size: { width: 360, height: 400 },
    zIndex: DEFAULT_Z_INDEX,
    lastPopupPosition: null,
    displayOrder: 3,
  },
  {
    id: "alerts",
    location: "left-0",
    mode: "docked",
    position: { x: 300, y: 200 },
    size: { width: 360, height: 400 },
    zIndex: DEFAULT_Z_INDEX,
    lastPopupPosition: null,
    displayOrder: 4,
  },
  {
    id: "track-display",
    location: "left-0",
    mode: "docked",
    position: { x: 310, y: 210 },
    size: { width: 360, height: 400 },
    zIndex: DEFAULT_Z_INDEX,
    lastPopupPosition: null,
    displayOrder: 5,
  },
  {
    id: "electro-optical",
    location: null,
    mode: "hidden",
    position: { x: 300, y: 300 },
    size: { width: 360, height: 400 },
    zIndex: DEFAULT_Z_INDEX,
    lastPopupPosition: null,
    displayOrder: 6,
  },
  ...createDefaultEoPanelStates(),
  {
    id: "target-profile",
    location: "right-0",
    mode: "docked",
    position: { x: 520, y: 80 },
    size: { width: 440, height: 360 },
    zIndex: DEFAULT_Z_INDEX,
    lastPopupPosition: null,
    displayOrder: 5,
  },
  {
    id: "system-evaluation",
    location: "right-1",
    mode: "docked",
    position: { x: 520, y: 420 },
    size: { width: 440, height: 520 },
    zIndex: DEFAULT_Z_INDEX,
    lastPopupPosition: null,
    displayOrder: 6,
  },
  {
    id: "chat",
    location: "right-1",
    mode: "docked",
    position: { x: 500, y: 100 },
    size: { width: 440, height: 400 },
    zIndex: DEFAULT_Z_INDEX,
    lastPopupPosition: null,
    displayOrder: 7,
  },
  {
    id: "knowledge-base",
    location: "right-1",
    mode: "docked",
    position: { x: 500, y: 200 },
    size: { width: 440, height: 400 },
    zIndex: DEFAULT_Z_INDEX,
    lastPopupPosition: null,
    displayOrder: 8,
  },
  {
    id: "overview",
    location: null,
    mode: "hidden",
    position: { x: 600, y: 200 },
    size: { width: 440, height: 400 },
    zIndex: DEFAULT_Z_INDEX,
    lastPopupPosition: null,
    displayOrder: 7,
  },
  {
    id: "eventlog",
    location: null,
    mode: "hidden",
    position: { x: 650, y: 250 },
    size: { width: 440, height: 400 },
    zIndex: DEFAULT_Z_INDEX,
    lastPopupPosition: null,
    displayOrder: 8,
  },
  {
    id: "comm",
    location: null,
    mode: "hidden",
    position: { x: 700, y: 300 },
    size: { width: 440, height: 400 },
    zIndex: DEFAULT_Z_INDEX,
    lastPopupPosition: null,
    displayOrder: 9,
  },
];

/** 出厂默认布局（恢复「默认布局」时使用） */
export const DOCK_INITIAL_LAYOUT_SNAPSHOT: DockLayoutSnapshot = {
  panels: structuredClone(DEFAULT_PANELS),
  activePanelId: null,
  nextZIndex: 100,
  leftUpperPanelTab: "tracks",
  leftLowerPanelTab: "electro-optical-1",
  rightUpperPanelTab: "target-profile",
  rightLowerPanelTab: "chat",
  leftPartitions: structuredClone(DEFAULT_LEFT_PARTITIONS),
  rightPartitions: [
    {
      id: "right-0",
      side: "right",
      index: 0,
      heightRatio: 1 / 3,
      currentPanelId: "target-profile",
    },
    {
      id: "right-1",
      side: "right",
      index: 1,
      heightRatio: 2 / 3,
      currentPanelId: "chat",
    },
  ],
  leftSidebarOpen: true,
  rightSidebarOpen: true,
  leftSidebarSplitRatio: 0.5,
  rightSidebarSplitRatio: 1 / 3,
  leftSidebarWidth: DEFAULT_LEFT_SIDEBAR_WIDTH,
  rightSidebarWidth: DEFAULT_RIGHT_SIDEBAR_WIDTH,
};

export function getDockInitialLayoutSnapshot(): DockLayoutSnapshot {
  return structuredClone(DOCK_INITIAL_LAYOUT_SNAPSHOT);
}

/** 旧版 cleanupEmptyPartitions 曾写入 left-default；UI 与菜单均认 left-0/right-0 */
function defaultEmptyPartitionId(side: "left" | "right"): PartitionLocation {
  return `${side}-0` as PartitionLocation;
}

function normalizeLegacyPartitionId(id: string, side: "left" | "right"): string {
  if (id === `${side}-default`) return defaultEmptyPartitionId(side);
  return id;
}

function normalizePartitionsOnRehydrate(
  partitions: DockPartition[],
  side: "left" | "right",
): DockPartition[] {
  return partitions.map((p) => ({
    ...p,
    id: normalizeLegacyPartitionId(p.id, side) as PartitionLocation,
  }));
}

function normalizeSidePartitionsOnRehydrate(
  partitions: DockPartition[],
  side: "left" | "right",
): DockPartition[] {
  let next = normalizePartitionsOnRehydrate(partitions, side);
  if (next.length === 1 && next[0].currentPanelId === null) {
    const defaults = defaultPartitionsWhenAllEmpty(side);
    if (defaults.length > 1) {
      next = defaults;
    }
  }
  return next;
}

function defaultPartitionsWhenAllEmpty(side: "left" | "right"): DockPartition[] {
  const snap = getDockInitialLayoutSnapshot();
  const source = side === "left" ? snap.leftPartitions : snap.rightPartitions;
  return source.map((p) => ({ ...p, currentPanelId: null }));
}

/** 确保目标分区 id 存在于该侧（含从出厂布局补回 right-1 等） */
function ensurePartitionsIncludeTarget(
  partitions: DockPartition[],
  side: "left" | "right",
  partitionId: string,
): DockPartition[] {
  const normalized = normalizeLegacyPartitionId(partitionId, side) as PartitionLocation;
  let next: DockPartition[] = partitions.map((p) => ({
    ...p,
    id: normalizeLegacyPartitionId(p.id, side) as PartitionLocation,
  }));

  if (next.some((p) => p.id === normalized)) {
    return next;
  }

  const snap = getDockInitialLayoutSnapshot();
  const defaults = side === "left" ? snap.leftPartitions : snap.rightPartitions;
  const template = defaults.find((p) => p.id === normalized);

  if (
    next.length === 1 &&
    next[0].currentPanelId === null &&
    defaults.some((p) => p.id === normalized)
  ) {
    next = defaultPartitionsWhenAllEmpty(side);
    if (next.some((p) => p.id === normalized)) {
      return next;
    }
  }

  if (template) {
    next = [...next, { ...template, currentPanelId: null }].sort((a, b) => a.index - b.index);
  }

  return next;
}

// ============ Store 创建 ============

/**
 * 使用 Zustand 创建 Dock Store（包含侧边栏控制）
 */
export const useDockStore = create<DockStoreWithSidebar>()(
  persist((set, get) => ({
  // ============ 初始状态 ============

  /** 所有面板的状态列表 */
  panels: DEFAULT_PANELS,

  /** 当前激活的面板 ID */
  activePanelId: null,

  /** 下一个可用的 z-index 值 */
  nextZIndex: 100,

  /** 左上区域当前显示的面板 */
  leftUpperPanelTab: "tracks",

  /** 左下区域当前显示的面板 */
  leftLowerPanelTab: "electro-optical-1",

  /** 右上区域当前显示的面板 */
  rightUpperPanelTab: "target-profile",

  /** 右下区域当前显示的面板（系统评估 + 智能助手） */
  rightLowerPanelTab: "chat",

  // ============ 动态分区系统状态 ============

  /** 左侧边栏：上目标列表、下光电窗口 */
  leftPartitions: structuredClone(DEFAULT_LEFT_PARTITIONS),

  /** 右侧边栏：上目标档案、下系统评估 + 智能助手 */
  rightPartitions: [
    {
      id: "right-0",
      side: "right",
      index: 0,
      heightRatio: 1 / 3,
      currentPanelId: "target-profile",
    },
    {
      id: "right-1",
      side: "right",
      index: 1,
      heightRatio: 2 / 3,
      currentPanelId: "chat",
    },
  ],

  /** 面板注册表 */
  panelRegistry: (() => {
    // 从windowRegistry初始化面板注册表
    const registry: PanelRegistry = {};
    getDockableWindows().forEach((windowConfig) => {
      registry[windowConfig.id] = {
        id: windowConfig.id,
        title: windowConfig.title,
        icon: windowConfig.icon!,
        component: windowConfig.component,
        defaultLocation: windowConfig.defaultLocation || null,
        defaultSize: windowConfig.defaultSize,
        closable: windowConfig.closable ?? true,
        draggable: windowConfig.draggable ?? true,
        resizable: windowConfig.resizable ?? true,
      };
    });
    return registry;
  })(),

  /** 高亮的面板ID（用于菜单点击反馈） */
  highlightedPanelId: null,

  /** 工作区布局模式 */
  layoutMode: "free" as const,

  /** 切换到经典布局前保存的自由布局 */
  freeLayoutSnapshot: null as DockLayoutSnapshot | null,

  /** 经典布局区域比例 */
  classicSplitRatios: structuredClone(DEFAULT_CLASSIC_SPLIT_RATIOS),

  /** 经典布局：右侧栏占地图+右侧行的宽度比（默认各一半） */
  classicRightWidthRatio: CLASSIC_RIGHT_DEFAULT_ROW_RATIO,

  setClassicRightWidthRatio: (ratio: number) => {
    set({ classicRightWidthRatio: clampClassicRightRowRatio(ratio) });
  },

  setClassicSplitRatio: (key: keyof ClassicSplitRatios, value: number) => {
    const min = MIN_CLASSIC_RATIO;
    const max = 1 - min;
    const clamped = Math.max(min, Math.min(max, value));
    set((state) => ({
      classicSplitRatios: { ...state.classicSplitRatios, [key]: clamped },
    }));
  },

  adjustClassicEoSubHeight: (dividerIndex: 0 | 1, newLeadingRatio: number) => {
    set((state) => {
      const next = adjustAdjacentRatios(
        [...state.classicSplitRatios.eoSubRatios],
        dividerIndex,
        newLeadingRatio,
        MIN_CLASSIC_RATIO,
      );
      return {
        classicSplitRatios: {
          ...state.classicSplitRatios,
          eoSubRatios: next as ClassicSplitRatios["eoSubRatios"],
        },
      };
    });
  },

  // ============ 侧边栏控制状态 ============

  // ============ 侧边栏控制状态 ============

  /** 左侧边栏是否打开 */
  leftSidebarOpen: true,

  /** 右侧边栏是否打开 */
  rightSidebarOpen: true,

  /** 左侧边栏分割比例初始值 (0.5 = 上下各50%) */
  leftSidebarSplitRatio: 0.5,

  /** 右侧边栏分割比例：上分区高度占比（目标档案 ≈1/3） */
  rightSidebarSplitRatio: 1 / 3,

  /** 左侧栏宽度 */
  leftSidebarWidth: DEFAULT_LEFT_SIDEBAR_WIDTH,

  /** 右侧栏宽度 */
  rightSidebarWidth: DEFAULT_RIGHT_SIDEBAR_WIDTH,

  // ============ 面板点击处理 ============

  /**
   * 统一的点击处理器
   * 根据面板当前状态决定行为：
   * - hidden -> docked: 显示并停靠
   * - docked + 当前显示 -> popup: 弹出为窗口
   * - docked + 非当前显示 -> 切换为当前显示
   * - popup -> 无操作
   */
  handlePanelClick: (panelId: PanelId) => {
    log("debug", `handlePanelClick called for panel: ${panelId}`);

    const state = get();
    const panel = state.panels.find((p) => p.id === panelId);

    if (!panel) {
      log("warn", `Panel not found: ${panelId}`);
      return;
    }

    // 如果面板在popup模式，不执行任何操作
    if (panel.mode === "popup") {
      log("debug", `Panel ${panelId}: already popup, no action`);
      return;
    }

    // 如果面板在hidden模式，显示并停靠
    if (panel.mode === "hidden") {
      log("info", `Panel ${panelId}: hidden -> docked`);

      // 如果面板没有location，使用默认位置
      const location = panel.location || "left-0";

      const updatedPanel = {
        ...panel,
        mode: "docked" as const,
        location,
      };

      set({
        panels: state.panels.map((p) =>
          p.id === panelId ? updatedPanel : p
        ),
      });

      // 更新分区的当前面板
      if (location) {
        const side = location.startsWith("left") ? "left" : "right";
        const partitionsKey = side === "left" ? "leftPartitions" : "rightPartitions";
        const partitions = state[partitionsKey];

        const targetPartition = partitions.find(p => p.id === location);
        if (targetPartition) {
          const updatedPartitions = partitions.map(p =>
            p.id === location ? { ...p, currentPanelId: panelId } : p
          );
          set({ [partitionsKey]: updatedPartitions });
        }
      }

      return;
    }

    // 面板在docked模式
    if (panel.mode === "docked" && panel.location) {
      // 查找面板所在的分区
      const side = panel.location.startsWith("left") ? "left" : "right";
      const partitionsKey = side === "left" ? "leftPartitions" : "rightPartitions";
      const partitions = state[partitionsKey];

      const targetPartition = partitions.find(p => p.id === panel.location);
      if (!targetPartition) {
        log("warn", `Partition not found for panel: ${panelId}`);
        return;
      }

      // 判断该面板是否是分区的当前显示面板
      const isCurrentDisplayed = targetPartition.currentPanelId === panelId;

      if (isCurrentDisplayed) {
        // docked + 当前显示 -> popup: 弹出为窗口
        log("info", `Panel ${panelId}: docked -> popup`);

        // 找到该分区的其他面板，将第一个设为当前显示
        const partitionPanels = state.panels.filter(
          (p) => p.location === panel.location &&
                p.id !== panelId &&
                p.mode === "docked"
        );
        const nextPanel = partitionPanels[0];

        // 更新分区状态
        const updatedPartitions = partitions.map(p =>
          p.id === panel.location
            ? { ...p, currentPanelId: nextPanel?.id || null }
            : p
        );

        // 更新面板状态
        const updatedPanel = {
          ...panel,
          mode: "popup" as const,
          location: null,
          position: panel.lastPopupPosition || panel.position,
          zIndex: state.nextZIndex,
        };

        set({
          [partitionsKey]: updatedPartitions,
          panels: state.panels.map((p) =>
            p.id === panelId ? updatedPanel : p
          ),
          activePanelId: panelId,
          nextZIndex: state.nextZIndex + 1,
        });

        // 清理空分区
        state.cleanupEmptyPartitions(side);
      } else {
        // docked + 非当前显示 -> 切换为当前显示
        log("info", `Panel ${panelId}: switching to current display`);

        // 更新分区的当前面板
        const updatedPartitions = partitions.map(p =>
          p.id === panel.location ? { ...p, currentPanelId: panelId } : p
        );

        set({ [partitionsKey]: updatedPartitions });
      }
    }
  },

  // ============ 面板吸附 ============

  /**
   * 吸附面板到指定区域
   */
  snapPanelToArea: (panelId: PanelId, area: PanelLocation) => {
    log("info", `Snapping panel ${panelId} to area ${area}`);

    const state = get();
    const panel = state.panels.find((p) => p.id === panelId);

    if (!panel) {
      log("warn", `Cannot snap: panel not found: ${panelId}`);
      return;
    }

    // 计算新的 displayOrder
    const maxDisplayOrder = Math.max(
      ...state.panels.map((p) => p.displayOrder || 0),
      0
    );

    const updatedPanel = {
      ...panel,
      location: area,
      mode: "docked" as PanelMode,
      displayOrder: maxDisplayOrder + 1,
    };

    // 判断是左侧还是右侧区域
    const isLeftArea = area === "left-0" || area === "left-1";
    const isRightArea = area === "right-0" || area === "right-1";

    // 更新对应区域的当前显示面板
    const update: Partial<Record<string, any>> = {};
    if (area === "left-0") {
      update.leftUpperPanelTab = panelId;
    } else if (area === "left-1") {
      update.leftLowerPanelTab = panelId;
    } else if (area === "right-0") {
      update.rightUpperPanelTab = panelId;
    } else if (area === "right-1") {
      update.rightLowerPanelTab = panelId;
    }

    set({
      ...update,
      panels: state.panels.map((p) => (p.id === panelId ? updatedPanel : p)),
      activePanelId: null,
    });

    log("debug", `Panel ${panelId} snapped successfully`);
  },

  // ============ 窗口层级管理 ============

  /**
   * 将面板提升到最前层
   */
  bringToFront: (panelId: PanelId) => {
    log("debug", `Bringing panel ${panelId} to front`);

    const state = get();

    set({
      panels: state.panels.map((p) =>
        p.id === panelId ? { ...p, zIndex: state.nextZIndex } : p
      ),
      activePanelId: panelId,
      nextZIndex: state.nextZIndex + 1,
    });
  },

  // ============ 面板状态更新 ============

  /**
   * 更新面板状态
   */
  updatePanelState: (
    panelId: PanelId,
    updates: Partial<PanelWindowState>
  ) => {
    log("debug", `Updating panel ${panelId} state`, updates);

    const state = get();

    set({
      panels: state.panels.map((p) =>
        p.id === panelId ? { ...p, ...updates } : p
      ),
    });
  },

  // ============ 面板关闭 ============

  /**
   * 关闭面板
   */
  closePanel: (panelId: PanelId) => {
    log("info", `Closing panel ${panelId}`);

    const state = get();
    const panel = state.panels.find((p) => p.id === panelId);
    const location = panel?.location;

    // If this panel is currently docked in a partition, clear the partition display slot.
    if (location) {
      const side = location.startsWith("left") ? "left" : "right";
      const partitionsKey = side === "left" ? "leftPartitions" : "rightPartitions";
      const partitions = state[partitionsKey];
      const updatedPartitions = partitions.map((p) =>
        p.id === location && p.currentPanelId === panelId ? { ...p, currentPanelId: null } : p
      );
      set({ [partitionsKey]: updatedPartitions });
      get().cleanupEmptyPartitions(side);
    }

    set({
      panels: state.panels.map((p) =>
        p.id === panelId
          ? { ...p, mode: "hidden" as PanelMode, location: null }
          : p
      ),
      activePanelId: state.activePanelId === panelId ? null : state.activePanelId,
    });
  },

  // ============ 查询方法 ============

  /**
   * 获取面板状态
   */
  getPanelState: (panelId: PanelId) => {
    const state = get();
    const panel = state.panels.find((p) => p.id === panelId);
    log("debug", `Getting state for panel ${panelId}`, panel);
    return panel;
  },

  /**
   * 获取指定位置的所有面板
   * 支持新的分区位置和传统位置（向后兼容）
   */
  getPanelsByLocation: (location: PanelLocation | LegacyPanelLocation) => {
    const state = get();
    if (!state.panels) {
      log("warn", `No panels found in state`);
      return [];
    }

    // 如果是传统位置，转换为新的分区位置
    let targetLocation: PanelLocation | null = location as PanelLocation;
    const legacyLocationMap: Record<LegacyPanelLocation, PartitionLocation> = {
      "left-top": "left-0",
      "left-bottom": "left-1",
      "right-top": "right-0",
      "right-bottom": "right-1",
    };

    if (legacyLocationMap[location as LegacyPanelLocation]) {
      targetLocation = legacyLocationMap[location as LegacyPanelLocation];
    }

    const panels = state.panels.filter(
      (p) => p.location === targetLocation && p.mode === "docked"
    );
    log("debug", `Getting panels for location ${location}`, panels);
    return panels;
  },

  // ============ 面板注册管理 ============

  /**
   * 注册单个面板
   */
  registerPanel: (config: PanelConfig) => {
    log("info", `Registering panel: ${config.id}`);

    const state = get();

    // 添加到注册表
    const updatedRegistry = {
      ...state.panelRegistry,
      [config.id]: config,
    };

    // 检查是否需要添加到 panels 列表
    const existingPanel = state.panels.find((p) => p.id === config.id);
    if (!existingPanel) {
      // 创建新的面板状态
      const newPanel: PanelWindowState = {
        id: config.id,
        location: config.defaultLocation as PanelLocation, // 类型转换以支持传统和现代格式
        mode: "docked",
        position: DEFAULT_WINDOW_POSITION,
        size: config.defaultSize || DEFAULT_WINDOW_SIZE,
        zIndex: DEFAULT_Z_INDEX,
        lastPopupPosition: null,
        displayOrder: DEFAULT_DISPLAY_ORDER,
      };

      set({
        panelRegistry: updatedRegistry,
        panels: [...state.panels, newPanel],
      });

      log("debug", `Panel ${config.id} registered and added to panels list`);
    } else {
      set({ panelRegistry: updatedRegistry });
      log("debug", `Panel ${config.id} registered (already exists in panels)`);
    }
  },

  /**
   * 批量注册面板
   */
  registerPanels: (configs: PanelConfig[]) => {
    log("info", `Batch registering ${configs.length} panels`);

    configs.forEach((config) => {
      const state = get();
      state.registerPanel(config);
    });
  },

  /**
   * 注销面板
   */
  unregisterPanel: (panelId: PanelId) => {
    log("info", `Unregistering panel: ${panelId}`);

    const state = get();

    // 从注册表中移除
    const updatedRegistry = { ...state.panelRegistry };
    delete updatedRegistry[panelId];

    // 从 panels 列表中移除
    set({
      panelRegistry: updatedRegistry,
      panels: state.panels.filter((p) => p.id !== panelId),
    });

    log("debug", `Panel ${panelId} unregistered`);
  },

  /**
   * 获取面板配置
   */
  getPanelConfig: (panelId: PanelId) => {
    const state = get();
    const config = state.panelRegistry[panelId];
    log("debug", `Getting config for panel ${panelId}`, config);
    return config;
  },

  /**
   * 获取所有已注册的面板
   */
  getAllPanelConfigs: () => {
    const state = get();
    const configs = Object.values(state.panelRegistry);
    log("debug", `Getting all panel configs`, configs);
    return configs;
  },

  // ============ 侧边栏控制方法 ============

  /**
   * 切换左侧边栏显示/隐藏
   */
  toggleLeftSidebar: () => {
    set((s) => {
      const newState = !s.leftSidebarOpen;
      log("debug", `Toggling left sidebar: ${s.leftSidebarOpen} -> ${newState}`);
      return { leftSidebarOpen: newState };
    });
  },

  /**
   * 切换右侧边栏显示/隐藏
   */
  toggleRightSidebar: () => {
    set((s) => {
      const newState = !s.rightSidebarOpen;
      log("debug", `Toggling right sidebar: ${s.rightSidebarOpen} -> ${newState}`);
      return { rightSidebarOpen: newState };
    });
  },

  /**
   * 设置左侧边栏分割比例
   */
  setLeftSidebarSplitRatio: (ratio: number) => {
    const constrainedRatio = Math.max(0.2, Math.min(0.8, ratio));
    log("debug", `Setting left sidebar split ratio: ${constrainedRatio}`);
    set({ leftSidebarSplitRatio: constrainedRatio });
  },

  /**
   * 设置右侧边栏分割比例
   */
  setRightSidebarSplitRatio: (ratio: number) => {
    const constrainedRatio = Math.max(0.2, Math.min(0.8, ratio));
    log("debug", `Setting right sidebar split ratio: ${constrainedRatio}`);
    set({ rightSidebarSplitRatio: constrainedRatio });
  },

  setLeftSidebarWidth: (width: number) => {
    const constrained = Math.max(220, Math.min(720, Math.round(width)));
    set({ leftSidebarWidth: constrained });
  },

  setRightSidebarWidth: (width: number, opts?: { containerWidth?: number }) => {
    const state = get();
    if (state.layoutMode === "classic") {
      const rowWidth = opts?.containerWidth ?? (typeof window !== "undefined" ? window.innerWidth : 1920);
      const clampedPx = clampClassicRightWidth(width, rowWidth);
      const ratio = classicRightRowRatioFromWidth(rowWidth, clampedPx);
      set({
        rightSidebarWidth: clampedPx,
        classicRightWidthRatio: ratio,
      });
      return;
    }
    const constrained = Math.max(320, Math.min(720, Math.round(width)));
    set({ rightSidebarWidth: constrained });
  },

  setHighlightedPanelId: (panelId: PanelId | null) => {
    set({ highlightedPanelId: panelId });
  },

  // ============ 动态分区系统方法 ============

  /**
   * 创建新分区
   * 在指定侧边栏的指定位置创建新分区，并从相邻分区"挤"出空间
   * @returns 新创建的分区ID
   */
  createPartition: (side: "left" | "right", atIndex: number): string => {
    log("info", `Creating partition on ${side} side at index ${atIndex}`);

    const state = get();
    const partitionsKey = side === "left" ? "leftPartitions" : "rightPartitions";
    const partitions = state[partitionsKey];

    // 验证约束
    if (partitions.length >= MAX_PARTITION_COUNT) {
      log("warn", `Cannot create partition: maximum count (${MAX_PARTITION_COUNT}) reached`);
      return "";
    }

    // 计算新分区的高度（从现有分区按比例分配）
    const newHeightRatio = 1 / (partitions.length + 1);

    // 创建新分区
    const newPartition: DockPartition = {
      id: `${side}-${Date.now()}`,
      side,
      index: atIndex,
      heightRatio: newHeightRatio,
      currentPanelId: null,
    };

    // 调整现有分区的高度和索引
    const adjustedPartitions = partitions.map((p, i) => ({
      ...p,
      index: i >= atIndex ? i + 1 : i,
      heightRatio: p.heightRatio * (1 - newHeightRatio),
    }));

    // 插入新分区
    adjustedPartitions.splice(atIndex, 0, newPartition);

    // 验证高度总和
    const totalRatio = adjustedPartitions.reduce((sum, p) => sum + p.heightRatio, 0);
    if (Math.abs(totalRatio - 1.0) > 0.001) {
      log("error", `Partition height ratio sum is ${totalRatio}, expected 1.0`);
    }

    set({ [partitionsKey]: adjustedPartitions });
    log("debug", `Partition created successfully: ${newPartition.id}`);

    return newPartition.id;
  },

  /**
   * 清理空分区
   * 自动删除没有显示面板的分区，释放空间给其他分区
   * 当分区的 currentPanelId 为 null 时，该分区会被删除
   */
  cleanupEmptyPartitions: (side: "left" | "right") => {
    log("info", `Cleaning up empty partitions on ${side} side`);

    const state = get();
    const partitionsKey = side === "left" ? "leftPartitions" : "rightPartitions";
    const partitions = state[partitionsKey];

    // 找出所有有面板的分区
    const nonEmptyPartitions = partitions.filter(p => p.currentPanelId !== null);

    // 如果没有空分区，直接返回
    if (nonEmptyPartitions.length === partitions.length) {
      log("debug", `No empty partitions to clean up on ${side} side`);
      return;
    }

    // 如果所有分区都空了，保留一个空分区
    if (nonEmptyPartitions.length === 0) {
      log("debug", `All partitions are empty, restoring default partition layout on ${side} side`);
      set({ [partitionsKey]: defaultPartitionsWhenAllEmpty(side) });
      return;
    }

    // 重新分配有面板的分区的高度
    const newCount = nonEmptyPartitions.length;
    const adjustedPartitions = nonEmptyPartitions.map((p, i) => ({
      ...p,
      index: i,
      heightRatio: p.heightRatio / nonEmptyPartitions.reduce((sum, partition) => sum + partition.heightRatio, 0),
    }));

    // 归一化高度比例（确保总和为1.0）
    const totalRatio = adjustedPartitions.reduce((sum, p) => sum + p.heightRatio, 0);
    const normalizedPartitions = adjustedPartitions.map(p => ({
      ...p,
      heightRatio: p.heightRatio / totalRatio,
    }));

    set({ [partitionsKey]: normalizedPartitions });
    log("debug", `Cleaned up empty partitions on ${side} side, remaining: ${normalizedPartitions.length}`);
  },

  /**
   * 删除分区
   * 删除指定分区并将其空间分配给相邻分区
   */
  removePartition: (partitionId: string) => {
    log("info", `Removing partition: ${partitionId}`);

    const state = get();
    const side = partitionId.startsWith("left") ? "left" : "right";
    const partitionsKey = side === "left" ? "leftPartitions" : "rightPartitions";
    const partitions = state[partitionsKey];

    // 防止删除最后一个分区
    if (partitions.length <= 1) {
      log("warn", "Cannot remove the last partition");
      return;
    }

    const targetIndex = partitions.findIndex((p) => p.id === partitionId);
    if (targetIndex === -1) {
      log("warn", `Partition not found: ${partitionId}`);
      return;
    }

    const removedHeight = partitions[targetIndex].heightRatio;

    // 移除目标分区并重新分配空间给最近的分区
    const adjustedPartitions = partitions
      .filter((p) => p.id !== partitionId)
      .map((p, i) => {
        // 将空间分配给最接近删除位置的分区
        if (i === Math.max(0, targetIndex - 1)) {
          return {
            ...p,
            heightRatio: Math.min(1.0, p.heightRatio + removedHeight),
            index: i,
          };
        }
        return { ...p, index: i };
      });

    set({ [partitionsKey]: adjustedPartitions });
    log("debug", `Partition removed successfully: ${partitionId}`);
  },

  /**
   * 调整分区高度
   * 只调整相邻两个分区的高度，保持它们的总和不变
   */
  adjustPartitionHeight: (partitionId: string, newRatio: number) => {
    log("debug", `Adjusting partition ${partitionId} height to ${newRatio}`);

    const state = get();
    const side = partitionId.startsWith("left") ? "left" : "right";
    const partitionsKey = side === "left" ? "leftPartitions" : "rightPartitions";
    const partitions = state[partitionsKey];

    const targetIndex = partitions.findIndex((p) => p.id === partitionId);
    if (targetIndex === -1) {
      log("warn", `Partition not found: ${partitionId}`);
      return;
    }

    // 如果是最后一个分区，不能调整（它下面没有相邻分区）
    if (targetIndex >= partitions.length - 1) {
      log("warn", `Cannot adjust last partition`);
      return;
    }

    const currentPartition = partitions[targetIndex];
    const adjacentPartition = partitions[targetIndex + 1];

    // 计算两个分区的总高度（保持不变）
    const totalRatio = currentPartition.heightRatio + adjacentPartition.heightRatio;

    // 限制新高度在合理范围内
    // 最小高度：MIN_PARTITION_HEIGHT
    // 最大高度：totalRatio - MIN_PARTITION_HEIGHT（给相邻分区留最小空间）
    const constrainedRatio = Math.max(
      MIN_PARTITION_HEIGHT,
      Math.min(totalRatio - MIN_PARTITION_HEIGHT, newRatio)
    );

    // 计算相邻分区的新高度
    const adjacentNewRatio = totalRatio - constrainedRatio;

    // 只更新这两个分区的高度
    const updatedPartitions = partitions.map((p, i) => {
      if (i === targetIndex) {
        return { ...p, heightRatio: constrainedRatio };
      }
      if (i === targetIndex + 1) {
        return { ...p, heightRatio: adjacentNewRatio };
      }
      return p;
    });

    set({ [partitionsKey]: updatedPartitions });
  },

  /**
   * 合并相邻分区
   * 将源分区合并到目标分区
   */
  mergePartitions: (sourceId: string, targetId: string) => {
    log("info", `Merging partition ${sourceId} into ${targetId}`);

    const state = get();
    const side = sourceId.startsWith("left") ? "left" : "right";
    const partitionsKey = side === "left" ? "leftPartitions" : "rightPartitions";
    const partitions = state[partitionsKey];

    const sourceIndex = partitions.findIndex((p) => p.id === sourceId);
    const targetIndex = partitions.findIndex((p) => p.id === targetId);

    if (sourceIndex === -1 || targetIndex === -1) {
      log("warn", "Source or target partition not found");
      return;
    }

    // 计算合并后的高度
    const mergedRatio =
      partitions[sourceIndex].heightRatio + partitions[targetIndex].heightRatio;

    // 移除源分区，更新目标分区高度
    const updatedPartitions = partitions
      .filter((p) => p.id !== sourceId)
      .map((p, i) => {
        if (p.id === targetId) {
          return { ...p, heightRatio: Math.min(1.0, mergedRatio) };
        }
        return { ...p, index: i };
      });

    set({ [partitionsKey]: updatedPartitions });
    log("debug", `Partitions merged successfully`);
  },

  /**
   * 将面板分配到分区
   * 将指定面板移动到目标分区并设为当前显示
   */
  assignPanelToPartition: (panelId: PanelId, partitionId: string) => {
    log("info", `Assigning panel ${panelId} to partition ${partitionId}`);

    const state = get();
    const panel = state.panels.find((p) => p.id === panelId);

    if (!panel) {
      log("warn", `Panel not found: ${panelId}`);
      return;
    }

    const side = partitionId.startsWith("left") ? "left" : "right";
    const partitionsKey = side === "left" ? "leftPartitions" : "rightPartitions";
    const requestedId = normalizeLegacyPartitionId(partitionId, side) as PartitionLocation;
    let partitions = ensurePartitionsIncludeTarget(state[partitionsKey], side, requestedId);

    let resolvedPartitionId = requestedId;
    let targetPartition = partitions.find((p) => p.id === requestedId);
    if (!targetPartition) {
      targetPartition = partitions.find((p) => p.id === defaultEmptyPartitionId(side));
    }
    if (!targetPartition && partitions.length > 0) {
      targetPartition = partitions[0];
    }
    if (!targetPartition) {
      partitions = defaultPartitionsWhenAllEmpty(side);
      targetPartition =
        partitions.find((p) => p.id === requestedId) ?? partitions[0] ?? null;
    }
    if (!targetPartition) {
      log("warn", `No partition available on ${side} for panel ${panelId}`);
      return;
    }
    resolvedPartitionId = targetPartition.id as PartitionLocation;
    if (resolvedPartitionId !== partitionId) {
      log(
        "info",
        `Partition ${partitionId} not found; using ${resolvedPartitionId} for panel ${panelId}`,
      );
    }
    if (partitions !== state[partitionsKey]) {
      set({ [partitionsKey]: partitions });
    }

    // 如果面板之前在另一个分区，需要清理那个分区的 currentPanelId
    const oldPartitionId = panel.location;
    let updatedPartitions = partitions;

    if (oldPartitionId && oldPartitionId !== resolvedPartitionId) {
      const oldSide = oldPartitionId.startsWith("left") ? "left" : "right";
      const oldPartitionsKey = oldSide === "left" ? "leftPartitions" : "rightPartitions";

      // 如果是同一侧，需要清理原分区
      if (oldSide === side) {
        updatedPartitions = partitions.map((p) =>
          p.id === oldPartitionId ? { ...p, currentPanelId: null } : p,
        );
      } else {
        // 如果是不同侧，需要更新另一侧的分区
        const oldPartitions = state[oldPartitionsKey];
        const updatedOldPartitions = oldPartitions.map(p =>
          p.id === oldPartitionId ? { ...p, currentPanelId: null } : p
        );
        set({ [oldPartitionsKey]: updatedOldPartitions });

        // 清理另一侧的空分区
        const tempState = get();
        tempState.cleanupEmptyPartitions(oldSide);
      }
    }

    // 更新面板位置
    const updatedPanels = state.panels.map((p) =>
      p.id === panelId
        ? { ...p, location: resolvedPartitionId as PartitionLocation, mode: "docked" as const }
        : p
    );

    // 更新目标分区的当前面板
    updatedPartitions = updatedPartitions.map((p) =>
      p.id === resolvedPartitionId ? { ...p, currentPanelId: panelId } : p
    );

    set({
      panels: updatedPanels,
      [partitionsKey]: updatedPartitions,
      ...(side === "left" ? { leftSidebarOpen: true } : {}),
      ...(side === "right" ? { rightSidebarOpen: true } : {}),
    });

    // 清理空分区
    const newState = get();
    newState.cleanupEmptyPartitions(side);

    log("debug", `Panel assigned to partition successfully`);
  },

  /**
   * 获取分区中的所有面板
   * 返回指定分区中所有处于docked状态的面板
   */
  getPanelsInPartition: (partitionId: string) => {
    const state = get();
    const panels = state.panels.filter(
      (p) => p.location === partitionId && p.mode === "docked"
    );
    log("debug", `Getting panels in partition ${partitionId}`, panels);
    return panels;
  },

  /**
   * 根据面板获取其所在分区
   * 返回面板当前所在的分区，如果面板不在任何分区则返回null
   */
  getPartitionByPanel: (panelId: PanelId) => {
    const state = get();
    const panel = state.panels.find((p) => p.id === panelId);

    if (!panel || !panel.location) {
      return null;
    }

    const side = (panel.location as string).startsWith("left") ? "left" : "right";
    const partitionsKey = side === "left" ? "leftPartitions" : "rightPartitions";
    const partitions = state[partitionsKey];

    const partition = partitions.find((p) => p.id === panel.location);
    return partition || null;
  },

  /**
   * 从固定区域迁移到动态分区
   * 将现有的固定4区域系统迁移到动态分区系统
   */
  migrateFromFixedAreas: () => {
    log("info", "Migrating from fixed areas to dynamic partitions");

    const state = get();

    // 检查是否已经迁移过
    if (state.leftPartitions.length > 0 || state.rightPartitions.length > 0) {
      log("debug", "Already migrated, skipping");
      return;
    }

    // 创建传统位置到分区位置的映射
    const locationMap: Record<LegacyPanelLocation, PartitionLocation> = {
      "left-top": "left-0",
      "left-bottom": "left-1",
      "right-top": "right-0",
      "right-bottom": "right-1",
    };

    // 创建初始左侧分区
    const leftPartitions: DockPartition[] = [
      {
        id: "left-0",
        side: "left",
        index: 0,
        heightRatio: state.leftSidebarSplitRatio,
        currentPanelId: state.leftUpperPanelTab,
      },
      {
        id: "left-1",
        side: "left",
        index: 1,
        heightRatio: 1 - state.leftSidebarSplitRatio,
        currentPanelId: state.leftLowerPanelTab,
      },
    ];

    // 创建初始右侧分区
    const rightPartitions: DockPartition[] = [
      {
        id: "right-0",
        side: "right",
        index: 0,
        heightRatio: state.rightSidebarSplitRatio,
        currentPanelId: state.rightUpperPanelTab,
      },
      {
        id: "right-1",
        side: "right",
        index: 1,
        heightRatio: 1 - state.rightSidebarSplitRatio,
        currentPanelId: state.rightLowerPanelTab,
      },
    ];

    // 更新面板位置
    const updatedPanels = state.panels.map((p) => {
      if (p.location && locationMap[p.location as LegacyPanelLocation]) {
        return {
          ...p,
          location: locationMap[p.location as LegacyPanelLocation],
        };
      }
      return p;
    });

    set({
      leftPartitions,
      rightPartitions,
      panels: updatedPanels,
    });

    log("debug", "Migration completed successfully");
  },

  /**
   * 获取传统位置对应的分区ID
   * 用于向后兼容，将传统位置名称映射到分区ID
   */
  getPartitionIdByLegacyLocation: (location: LegacyPanelLocation): PartitionLocation => {
    const locationMap: Record<LegacyPanelLocation, PartitionLocation> = {
      "left-top": "left-0",
      "left-bottom": "left-1",
      "right-top": "right-0",
      "right-bottom": "right-1",
    };
    return locationMap[location];
  },
  }), {
    name: DOCK_LAYOUT_STORAGE_KEY,
    storage: createJSONStorage(() => localStorage),
    onRehydrateStorage: () => (state) => {
      if (!state) return;
      const existingIds = new Set(state.panels.map((p) => p.id));
      const missing = DEFAULT_PANELS.filter((p) => !existingIds.has(p.id));
      const leftPartitions = normalizeSidePartitionsOnRehydrate(state.leftPartitions, "left");
      const rightPartitions = normalizeSidePartitionsOnRehydrate(state.rightPartitions, "right");
      const panels = state.panels.map((p) => {
        if (!p.location) return p;
        const side = p.location.startsWith("left")
          ? "left"
          : p.location.startsWith("right")
            ? "right"
            : null;
        if (!side) return p;
        const normalized = normalizeLegacyPartitionId(p.location, side);
        return normalized === p.location ? p : { ...p, location: normalized as PartitionLocation };
      });
      const patch: Partial<DockStoreWithSidebar> = { panels, leftPartitions, rightPartitions };
      if (missing.length > 0) {
        patch.panels = [...panels, ...missing];
      }
      if (!state.classicSplitRatios) {
        patch.classicSplitRatios = structuredClone(DEFAULT_CLASSIC_SPLIT_RATIOS);
      }
      if (state.layoutMode !== "classic" && state.layoutMode !== "free") {
        patch.layoutMode = "free";
      }
      if (state.layoutMode === "classic" && typeof window !== "undefined") {
        const ratio =
          typeof state.classicRightWidthRatio === "number"
            ? clampClassicRightRowRatio(state.classicRightWidthRatio)
            : CLASSIC_RIGHT_DEFAULT_ROW_RATIO;
        const rowEstimate = Math.max(800, window.innerWidth - 48);
        patch.classicRightWidthRatio = ratio;
        patch.rightSidebarWidth = classicRightWidthFromRow(rowEstimate, ratio);
      }
      if (!state.classicRightWidthRatio) {
        patch.classicRightWidthRatio = CLASSIC_RIGHT_DEFAULT_ROW_RATIO;
      }
      useDockStore.setState(patch);
    },
    partialize: (state) => ({
      panels: state.panels,
      activePanelId: state.activePanelId,
      nextZIndex: state.nextZIndex,
      leftUpperPanelTab: state.leftUpperPanelTab,
      leftLowerPanelTab: state.leftLowerPanelTab,
      rightUpperPanelTab: state.rightUpperPanelTab,
      rightLowerPanelTab: state.rightLowerPanelTab,
      leftPartitions: state.leftPartitions,
      rightPartitions: state.rightPartitions,
      leftSidebarOpen: state.leftSidebarOpen,
      rightSidebarOpen: state.rightSidebarOpen,
      leftSidebarSplitRatio: state.leftSidebarSplitRatio,
      rightSidebarSplitRatio: state.rightSidebarSplitRatio,
      leftSidebarWidth: state.leftSidebarWidth,
      rightSidebarWidth: state.rightSidebarWidth,
      layoutMode: state.layoutMode,
      freeLayoutSnapshot: state.freeLayoutSnapshot,
      classicSplitRatios: state.classicSplitRatios,
      classicRightWidthRatio: state.classicRightWidthRatio,
    }),
  })
);

// ============ 导出辅助函数 ============

/**
 * 获取所有面板的状态
 */
export function getAllPanels(): PanelWindowState[] {
  return useDockStore.getState().panels;
}

/**
 * 获取指定面板的状态
 */
export function getPanelState(panelId: PanelId): PanelWindowState | undefined {
  return useDockStore.getState().getPanelState(panelId);
}

/**
 * 获取指定位置的面板
 */
export function getPanelsByLocation(
  location: PanelLocation
): PanelWindowState[] {
  return useDockStore.getState().getPanelsByLocation(location);
}

/**
 * 处理面板点击
 */
export function handlePanelClick(panelId: PanelId): void {
  return useDockStore.getState().handlePanelClick(panelId);
}

/**
 * 吸附面板到区域
 */
export function snapPanelToArea(panelId: PanelId, area: PanelLocation): void {
  return useDockStore.getState().snapPanelToArea(panelId, area);
}

/**
 * 将面板提升到最前
 */
export function bringToFront(panelId: PanelId): void {
  return useDockStore.getState().bringToFront(panelId);
}

/**
 * 更新面板状态
 */
export function updatePanelState(
  panelId: PanelId,
  updates: Partial<PanelWindowState>
): void {
  return useDockStore.getState().updatePanelState(panelId, updates);
}

/**
 * 关闭面板
 */
export function closePanel(panelId: PanelId): void {
  return useDockStore.getState().closePanel(panelId);
}

/**
 * 注册面板
 */
export function registerPanel(config: PanelConfig): void {
  return useDockStore.getState().registerPanel(config);
}

/**
 * 批量注册面板
 */
export function registerPanels(configs: PanelConfig[]): void {
  return useDockStore.getState().registerPanels(configs);
}

/**
 * 注销面板
 */
export function unregisterPanel(panelId: PanelId): void {
  return useDockStore.getState().unregisterPanel(panelId);
}

/**
 * 获取面板配置
 */
export function getPanelConfig(panelId: PanelId): PanelConfig | undefined {
  return useDockStore.getState().getPanelConfig(panelId);
}

/**
 * 获取所有面板配置
 */
export function getAllPanelConfigs(): PanelConfig[] {
  return useDockStore.getState().getAllPanelConfigs();
}

// ============ 自动迁移逻辑 ============

/**
 * 初始化动态分区系统
 * 在应用启动时自动调用，从固定区域迁移到动态分区
 */
/** 将 DEFAULT_PANELS 中尚未出现在持久化布局里的面板补进 panels（如新增 knowledge-base） */
export function mergeMissingDefaultPanels() {
  const state = useDockStore.getState();
  const existingIds = new Set(state.panels.map((p) => p.id));
  const missing = DEFAULT_PANELS.filter((p) => !existingIds.has(p.id));
  if (missing.length === 0) return;
  useDockStore.setState({ panels: [...state.panels, ...missing] });
  log("info", "Merged missing default panels", missing.map((p) => p.id));
}

export function initializePartitionSystem() {
  const state = useDockStore.getState();

  mergeMissingDefaultPanels();

  // 检查是否已经初始化
  if (state.leftPartitions.length === 0 && state.rightPartitions.length === 0) {
    console.log("[DockStore] Initializing partition system...");
    state.migrateFromFixedAreas();
    console.log("[DockStore] Partition system initialized successfully");
  }
}

/**
 * 自动初始化分区系统
 * 这个函数会在模块加载时自动执行
 */
// 延迟执行以确保store已创建
if (typeof window !== "undefined") {
  // 在浏览器环境中延迟初始化
  setTimeout(() => {
    initializePartitionSystem();
  }, 100);
}
