"use client";

/**
 * 数据入口：`useUnifiedWsFeed` 负责 WebSocket；`useDbAreasPoll` 轮询 Postgres `area_table`（区域图层）。
 */

import { TopNav } from "./TopNav";
import { DockLeftSidebar } from "./DockLeftSidebar";
import { RightSidebar } from "./RightSidebar";
import { DockProvider } from "@/components/dock/DockProvider";
import { DockContainer } from "@/components/dock/DockContainer";
import { StatusBar } from "./StatusBar";
import { MapContainer } from "@/components/map/MapContainer";
import { WorkspaceDetails } from "./WorkspaceDetails";
import { useUnifiedWsFeed } from "@/hooks/useUnifiedWsFeed";
import { useDbAreasPoll } from "@/hooks/useDbAreasPoll";
import { AlarmSpeechAnnouncer } from "@/components/system/AlarmSpeechAnnouncer";
import { TaskStatusChatSseHost } from "@/components/system/TaskStatusChatSseHost";
import { VerifiedTrackSyncHost } from "@/components/system/VerifiedTrackSyncHost";
import { useTrackEvalAutoQuery } from "@/hooks/useTrackEvalAutoQuery";

export function AppShell() {
  useUnifiedWsFeed();
  useDbAreasPoll();
  useTrackEvalAutoQuery();

  return (
    <DockProvider>
      <TaskStatusChatSseHost />
      <VerifiedTrackSyncHost />
      <AlarmSpeechAnnouncer />
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
        <DockContainer />
      </div>
    </DockProvider>
  );
}
