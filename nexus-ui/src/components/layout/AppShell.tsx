"use client";

/**
 * 数据入口：`useUnifiedWsFeed`（仅 hooks/useUnifiedWsFeed.ts）负责 WebSocket + 区域/资产轮询。
 */

import { TopNav } from "./TopNav";
import { LeftSidebar } from "./LeftSidebar";
import { RightSidebar } from "./RightSidebar";
import dynamic from "next/dynamic";
import { MapContainer } from "@/components/map/MapContainer";
import { useUnifiedWsFeed } from "@/hooks/useUnifiedWsFeed";

/** 客户端专属：Date.now() 等动态值导致 SSR hydration mismatch，禁用 SSR */
const AgentMessageFloat = dynamic(
  () => import("@/components/AgentMessageFloat").then((m) => m.AgentMessageFloat),
  { ssr: false },
);

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
            <AgentMessageFloat />
          </main>
        </div>

        <RightSidebar />
      </div>
    </div>
  );
}
