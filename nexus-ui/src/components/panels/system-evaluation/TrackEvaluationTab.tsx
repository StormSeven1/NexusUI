"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useTrackEvaluationStore } from "@/stores/track-evaluation-store";
import { TrackFilterSection } from "@/components/panels/track-evaluation/TrackFilterSection";
import { TrackQualitySection } from "@/components/panels/track-evaluation/TrackQualitySection";

/** 航迹评估：历史查询、区域框选、质量指标（C++ WS） */
export function TrackEvaluationTab() {
  const mainTab = useTrackEvaluationStore((s) => s.mainTab);
  const setMainTab = useTrackEvaluationStore((s) => s.setMainTab);
  const connectWs = useTrackEvaluationStore((s) => s.connectWs);
  const disconnectWs = useTrackEvaluationStore((s) => s.disconnectWs);

  useEffect(() => {
    connectWs();
    return () => disconnectWs();
  }, [connectWs, disconnectWs]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 border-b border-nexus-border px-2 py-1.5">
        {(
          [
            { id: "filter" as const, label: "航迹筛选" },
            { id: "quality" as const, label: "质量评估" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMainTab(tab.id)}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
              mainTab === tab.id
                ? "bg-nexus-accent-glow/20 text-nexus-text-primary"
                : "text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-secondary",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-2">
        {mainTab === "filter" ? <TrackFilterSection /> : <TrackQualitySection />}
      </div>
    </div>
  );
}
