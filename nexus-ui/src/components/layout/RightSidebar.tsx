"use client";

import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";
import { X, ChevronRight } from "lucide-react";
import { TrackDetail } from "@/components/panels/TrackDetail";

export function RightSidebar() {
  const { rightSidebarOpen, toggleRightSidebar, selectedTrackId } = useAppStore();

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-l border-white/[0.06] bg-nexus-bg-surface/90 backdrop-blur-md transition-all duration-300 ease-in-out",
        rightSidebarOpen ? "w-[360px]" : "w-0 border-l-0 overflow-hidden"
      )}
    >
      {/* 头部 */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
        <span className="text-xs font-semibold tracking-wider text-nexus-text-secondary">
          详情视图
        </span>
        <button
          onClick={toggleRightSidebar}
          className="flex h-6 w-6 items-center justify-center rounded text-nexus-text-muted hover:bg-white/5 hover:text-nexus-text-primary"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {selectedTrackId ? (
          <TrackDetail trackId={selectedTrackId} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <div className="rounded-full border border-white/[0.06] bg-white/5 p-4">
              <ChevronRight size={20} className="text-nexus-text-muted" />
            </div>
            <p className="text-xs text-nexus-text-muted">
              选择一条航迹查看详情
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
