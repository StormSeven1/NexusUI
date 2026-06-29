"use client";

import { useAppStore } from "@/stores/app-store";
import { useTrackStore } from "@/stores/track-store";
import { cn } from "@/lib/utils";
import { getHttpConfig } from "@/lib/map-app-config";
import {
  Crosshair,
  Radio,
  Layers,
  AlertTriangle,
  PanelLeftClose,
  Shield,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
  const [simMenuOpen, setSimMenuOpen] = useState(false);
  const [simSending, setSimSending] = useState<"sea" | "air" | null>(null);
  const simMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!simMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (simMenuRef.current?.contains(event.target as Node)) return;
      setSimMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [simMenuOpen]);

  const handleTabClick = (tabId: typeof leftPanelTab) => {
    if (leftPanelTab === tabId && leftSidebarOpen) {
      toggleLeftSidebar();
    } else {
      setLeftPanelTab(tabId);
      if (!leftSidebarOpen) toggleLeftSidebar();
    }
  };

  const startTrackSimulation = async (kind: "sea" | "air") => {
    const backendUrl = getHttpConfig().backendUrl.trim().replace(/\/+$/, "");
    if (!backendUrl) {
      toast.error("未配置后端地址");
      return;
    }

    setSimSending(kind);
    try {
      const response = await fetch(`${backendUrl}/api/track_simulator/start?kind=${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) {
        throw new Error(String(json?.message ?? `HTTP ${response.status}`));
      }
      toast.success(kind === "sea" ? "已发送对海目标模拟" : "已发送对空目标模拟", {
        description: json?.track_id ? `新目标 ID: ${json.track_id}` : undefined,
      });
      setSimMenuOpen(false);
    } catch (error) {
      toast.error("目标模拟启动失败", {
        description: error instanceof Error ? error.message : "网络错误",
      });
    } finally {
      setSimSending(null);
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

        <div ref={simMenuRef} className="relative mt-1">
          <button
            onClick={() => setSimMenuOpen((open) => !open)}
            className={cn(
              "group relative flex h-9 w-9 items-center justify-center rounded-md transition-all duration-200",
              simMenuOpen
                ? "bg-nexus-accent-glow text-nexus-text-primary"
                : "text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-secondary",
            )}
            title="目标模拟"
          >
            <Shield size={18} />
          </button>

          {simMenuOpen && (
            <div className="absolute left-11 top-0 z-40 w-32 rounded-md border border-nexus-border bg-[#19191D] p-1 shadow-xl">
              <button
                disabled={simSending != null}
                onClick={() => startTrackSimulation("sea")}
                className="flex h-8 w-full items-center justify-center rounded text-xs font-medium text-nexus-text-secondary transition-colors hover:bg-white/[0.08] hover:text-nexus-text-primary disabled:cursor-wait disabled:opacity-60"
              >
                {simSending === "sea" ? "发送中..." : "发送对海"}
              </button>
              <button
                disabled={simSending != null}
                onClick={() => startTrackSimulation("air")}
                className="mt-1 flex h-8 w-full items-center justify-center rounded text-xs font-medium text-nexus-text-secondary transition-colors hover:bg-white/[0.08] hover:text-nexus-text-primary disabled:cursor-wait disabled:opacity-60"
              >
                {simSending === "air" ? "发送中..." : "发送对空"}
              </button>
            </div>
          )}
        </div>
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
