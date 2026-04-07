"use client";

import { TopToolbar } from "./TopToolbar";
import { LeftSidebar } from "./LeftSidebar";
import { RightSidebar } from "./RightSidebar";
import { StatusBar } from "./StatusBar";
import { MapContainer } from "@/components/map/MapContainer";

export function AppShell() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <TopToolbar />
      <div className="relative flex flex-1 overflow-hidden">
        <LeftSidebar />
        <main className="relative flex-1 overflow-hidden">
          <MapContainer />
        </main>
        <RightSidebar />
      </div>
      <StatusBar />
    </div>
  );
}
