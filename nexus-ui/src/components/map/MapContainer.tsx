"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useAppStore } from "@/stores/app-store";
import { useTrackStore } from "@/stores/track-store";
import { useMapPointerStore } from "@/stores/map-pointer-store";
import { getMapMeasureHandlers, useMapMeasureUi } from "@/stores/map-measure-bridge";
import { Map as MapIcon, Globe, Pentagon, Ruler, DraftingCompass, BarChart3, Zap, Plane, Ship, Radio, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkflowStatusOverlay } from "@/components/layout/WorkflowStatusOverlay";
import { QuickWorkflowModal } from "@/components/layout/QuickWorkflowModal";
import { NetworkStatsDialog } from "@/components/layout/NetworkStatsDialog";
import { RadarDisplaySettingsDialog } from "@/components/layout/RadarDisplaySettingsDialog";
import { CameraDisplaySettingsDialog } from "@/components/layout/CameraDisplaySettingsDialog";
// import { MiniMap } from "./MiniMap"; // 小地图暂隐藏，恢复时取消注释

const Map2D = dynamic(() => import("./Map2D").then((m) => m.Map2D), {
  ssr: false,
  loading: () => <MapPlaceholder />,
});

const Map3D = dynamic(() => import("./Map3D").then((m) => m.Map3D), {
  ssr: false,
  loading: () => <MapPlaceholder />,
});

function MapPlaceholder() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-nexus-bg-base">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-white/40" />
        <span className="text-xs text-nexus-text-muted">加载地图中...</span>
      </div>
    </div>
  );
}

const mapToolBtn =
  "flex items-center justify-center h-7 w-7 rounded-md text-xs font-medium transition-colors border border-transparent";

