"use client";

import { TopNav } from "./TopNav";
import { LeftSidebar } from "./LeftSidebar";
import { RightSidebar } from "./RightSidebar";
import { StatusBar } from "./StatusBar";
import { MapContainer } from "@/components/map/MapContainer";
import { AgentMessageFloat } from "@/components/AgentMessageFloat";
import { WorkspaceDetails } from "./WorkspaceDetails";

export function AppShell() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-nexus-bg-base">
      <TopNav />

      {/* 中间内容区域 */}
      <div className="relative flex flex-1 overflow-hidden">
        <LeftSidebar />

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
    </div>
  );
}
