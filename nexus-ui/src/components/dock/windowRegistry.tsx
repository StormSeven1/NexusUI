/**
 * 窗体注册表
 *
 * 按照新的窗体定义系统，集中管理所有窗体的配置
 * 所有窗体都从这里注册，确保统一管理和菜单入口
 */

import {
  WindowConfig,
  WindowCapability,
  WindowCategory,
  PanelId,
} from "./types";
import {
  MapPin,
  Layers,
  Route,
  AlertTriangle,
  Crosshair,
  Eye,
  MessageSquare,
  LayoutDashboard,
  FileText,
  Radio,
  Camera,
  Video,
  Settings,
  Server,
  Activity,
  FileCode,
  Database,
  Map,
  ScanLine,
  Gauge,
} from "lucide-react";
import { TrackListPanel } from "@/components/panels/TrackListPanel";
import { SystemEvaluationPanel } from "@/components/panels/SystemEvaluationPanel";
import { LayerPanel } from "@/components/panels/LayerPanel";
import { AssetPanel } from "@/components/panels/AssetPanel";
import { AlertPanel } from "@/components/panels/AlertPanel";
import { TrackDisplayPanel } from "@/components/panels/TrackDisplayPanel";
import { ChatPanel } from "@/components/panels/ChatPanel";
import { TargetProfilePanel } from "@/components/panels/TargetProfilePanel";
import { EoVideoDockPanel } from "@/components/eo-video/EoVideoDockPanel";

/** 独立面板文件尚未提供时，与「岸基相机」等一致的占位 */
function dockPlaceholder(label: string) {
  return function DockPlaceholderPanel() {
    return <div className="p-4 text-sm text-nexus-text-muted">{label}（待实现）</div>;
  };
}

function eoDockPanel(panelId: PanelId) {
  return function EoDockPanelInstance() {
    return <EoVideoDockPanel panelId={panelId} />;
  };
}

// ============ dockable 窗体注册 ============
/**
 * 可停靠窗体列表
 * 这些窗体具备窗体icon，可以吸附在侧边栏，灵活布局要求高
 */