export function MapContainer() {
  const { mapViewMode, setMapViewMode, zoomLevel } = useAppStore();
  const tracks = useTrackStore((s) => s.tracks);
  const mouseCoords = useMapPointerStore((s) => s.mouseCoords);
  const airCount = tracks.filter((t) => t.type === "air").length;
  const seaCount = tracks.filter((t) => t.type === "sea" || t.type === "underwater").length;
  const measureUi = useMapMeasureUi();
  const h = () => getMapMeasureHandlers();
  const [quickWorkflowOpen, setQuickWorkflowOpen] = useState(false);
  const [networkStatsOpen, setNetworkStatsOpen] = useState(false);
  const [radarSettingsOpen, setRadarSettingsOpen] = useState(false);
  const [cameraSettingsOpen, setCameraSettingsOpen] = useState(false);

  return (
    <div className="relative h-full w-full">
      <div className="h-full w-full">
        {mapViewMode === "2d" ? <Map2D /> : <Map3D />}
      </div>

      {/* 右上角工具栏：多边形/量算/角度/网络统计/快捷工作流 + 2D/3D 切换 */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        {/* 多边形 */}
        <button
          type="button"
          title="多边形标绘：左键加点，双击闭合；右键取消"
          className={cn(
            mapToolBtn,
            measureUi.activeDrawTool === "polygon"
              ? "border-nexus-border-accent bg-nexus-accent-glow/25 text-nexus-text-primary"
              : "nexus-glass text-nexus-text-muted hover:bg-white/10 hover:text-nexus-text-secondary",
          )}
          onClick={() => {
            const on = measureUi.activeDrawTool === "polygon";
            h()?.setDrawTool(on ? null : "polygon");
          }}
        >
          <Pentagon size={14} />
        </button>
        {/* 量算 */}
        <button
          type="button"
          title="距离量算：左键加点，右键清空，双击结束"
          className={cn(
            mapToolBtn,
            measureUi.activeDrawTool === "distance"
              ? "border-nexus-border-accent bg-nexus-accent-glow/25 text-nexus-text-primary"
              : "nexus-glass text-nexus-text-muted hover:bg-white/10 hover:text-nexus-text-secondary",
          )}
          onClick={() => {
            const on = measureUi.activeDrawTool === "distance";
            h()?.setDrawTool(on ? null : "distance");
          }}
        >
          <Ruler size={14} />
        </button>
        {/* 角度 */}
        <button
          type="button"
          title="角度量算：左键设原点，移动显示方位与距离，再点左键结束；右键清空"
          className={cn(
            mapToolBtn,
            measureUi.activeDrawTool === "angle"
              ? "border-nexus-border-accent bg-nexus-accent-glow/25 text-nexus-text-primary"
              : "nexus-glass text-nexus-text-muted hover:bg-white/10 hover:text-nexus-text-secondary",
          )}
          onClick={() => {
            const on = measureUi.activeDrawTool === "angle";
            h()?.setDrawTool(on ? null : "angle");
          }}
        >
          <DraftingCompass size={14} />
        </button>

        <div className="h-5 w-px bg-white/10" />

        {/* 网络数据统计 */}
        <button
          type="button"
          title="网络数据统计"
          className={cn(mapToolBtn, "nexus-glass text-nexus-text-muted hover:bg-white/10 hover:text-nexus-text-secondary")}
          onClick={() => setNetworkStatsOpen(true)}
        >
          <BarChart3 size={14} />
        </button>
        {/* 快捷工作流 */}
        <button
          type="button"
          title="快捷工作流"
          className={cn(mapToolBtn, "nexus-glass text-nexus-text-muted hover:bg-white/10 hover:text-nexus-text-secondary")}
          onClick={() => setQuickWorkflowOpen(true)}
        >
          <Zap size={14} />
        </button>

        {/* 雷达显示设置 */}
        <button
          type="button"
          title="雷达显示设置"
          className={cn(mapToolBtn, "nexus-glass text-nexus-text-muted hover:bg-white/10 hover:text-nexus-text-secondary")}
          onClick={() => setRadarSettingsOpen(true)}
        >
          <Radio size={14} />
        </button>
        {/* 光电显示设置 */}
        <button
          type="button"
          title="光电显示设置"
          className={cn(mapToolBtn, "nexus-glass text-nexus-text-muted hover:bg-white/10 hover:text-nexus-text-secondary")}
          onClick={() => setCameraSettingsOpen(true)}
        >
          <Camera size={14} />
        </button>

        <div className="h-5 w-px bg-white/10" />

        {/* 2D/3D 切换 */}
        {/* <div className="flex overflow-hidden rounded-md border border-nexus-border nexus-glass">
          <button
            onClick={() => setMapViewMode("2d")}
            title="2D"
            className={cn(
              "flex items-center justify-center h-7 w-7 text-xs font-medium transition-all duration-200",
              mapViewMode === "2d"
                ? "bg-nexus-accent-glow text-nexus-text-primary border border-nexus-border-accent"
                : "text-nexus-text-muted hover:bg-white/5 hover:text-nexus-text-secondary"
            )}
          >
            <MapIcon size={14} />
          </button>
          <div className="w-px bg-nexus-border" />
          <button
            onClick={() => setMapViewMode("3d")}
            title="3D"
            className={cn(
              "flex items-center justify-center h-7 w-7 text-xs font-medium transition-all duration-200",
              mapViewMode === "3d"
                ? "bg-nexus-accent-glow text-nexus-text-primary border border-nexus-border-accent"
                : "text-nexus-text-muted hover:bg-white/5 hover:text-nexus-text-secondary"
            )}
          >
            <Globe size={14} />
          </button>
        </div> */}
      </div>

      {/* 左上角：目标统计（对空 / 对海） */}
      <div className="absolute left-14 top-3 z-10 flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-md nexus-glass border border-nexus-border px-2.5 py-1.5 text-[11px] text-nexus-text-secondary">
          <Plane size={13} className="text-sky-400" />
          <span className="text-sky-400 font-semibold">{airCount}</span>
          <span className="text-nexus-text-muted">对空</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-md nexus-glass border border-nexus-border px-2.5 py-1.5 text-[11px] text-nexus-text-secondary">
          <Ship size={13} className="text-emerald-400" />
          <span className="text-emerald-400 font-semibold">{seaCount}</span>
          <span className="text-nexus-text-muted">对海</span>
        </div>
      </div>

      {/* 右下角：坐标 + 缩放等级 */}
      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-3 rounded-md nexus-glass border border-nexus-border px-3 py-1.5 font-mono text-[11px] text-nexus-text-secondary">
        <span>级别：{zoomLevel}</span>
        <span>
          纬度：{mouseCoords ? mouseCoords.lat.toFixed(6) : "—"}
        </span>
        <span>
          经度：{mouseCoords ? mouseCoords.lng.toFixed(6) : "—"}
        </span>
      </div>

      {/* 小地图暂隐藏；恢复：取消上面 MiniMap import 注释并取消下一行注释 */}
      {/* <MiniMap /> */}

      {/* 比例尺
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2">
        <div className="flex items-center gap-1 rounded nexus-glass px-2 py-1">
          <div className="h-px w-12 bg-nexus-text-secondary" />
          <span className="font-mono text-[9px] text-nexus-text-secondary">10 km</span>
        </div>
      </div> */}

      {/* 中心十字
      <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
        <div className="relative h-6 w-6 opacity-20">
          <div className="absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 bg-nexus-text-primary" />
          <div className="absolute bottom-0 left-1/2 h-2 w-px -translate-x-1/2 bg-nexus-text-primary" />
          <div className="absolute left-0 top-1/2 h-px w-2 -translate-y-1/2 bg-nexus-text-primary" />
          <div className="absolute right-0 top-1/2 h-px w-2 -translate-y-1/2 bg-nexus-text-primary" />
        </div>
      </div> */}

      {/* 工作流状态浮层（地图上方居中） */}
      <WorkflowStatusOverlay />

      {/* 边缘暗角 */}
      <div className="pointer-events-none absolute inset-0 z-[4] shadow-[inset_0_0_100px_rgba(10,10,15,0.8)]" />

      {/* 弹窗 */}
      <QuickWorkflowModal open={quickWorkflowOpen} onClose={() => setQuickWorkflowOpen(false)} />
      <NetworkStatsDialog open={networkStatsOpen} onClose={() => setNetworkStatsOpen(false)} />
      <RadarDisplaySettingsDialog open={radarSettingsOpen} onClose={() => setRadarSettingsOpen(false)} />
      <CameraDisplaySettingsDialog open={cameraSettingsOpen} onClose={() => setCameraSettingsOpen(false)} />
    </div>
  );
}
