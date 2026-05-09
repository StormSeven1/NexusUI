"use client";

/**
 * 数据入口：`useUnifiedWsFeed`（仅 hooks/useUnifiedWsFeed.ts）负责 WebSocket + 区域/资产轮询。
 */

import { TopNav } from "./TopNav";
import { LeftSidebar } from "./LeftSidebar";
import { RightSidebar } from "./RightSidebar";
import { MapContainer } from "@/components/map/MapContainer";
import { AgentMessageFloat } from "@/components/AgentMessageFloat";
import { useUnifiedWsFeed } from "@/hooks/useUnifiedWsFeed";

export function AppShell() {
  useUnifiedWsFeed();

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-nexus-bg-base">
      <TopNav />

      {/* 中间内容区域 */}
      <div className="relative flex flex-1 overflow-hidden">
        <LeftSidebar />

        {/* 主内容区域 */}
        <div className="relative flex-1 flex flex-col overflow-hidden">
          {/* 地图区域 - 默认显示态势地图 */}
          <main className="relative flex-1 overflow-hidden">
            <MapContainer />
          </main>
        </div>

        <RightSidebar />
      </div>

      <AgentMessageFloat />
    </div>
  );
}