const DOCKABLE_WINDOWS: WindowConfig[] = [
  // ========== 目标类别 ==========
  {
    id: "tracks",
    title: "目标",
    capability: "dockable",
    category: "target",
    menuLabel: "目标",
    icon: Crosshair,
    component: TrackListPanel,
    defaultLocation: "left-top",
    defaultSize: { width: 360, height: 400 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "航迹与目标列表",
  },
  {
    id: "alerts",
    title: "告警",
    capability: "dockable",
    category: "target",
    menuLabel: "告警",
    icon: AlertTriangle,
    component: AlertPanel,
    defaultLocation: "left-top",
    defaultSize: { width: 360, height: 400 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "系统告警与预警",
  },
  {
    id: "track-display",
    title: "航迹显示",
    capability: "dockable",
    category: "target",
    menuLabel: "航迹显示",
    icon: Route,
    component: TrackDisplayPanel,
    defaultLocation: "left-top",
    defaultSize: { width: 360, height: 400 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "融合航迹配色、矢量与尾迹长度",
  },
  {
    id: "assets",
    title: "资产列表",
    capability: "dockable",
    category: "target",
    menuLabel: "资产",
    icon: Radio,
    component: AssetPanel,
    defaultLocation: "left-bottom",
    defaultSize: { width: 360, height: 400 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "管理装备和资产信息",
  },

  // ========== 光电类别 ==========
  {
    id: "electro-optical",
    title: "多光电显示",
    capability: "dockable",
    category: "electro-optical",
    menuLabel: "多光电显示",
    icon: Eye,
    component: eoDockPanel("electro-optical"),
    defaultLocation: "left-bottom",
    defaultSize: { width: 360, height: 400 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "多路光电设备视频显示",
  },
  {
    id: "electro-optical-1",
    title: "多光电显示 1",
    capability: "dockable",
    category: "electro-optical",
    menuLabel: "多光电显示 1",
    icon: Eye,
    component: eoDockPanel("electro-optical-1"),
    defaultLocation: null,
    defaultSize: { width: 360, height: 400 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "多路光电设备视频显示（实例1）",
  },
  {
    id: "electro-optical-2",
    title: "多光电显示 2",
    capability: "dockable",
    category: "electro-optical",
    menuLabel: "多光电显示 2",
    icon: Eye,
    component: eoDockPanel("electro-optical-2"),
    defaultLocation: null,
    defaultSize: { width: 360, height: 400 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "多路光电设备视频显示（实例2）",
  },
  {
    id: "electro-optical-3",
    title: "多光电显示 3",
    capability: "dockable",
    category: "electro-optical",
    menuLabel: "多光电显示 3",
    icon: Eye,
    component: eoDockPanel("electro-optical-3"),
    defaultLocation: null,
    defaultSize: { width: 360, height: 400 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "多路光电设备视频显示（实例3）",
  },
  {
    id: "electro-optical-4",
    title: "多光电显示 4",
    capability: "dockable",
    category: "electro-optical",
    menuLabel: "多光电显示 4",
    icon: Eye,
    component: eoDockPanel("electro-optical-4"),
    defaultLocation: null,
    defaultSize: { width: 360, height: 400 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "多路光电设备视频显示（实例4）",
  },
  {
    id: "shore-camera",
    title: "岸基相机",
    capability: "dockable",
    category: "electro-optical",
    menuLabel: "岸基相机",
    icon: Camera,
    component: () => <div className="p-4">岸基相机窗口（待实现）</div>,
    defaultLocation: null, // 默认为popup
    defaultSize: { width: 640, height: 480 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "岸基光电设备控制窗口",
  },
  {
    id: "drone-camera",
    title: "无人机相机",
    capability: "dockable",
    category: "electro-optical",
    menuLabel: "无人机相机",
    icon: Video,
    component: () => <div className="p-4">无人机相机窗口（待实现）</div>,
    defaultLocation: null, // 默认为popup
    defaultSize: { width: 640, height: 480 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "无人机光电设备控制窗口",
  },

  // ========== 其他dockable窗体 ==========
  {
    id: "target-profile",
    title: "目标档案",
    capability: "dockable",
    category: "target",
    menuLabel: "目标档案",
    icon: ScanLine,
    component: TargetProfilePanel,
    defaultLocation: "right-top",
    defaultSize: { width: 440, height: 420 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "航迹详情与查证相册",
  },
  {
    id: "layers",
    title: "图层管理",
    capability: "dockable",
    category: "other",
    menuLabel: "图层管理",
    icon: Layers,
    component: LayerPanel,
    defaultLocation: "right-top",
    defaultSize: { width: 440, height: 400 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "管理地图图层显示",
  },
  {
    id: "system-evaluation",
    title: "系统评估",
    capability: "dockable",
    category: "tools",
    menuLabel: "系统评估",
    icon: Gauge,
    component: SystemEvaluationPanel,
    defaultLocation: "right-bottom",
    defaultSize: { width: 440, height: 520 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "系统、航迹、相机、算法评估",
  },
  {
    id: "chat",
    title: "智能助手",
    capability: "dockable",
    category: "other",
    menuLabel: "智能助手",
    icon: MessageSquare,
    component: ChatPanel,
    defaultLocation: "right-bottom",
    defaultSize: { width: 440, height: 400 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "AI智能助手对话面板",
  },
  {
    id: "overview",
    title: "总览面板",
    capability: "dockable",
    category: "other",
    menuLabel: "总览面板",
    icon: LayoutDashboard,
    component: () => <div className="p-4">总览面板（待实现）</div>,
    defaultLocation: "right-top",
    defaultSize: { width: 440, height: 400 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "系统总览信息",
  },
  {
    id: "eventlog",
    title: "事件日志",
    capability: "dockable",
    category: "system",
    menuLabel: "事件日志",
    icon: FileText,
    component: dockPlaceholder("事件日志"),
    defaultLocation: "right-bottom",
    defaultSize: { width: 440, height: 400 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "系统事件日志记录",
  },
  {
    id: "comm",
    title: "通信面板",
    capability: "dockable",
    category: "other",
    menuLabel: "通信面板",
    icon: Radio,
    component: dockPlaceholder("通信面板"),
    defaultLocation: "right-bottom",
    defaultSize: { width: 440, height: 400 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "通信管理面板",
  },
];

// ============ undockable 窗体注册 ============
/**
 * 不可停靠窗体列表
 * 这些窗体无需窗体icon，主要用于设置类弹窗
 */
const UNDOCKABLE_WINDOWS: WindowConfig[] = [
  // ========== 设置类别 ==========
  {
    id: "settings-electro-optical",
    title: "光电设置",
    capability: "undockable",
    category: "settings",
    menuLabel: "光电",
    component: () => <div className="p-4">光电设置面板（待实现）</div>,
    defaultSize: { width: 500, height: 600 },
    closable: true,
    draggable: true,
    resizable: false,
    description: "光电设备参数配置",
  },
  {
    id: "settings-radar",
    title: "雷达设置",
    capability: "undockable",
    category: "settings",
    menuLabel: "雷达",
    component: () => <div className="p-4">雷达设置面板（待实现）</div>,
    defaultSize: { width: 500, height: 600 },
    closable: true,
    draggable: true,
    resizable: false,
    description: "雷达设备参数配置",
  },
  {
    id: "settings-drone",
    title: "无人机设置",
    capability: "undockable",
    category: "settings",
    menuLabel: "无人机",
    component: () => <div className="p-4">无人机设置面板（待实现）</div>,
    defaultSize: { width: 500, height: 600 },
    closable: true,
    draggable: true,
    resizable: false,
    description: "无人机设备参数配置",
  },
  {
    id: "entity-management",
    title: "实体管理",
    capability: "undockable",
    category: "settings",
    menuLabel: "实体管理",
    component: () => <div className="p-4">实体管理面板（待实现）</div>,
    defaultSize: { width: 600, height: 700 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "实体数据管理和配置",
  },
  {
    id: "center-point",
    title: "中心点设置",
    capability: "undockable",
    category: "settings",
    menuLabel: "中心点",
    component: () => <div className="p-4">中心点设置面板（待实现）</div>,
    defaultSize: { width: 400, height: 500 },
    closable: true,
    draggable: true,
    resizable: false,
    description: "地图中心点配置",
  },

  // ========== 系统类别 ==========
  {
    id: "system-status",
    title: "状态监控",
    capability: "undockable",
    category: "system",
    menuLabel: "状态监控",
    icon: Activity,
    component: () => <div className="p-4">系统状态监控面板（待实现）</div>,
    defaultSize: { width: 800, height: 600 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "系统运行状态监控",
  },
  {
    id: "system-log",
    title: "系统日志",
    capability: "undockable",
    category: "system",
    menuLabel: "系统日志",
    component: () => <div className="p-4">系统日志面板（待实现）</div>,
    defaultSize: { width: 800, height: 600 },
    closable: true,
    draggable: true,
    resizable: true,
    description: "系统运行日志查看",
  },
];

// ============ 导出函数 ============

/**
 * 获取所有窗体配置
 */
export function getAllWindowConfigs(): WindowConfig[] {
  return [...DOCKABLE_WINDOWS, ...UNDOCKABLE_WINDOWS];
}

/**
 * 获取指定类别的窗体配置
 */
export function getWindowsByCategory(category: WindowCategory): WindowConfig[] {
  return getAllWindowConfigs().filter((w) => w.category === category);
}

/**
 * 获取dockable窗体配置
 */
export function getDockableWindows(): WindowConfig[] {
  return DOCKABLE_WINDOWS;
}

/**
 * 获取undockable窗体配置
 */
export function getUndockableWindows(): WindowConfig[] {
  return UNDOCKABLE_WINDOWS;
}

/**
 * 根据ID获取窗体配置
 */
export function getWindowConfig(id: string): WindowConfig | undefined {
  return getAllWindowConfigs().find((w) => w.id === id);
}

/**
 * 获取窗体的菜单配置
 * 返回按类别组织的菜单结构
 */
export interface MenuConfig {
  category: WindowCategory;
  categoryLabel: string;
  windows: Array<{
    id: PanelId;
    label: string;
    capability: WindowCapability;
    description: string;
  }>;
}

export function getMenuConfigs(): MenuConfig[] {
  const categories: WindowCategory[] = [
    "target",
    "electro-optical",
    "settings",
    "system",
    "tools",
    "other",
  ];

  const categoryLabels: Record<WindowCategory, string> = {
    target: "目标",
    "electro-optical": "光电",
    settings: "设置",
    system: "系统",
    tools: "工具",
    other: "其他",
  };

  return categories
    .map((category) => {
      const windows = getWindowsByCategory(category);
      if (windows.length === 0) return null;

      return {
        category,
        categoryLabel: categoryLabels[category],
        windows: windows.map((w) => ({
          id: w.id as PanelId,
          label: w.menuLabel,
          capability: w.capability,
          description: w.description || "",
        })),
      };
    })
    .filter((config): config is MenuConfig => config !== null);
}
