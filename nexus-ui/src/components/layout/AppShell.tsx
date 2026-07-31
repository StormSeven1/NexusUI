"use client";

/**
 * 数据入口：`useUnifiedWsFeed` 负责 WebSocket；`useDbAreasPoll` 轮询 Postgres `area_table`（区域图层）；
 * `useSystemAlarmPoll` 每 2s 拉取 AlarmSys 系统告警（GetActiveAlarms）。
 */

import { useRef } from "react";
import { TopNav } from "./TopNav";
import { DockLeftSidebar } from "./DockLeftSidebar";
import { RightSidebar } from "./RightSidebar";
import { ClassicRightColumn } from "./ClassicWorkspaceLayout";
import { DockProvider } from "@/components/dock/DockProvider";
import { DockContainer } from "@/components/dock/DockContainer";
import { StatusBar } from "./StatusBar";
import { MapContainer } from "@/components/map/MapContainer";
import { WorkspaceDetails } from "./WorkspaceDetails";
import { useUnifiedWsFeed } from "@/hooks/useUnifiedWsFeed";
import { useDbAreasPoll } from "@/hooks/useDbAreasPoll";
import { useMapLayoutResize } from "@/hooks/useMapLayoutResize";
import { useSystemAlarmPoll } from "@/hooks/useSystemAlarmPoll";
import { AlarmSpeechAnnouncer } from "@/components/system/AlarmSpeechAnnouncer";
import { TaskStatusChatSseHost } from "@/components/system/TaskStatusChatSseHost";
import { TaskStatusVerifyChatHost } from "@/components/system/TaskStatusVerifyChatHost";
import { VerifiedTrackSyncHost } from "@/components/system/VerifiedTrackSyncHost";
import { useTrackEvalAutoQuery } from "@/hooks/useTrackEvalAutoQuery";
import { useDockStore } from "@/stores/dock-store";

export function AppShell() {
  useUnifiedWsFeed();
  useDbAreasPoll();
  useSystemAlarmPoll();
  useTrackEvalAutoQuery();
  useMapLayoutResize();

  const layoutMode = useDockStore((s) => s.layoutMode);
  const isClassic = layoutMode === "classic";
  const workspaceRowRef = useRef<HTMLDivElement>(null);

  return (
    <DockProvider>
      <TaskStatusChatSseHost />
      <TaskStatusVerifyChatHost />
      <VerifiedTrackSyncHost />
      <AlarmSpeechAnnouncer />
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-nexus-bg-base">
        <TopNav />

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {!isClassic ? (
            <DockLeftSidebar disablePopout={false} toolsOnly={false} />
          ) : null}

          {/* 工作区行：左列为态势（顶栏+地图），右列为 dock / 经典光电区 */}
          <div ref={workspaceRowRef} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex-shrink-0">
                <WorkspaceDetails />
              </div>
              <main className="relative min-h-0 flex-1 overflow-hidden">
                <MapContainer />
              </main>
            </div>

            {isClassic ? <ClassicRightColumn workspaceRowRef={workspaceRowRef} /> : <RightSidebar />}
          </div>

          {isClassic ? (
            <DockLeftSidebar toolsOnly disablePopout overlayMode />
          ) : null}
        </div>

        <StatusBar />
        {!isClassic ? <DockContainer /> : null}
      </div>
    </DockProvider>
  );
}
