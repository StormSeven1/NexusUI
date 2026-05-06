"use client";

/**
 * 数据入口：`useUnifiedWsFeed`（仅 hooks/useUnifiedWsFeed.ts）负责 WebSocket + 区域/资产轮询。
 */

import { TopNav } from "./TopNav";
import { DockLeftSidebar } from "./DockLeftSidebar";
import { RightSidebar } from "./RightSidebar";
import { DockProvider } from "@/components/dock/DockProvider";
import { DockContainer } from "@/components/dock/DockContainer";
import { StatusBar } from "./StatusBar";
import { MapContainer } from "@/components/map/MapContainer";
import { AgentMessageFloat } from "@/components/AgentMessageFloat";
import { WorkspaceDetails } from "./WorkspaceDetails";
import { useUnifiedWsFeed } from "@/hooks/useUnifiedWsFeed";

export function AppShell() {
  useUnifiedWsFeed();

  return (
    <DockProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-nexus-bg-base">
        <TopNav />

        {/* 中间内容区域 */}
        <div className="relative flex flex-1 overflow-hidden">
          <DockLeftSidebar />

          {/* 主内容区域 */}
          <div className="relative flex-1 flex flex-col overflow-hidden">
            {/* 工作区详情 */}
            <div className="flex-shrink-0">
              <WorkspaceDetails />
            </div>

            {/* 地图区域 - 默认显示态势地图 */}
            <main className="relative flex-1 overflow-hidden">
              <MapContainer />
            </main>
          </div>

          <RightSidebar />
        </div>

        <StatusBar />
        <AgentMessageFloat />
        <DockContainer />
      </div>
    </DockProvider>
  );
}
