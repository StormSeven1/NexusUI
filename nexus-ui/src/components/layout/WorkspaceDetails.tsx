"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useAssetStore } from "@/stores/asset-store";
import { useTrackStore } from "@/stores/track-store";
import { useAlertStore } from "@/stores/alert-store";
import { cn } from "@/lib/utils";
import { buildDataLayerPanelRows } from "@/lib/map-entity-model";
import { getMapMeasureHandlers, useMapMeasureUi } from "@/stores/map-measure-bridge";
import {
  MapPin,
  BarChart3,
  Layers,
  Filter,
  Download,
  Share,
  MoreVertical,
  Package,
  ClipboardList,
  Route,
  Search,
  Pentagon,
  Ruler,
  DraftingCompass,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { QuickWorkflowModal } from "@/components/layout/QuickWorkflowModal";
import { NetworkStatsDialog } from "@/components/layout/NetworkStatsDialog";

type StatRow = { label: string; value: string; icon: LucideIcon; color: string };

/**
 * 图层面板「已开启」项数量（与 `LayerPanel` 的 enabledCount 一致）：
 * 可见的数据图层 +（底图组开时）**底图总开关算 1 项** + 各已开矢量子层。
 * 与「加载图层」关系：全打开时 本值 === countLayerPanelLoaded（总开关 + 矢量子层行 + 数据行）。
 */
function countLayerPanelEnabled(
  assets: ReadonlyArray<{ asset_type: string }>,
  layerVisibility: Record<string, boolean>,
  basemapGroupVisible: boolean,
  basemapVectorLayers: ReadonlyArray<{ id: string }>,
  basemapVectorVisibility: Record<string, boolean>,
): number {
  const rows = buildDataLayerPanelRows(assets);
  let n = rows.filter((r) => layerVisibility[r.id] !== false).length;
  if (basemapGroupVisible) {
    n += 1;
    n += basemapVectorLayers.filter((l) => basemapVectorVisibility[l.id] !== false).length;
  }
  return n;
}

/** 图层面板可管理项总数：底图总开关 1 行 + 底图矢量子层 + 数据图层行（与左侧 `LayerPanel` 列表行数一致） */
function countLayerPanelLoaded(
  assets: ReadonlyArray<{ asset_type: string }>,
  basemapVectorLayers: ReadonlyArray<{ id: string }>,
): number {
  const rows = buildDataLayerPanelRows(assets);
  return 1 + basemapVectorLayers.length + rows.length;
}

// 工作区详情配置
const WORKSPACE_CONFIGS = {
  situation: {
    title: "态势工作区",
    description: "战场态势监控与分析",
    statistics: [
      { label: "监控目标", value: "0", icon: MapPin, color: "text-blue-400" },
      { label: "跟踪航迹", value: "0", icon: Route, color: "text-green-400" },
      { label: "预警事件", value: "0", icon: BarChart3, color: "text-orange-400" },
      { label: "图层显示", value: "0", icon: Layers, color: "text-purple-400" },
    ] as StatRow[],
    tools: [
      { id: "filter", label: "筛选", icon: Filter },
      { id: "export", label: "导出", icon: Download },
      { id: "share", label: "共享", icon: Share },
    ],
  },
  assets: {
    title: "资产工作区",
    description: "物资装备管理与追踪",
    statistics: [
      { label: "装备总数", value: "0", icon: Package, color: "text-blue-400" },
      { label: "待分配", value: "0", icon: MapPin, color: "text-yellow-400" },
      { label: "已部署", value: "0", icon: BarChart3, color: "text-green-400" },
      { label: "待维护", value: "0", icon: Layers, color: "text-red-400" },
    ] as StatRow[],
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
      { label: "加载图层", value: "0", icon: Layers, color: "text-blue-400" },
      { label: "可见图层", value: "0", icon: MapPin, color: "text-green-400" },
      { label: "标记点", value: "0", icon: BarChart3, color: "text-purple-400" },
      { label: "绘制对象", value: "0", icon: Route, color: "text-orange-400" },
    ] as StatRow[],
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

const situationToolBtn =
  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors border border-transparent";

export function WorkspaceDetails() {
  const topTab = useAppStore((s) => s.topTab);
  const assets = useAssetStore((s) => s.assets);
  const tracks = useTrackStore((s) => s.tracks);
  const alerts = useAlertStore((s) => s.alerts);
  const layerVisibility = useAppStore((s) => s.layerVisibility);
  const basemapGroupVisible = useAppStore((s) => s.basemapGroupVisible);
  const basemapVectorLayers = useAppStore((s) => s.basemapVectorLayers);
  const basemapVectorVisibility = useAppStore((s) => s.basemapVectorVisibility);
  const drawnAreas = useAppStore((s) => s.drawnAreas);
  const routeLines = useAppStore((s) => s.routeLines);

  /** 快捷工作流弹窗状态 */
  const [quickWorkflowOpen, setQuickWorkflowOpen] = useState(false);
  const [networkStatsOpen, setNetworkStatsOpen] = useState(false);

  const situationLiveStats = useMemo((): StatRow[] => {
    const layerN = countLayerPanelEnabled(
      assets,
      layerVisibility,
      basemapGroupVisible,
      basemapVectorLayers,
      basemapVectorVisibility,
    );
    return [
      { label: "监控目标", value: String(assets.length), icon: MapPin, color: "text-blue-400" },
      { label: "跟踪航迹", value: String(tracks.length), icon: Route, color: "text-green-400" },
      { label: "预警事件", value: String(alerts.length), icon: BarChart3, color: "text-orange-400" },
      { label: "图层显示", value: String(layerN), icon: Layers, color: "text-purple-400" },
    ];
  }, [
    assets,
    tracks,
    alerts,
    layerVisibility,
    basemapGroupVisible,
    basemapVectorLayers,
    basemapVectorVisibility,
  ]);

  const assetsLiveStats = useMemo((): StatRow[] => {
    const total = assets.length;
    const pending = assets.filter(
      (a) => a.mission_status === "idle" || a.mission_status === "assigned",
    ).length;
    const deployed = assets.filter(
      (a) =>
        a.status === "online" &&
        (a.mission_status === "monitoring" ||
          a.mission_status === "en_route" ||
          a.mission_status === "returning"),
    ).length;
    const maint = assets.filter((a) => a.status === "degraded" || a.status === "offline").length;
    return [
      { label: "装备总数", value: String(total), icon: Package, color: "text-blue-400" },
      { label: "待分配", value: String(pending), icon: MapPin, color: "text-yellow-400" },
      { label: "已部署", value: String(deployed), icon: BarChart3, color: "text-green-400" },
      { label: "待维护", value: String(maint), icon: Layers, color: "text-red-400" },
    ];
  }, [assets]);

  const layersLiveStats = useMemo((): StatRow[] => {
    const loaded = countLayerPanelLoaded(assets, basemapVectorLayers);
    const visible = countLayerPanelEnabled(
      assets,
      layerVisibility,
      basemapGroupVisible,
      basemapVectorLayers,
      basemapVectorVisibility,
    );
    const markers = tracks.length + assets.length;
    const drawings = drawnAreas.length + routeLines.length;
    return [
      { label: "加载图层", value: String(loaded), icon: Layers, color: "text-blue-400" },
      { label: "可见图层", value: String(visible), icon: MapPin, color: "text-green-400" },
      { label: "标记点", value: String(markers), icon: BarChart3, color: "text-purple-400" },
      { label: "绘制对象", value: String(drawings), icon: Route, color: "text-orange-400" },
    ];
  }, [
    assets,
    tracks,
    basemapVectorLayers,
    layerVisibility,
    basemapGroupVisible,
    basemapVectorVisibility,
    drawnAreas,
    routeLines,
  ]);

  const config = WORKSPACE_CONFIGS[topTab];
  const measureUi = useMapMeasureUi();

  if (!config) return null;

  const statistics: StatRow[] =
    topTab === "situation"
      ? situationLiveStats
      : topTab === "assets"
        ? assetsLiveStats
        : topTab === "layers"
          ? layersLiveStats
          : config.statistics;

  const h = () => getMapMeasureHandlers();

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
          {statistics.map((stat, index) => {
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

      {/* 右侧：操作工具栏（态势页：多边形 / 距离 / 角度 / 激光 / TDOA 与地图 Map2D 联动） */}
      <div className="flex flex-wrap items-center gap-2">
        {topTab === "situation" && (
          <>
            <button
              type="button"
              title="多边形标绘：左键加点，双击闭合；右键取消"
              className={cn(
                situationToolBtn,
                measureUi.activeDrawTool === "polygon"
                  ? "border-nexus-border-accent bg-nexus-accent-glow/25 text-nexus-text-primary"
                  : "text-nexus-text-secondary hover:bg-nexus-bg-elevated hover:text-nexus-text-primary",
              )}
              onClick={() => {
                const on = measureUi.activeDrawTool === "polygon";
                h()?.setDrawTool(on ? null : "polygon");
              }}
            >
              <Pentagon size={14} />
              多边形
            </button>
            <button
              type="button"
              title="距离量算：左键加点，右键清空，双击结束"
              className={cn(
                situationToolBtn,
                measureUi.activeDrawTool === "distance"
                  ? "border-nexus-border-accent bg-nexus-accent-glow/25 text-nexus-text-primary"
                  : "text-nexus-text-secondary hover:bg-nexus-bg-elevated hover:text-nexus-text-primary",
              )}
              onClick={() => {
                const on = measureUi.activeDrawTool === "distance";
                h()?.setDrawTool(on ? null : "distance");
              }}
            >
              <Ruler size={14} />
              量算
            </button>
            <button
              type="button"
              title="角度量算：左键设原点，移动鼠标实时显示方位（正北 0°）与距离，再点左键结束；右键清空"
              className={cn(
                situationToolBtn,
                measureUi.activeDrawTool === "angle"
                  ? "border-nexus-border-accent bg-nexus-accent-glow/25 text-nexus-text-primary"
                  : "text-nexus-text-secondary hover:bg-nexus-bg-elevated hover:text-nexus-text-primary",
              )}
              onClick={() => {
                const on = measureUi.activeDrawTool === "angle";
                h()?.setDrawTool(on ? null : "angle");
              }}
            >
              <DraftingCompass size={14} />
              角度
            </button>
            <span className="hidden h-4 w-px bg-white/10 sm:inline-block" aria-hidden />
          </>
        )}
        {config.tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-nexus-text-secondary transition-colors hover:bg-nexus-bg-elevated hover:text-nexus-text-primary"
            onClick={() => {
              // 任务→规划：点击打开快捷工作流弹窗
              if (topTab === "tasks" && tool.id === "plan") {
                setQuickWorkflowOpen(true);
              }
              // 分析→查询：点击打开网络数据统计弹窗
              if (topTab === "analytics" && tool.id === "query") {
                setNetworkStatsOpen(true);
              }
            }}
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

      {/* 快捷工作流弹窗：任务→规划 点击时弹出 */}
      <QuickWorkflowModal open={quickWorkflowOpen} onClose={() => setQuickWorkflowOpen(false)} />
      {/* 网络数据统计弹窗：分析→查询 点击时弹出 */}
      <NetworkStatsDialog open={networkStatsOpen} onClose={() => setNetworkStatsOpen(false)} />
    </div>
  );
}
