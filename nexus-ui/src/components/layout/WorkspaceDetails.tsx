"use client";

import { useAppStore } from "@/stores/app-store";
import {
  MapPin,
  BarChart3,
  Layers,
  Route,
  Search,
  Filter,
  Download,
  Share,
  MoreVertical,
  Package,
  ClipboardList
} from "lucide-react";

// 工作区详情配置
const WORKSPACE_CONFIGS = {
  situation: {
    title: "态势工作区",
    description: "战场态势监控与分析",
    statistics: [
      { label: "监控目标", value: "28", icon: MapPin, color: "text-blue-400" },
      { label: "跟踪航迹", value: "12", icon: Route, color: "text-green-400" },
      { label: "预警事件", value: "3", icon: BarChart3, color: "text-orange-400" },
      { label: "图层显示", value: "5", icon: Layers, color: "text-purple-400" }
    ],
    tools: [
      { id: "draw", label: "标绘", icon: Route },
      { id: "measure", label: "量算", icon: Search },
      { id: "filter", label: "筛选", icon: Filter },
      { id: "export", label: "导出", icon: Download },
      { id: "share", label: "共享", icon: Share }
    ]
  },
  assets: {
    title: "资产工作区",
    description: "物资装备管理与追踪",
    statistics: [
      { label: "装备总数", value: "156", icon: Package, color: "text-blue-400" },
      { label: "待分配", value: "42", icon: MapPin, color: "text-yellow-400" },
      { label: "已部署", value: "114", icon: BarChart3, color: "text-green-400" },
      { label: "待维护", value: "8", icon: Layers, color: "text-red-400" }
    ],
    tools: [
      { id: "inventory", label: "库存", icon: Layers },
      { id: "track", label: "追踪", icon: Route },
      { id: "schedule", label: "调度", icon: Search },
      { id: "report", label: "报表", icon: BarChart3 },
      { id: "allocate", label: "分配", icon: Share }
    ]
  },
  tasks: {
    title: "任务工作区",
    description: "任务规划与执行监控",
    statistics: [
      { label: "任务总数", value: "7", icon: ClipboardList, color: "text-blue-400" },
      { label: "进行中", value: "3", icon: MapPin, color: "text-orange-400" },
      { label: "已完成", value: "4", icon: BarChart3, color: "text-green-400" },
      { label: "延期", value: "1", icon: Layers, color: "text-red-400" }
    ],
    tools: [
      { id: "plan", label: "规划", icon: Layers },
      { id: "schedule", label: "排期", icon: Route },
      { id: "monitor", label: "监控", icon: Search },
      { id: "report", label: "报告", icon: BarChart3 },
      { id: "archive", label: "归档", icon: Download }
    ]
  },
  layers: {
    title: "图层工作区",
    description: "地理图层管理与显示",
    statistics: [
      { label: "加载图层", value: "12", icon: Layers, color: "text-blue-400" },
      { label: "可见图层", value: "8", icon: MapPin, color: "text-green-400" },
      { label: "标记点", value: "245", icon: BarChart3, color: "text-purple-400" },
      { label: "绘制对象", value: "67", icon: Route, color: "text-orange-400" }
    ],
    tools: [
      { id: "add", label: "添加", icon: Layers },
      { id: "hide", label: "隐藏", icon: Search },
      { id: "opacity", label: "透明度", icon: Filter },
      { id: "styles", label: "样式", icon: BarChart3 },
      { id: "export", label: "导出", icon: Download }
    ]
  },
  analytics: {
    title: "分析工作区",
    description: "数据分析与可视化",
    statistics: [
      { label: "数据集", value: "24", icon: BarChart3, color: "text-blue-400" },
      { label: "分析任务", value: "5", icon: MapPin, color: "text-orange-400" },
      { label: "模型", value: "3", icon: Layers, color: "text-green-400" },
      { label: "报表", value: "12", icon: Route, color: "text-purple-400" }
    ],
    tools: [
      { id: "query", label: "查询", icon: Search },
      { id: "visualize", label: "可视化", icon: BarChart3 },
      { id: "model", label: "模型", icon: Layers },
      { id: "export", label: "导出", icon: Download },
      { id: "settings", label: "设置", icon: Filter }
    ]
  },
  search: {
    title: "搜索工作区",
    description: "全局搜索功能",
    statistics: [
      { label: "搜索历史", value: "48", icon: Search, color: "text-blue-400" },
      { label: "收藏", value: "12", icon: MapPin, color: "text-yellow-400" },
      { label: "结果", value: "156", icon: BarChart3, color: "text-green-400" },
      { label: "分类", value: "7", icon: Layers, color: "text-purple-400" }
    ],
    tools: [
      { id: "advanced", label: "高级", icon: Layers },
      { id: "filter", label: "筛选", icon: Filter },
      { id: "save", label: "保存", icon: Download },
      { id: "share", label: "共享", icon: Share },
      { id: "clear", label: "清除", icon: Search }
    ]
  },
  settings: {
    title: "设置工作区",
    description: "系统设置与配置",
    statistics: [
      { label: "用户", value: "24", icon: MapPin, color: "text-blue-400" },
      { label: "角色", value: "5", icon: BarChart3, color: "text-green-400" },
      { label: "权限", value: "18", icon: Layers, color: "text-orange-400" },
      { label: "配置", value: "8", icon: Route, color: "text-purple-400" }
    ],
    tools: [
      { id: "users", label: "用户", icon: MapPin },
      { id: "roles", label: "角色", icon: BarChart3 },
      { id: "permissions", label: "权限", icon: Layers },
      { id: "preferences", label: "偏好", icon: Route },
      { id: "backup", label: "备份", icon: Download }
    ]
  }
};

export function WorkspaceDetails() {
  const { topTab } = useAppStore();
  const config = WORKSPACE_CONFIGS[topTab];

  if (!config) return null;

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-t border-nexus-border" style={{ backgroundColor: '#212126' }}>
      {/* 左侧：标题和统计信息 */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-nexus-accent/20">
            <h3 className="text-sm font-bold text-nexus-accent">{topTab[0].toUpperCase()}</h3>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-nexus-text-primary">{config.title}</h3>
            <p className="text-xs text-nexus-text-muted">{config.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {config.statistics.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <div key={index} className="flex items-center gap-2">
                <Icon size={16} className={stat.color} />
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-nexus-text-primary">{stat.label}</span>
                  <span className="text-xs font-bold">{stat.value}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 右侧：操作工具栏 */}
      <div className="flex items-center gap-2">
        {config.tools.map((tool) => (
          <button
            key={tool.id}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-nexus-text-secondary hover:bg-nexus-bg-elevated hover:text-nexus-text-primary transition-colors"
          >
            <tool.icon size={14} />
            {tool.label}
          </button>
        ))}
        <button className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-white/10 hover:bg-white/20 transition-colors">
          <MoreVertical size={12} />
          更多
        </button>
      </div>
    </div>
  );
}
