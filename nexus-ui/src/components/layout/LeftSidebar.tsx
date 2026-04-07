"use client";

import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";
import {
  Crosshair,
  Radio,
  Layers,
  AlertTriangle,
} from "lucide-react";
import { TrackListPanel } from "@/components/panels/TrackListPanel";
import { AssetPanel } from "@/components/panels/AssetPanel";
import { LayerPanel } from "@/components/panels/LayerPanel";
import { AlertPanel } from "@/components/panels/AlertPanel";

const TABS = [
  { id: "tracks" as const, icon: Crosshair, label: "航迹" },
  { id: "assets" as const, icon: Radio, label: "资产" },
  { id: "layers" as const, icon: Layers, label: "图层" },
  { id: "alerts" as const, icon: AlertTriangle, label: "告警" },
];

export function LeftSidebar() {
  const { leftSidebarOpen, leftPanelTab, setLeftPanelTab } = useAppStore();

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 border-r border-white/[0.06] bg-nexus-bg-surface/90 backdrop-blur-md transition-all duration-300",
        leftSidebarOpen ? "w-[300px]" : "w-12"
      )}
    >
      {/* 图标轨道 */}
      <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] py-2">
        {TABS.map((tab) => {
          const isActive = leftPanelTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setLeftPanelTab(tab.id)}
              className={cn(
                "group relative flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                isActive
                  ? "bg-white/[0.08] text-nexus-text-primary"
                  : "text-nexus-text-muted hover:bg-white/[0.04] hover:text-nexus-text-secondary"
              )}
              title={tab.label}
            >
              <tab.icon size={18} />
              {isActive && (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-nexus-text-primary" />
              )}
              {tab.id === "alerts" && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white">
                  3
                </span>
              )}
            </button>
          );
        })}
      </div>

      {leftSidebarOpen && (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {leftPanelTab === "tracks" && <TrackListPanel />}
          {leftPanelTab === "assets" && <AssetPanel />}
          {leftPanelTab === "layers" && <LayerPanel />}
          {leftPanelTab === "alerts" && <AlertPanel />}
        </div>
      )}
    </aside>
  );
}
