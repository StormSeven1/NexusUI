"use client";

import { useAppStore } from "@/stores/app-store";
import { useTrackStore } from "@/stores/track-store";
import { cn } from "@/lib/utils";
import {
  Crosshair,
  Radio,
  Layers,
  AlertTriangle,
  PanelLeftClose,
} from "lucide-react";
import { TrackListPanel } from "@/components/panels/TrackListPanel";
import { AssetPanel } from "@/components/panels/AssetPanel";
import { LayerPanel } from "@/components/panels/LayerPanel";
import { AlertPanel } from "@/components/panels/AlertPanel";

const TABS = [
  { id: "tracks" as const, icon: Crosshair, label: "目标" },
  { id: "assets" as const, icon: Radio, label: "资产" },
  { id: "layers" as const, icon: Layers, label: "图层" },
  { id: "alerts" as const, icon: AlertTriangle, label: "告警" },
];

export function LeftSidebar() {
  const { leftSidebarOpen, toggleLeftSidebar, leftPanelTab, setLeftPanelTab } = useAppStore();
  const alertTotal = useTrackStore((s) => s.tracks.length);

  const handleTabClick = (tabId: typeof leftPanelTab) => {
    if (leftPanelTab === tabId && leftSidebarOpen) {
      toggleLeftSidebar();
    } else {
      setLeftPanelTab(tabId);
      if (!leftSidebarOpen) toggleLeftSidebar();
    }
  };

  return (
    <aside
      className={cn(
        "relative flex h-full shrink-0 overflow-visible border-r border-nexus-border transition-all duration-300",
        leftSidebarOpen ? "w-[300px]" : "w-12"
      )}
      style={{ backgroundColor: leftSidebarOpen ? '#19191D' : '#19191D' }}
    >
      {/* 图标轨道 */}
      <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-nexus-border py-2" style={{ backgroundColor: '#19191D' }}>
        {TABS.map((tab) => {
          const isActive = leftPanelTab === tab.id && leftSidebarOpen;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={cn(
                "group relative flex h-9 w-9 items-center justify-center rounded-md transition-all duration-200",
                isActive
                  ? "bg-nexus-accent-glow text-nexus-text-primary"
                  : "text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-secondary"
              )}
              title={tab.label}
            >
              <tab.icon size={18} />
              {isActive && (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-nexus-accent" />
              )}
              {tab.id === "alerts" && alertTotal > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex min-h-3.5 min-w-3.5 items-center justify-center rounded-full bg-nexus-error px-0.5 text-[8px] font-bold leading-none text-nexus-text-inverse">
                  {alertTotal > 99 ? "99+" : alertTotal}
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

      {/* 收起按钮：跨在面板右边界上 */}
      {leftSidebarOpen && (
        <button
          onClick={toggleLeftSidebar}
          className="absolute -right-3 top-1/2 -translate-y-1/2 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-[#19191D] text-nexus-text-muted hover:bg-white/10 hover:text-nexus-text-primary transition-colors shadow-md"
          title="收起面板"
        >
          <PanelLeftClose size={13} />
        </button>
      )}
    </aside>
  );
}
