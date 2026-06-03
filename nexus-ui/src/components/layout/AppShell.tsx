"use client";

/**
 * 数据入口只保留 `useUnifiedWsFeed`。
 * 注册区域/航线现在也通过 Custombackend WS `DbAreas` 下发，不再由前端主动轮询数据库。
 */

import { TopNav } from "./TopNav";
import { LeftSidebar } from "./LeftSidebar";
import { RightSidebar } from "./RightSidebar";
import { EoVideoModal } from "@/components/eo-video/EoVideoModal";
import dynamic from "next/dynamic";
import { MapContainer } from "@/components/map/MapContainer";
import { useUnifiedWsFeed } from "@/hooks/useUnifiedWsFeed";

const AgentMessageFloat = dynamic(
  () => import("@/components/AgentMessageFloat").then((m) => m.AgentMessageFloat),
  { ssr: false },
);

export function AppShell() {
  useUnifiedWsFeed();

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-nexus-bg-base">
      <TopNav />
      <div className="relative flex flex-1 overflow-hidden">
        <LeftSidebar />
        <div className="relative flex flex-1 flex-col overflow-hidden">
          <main className="relative flex-1 overflow-hidden">
            <MapContainer />
            <AgentMessageFloat />
            <EoVideoModal />
          </main>
        </div>
        <RightSidebar />
      </div>
    </div>
  );
}
