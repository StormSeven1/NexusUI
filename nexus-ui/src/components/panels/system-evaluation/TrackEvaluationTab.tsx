"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTrackEvaluationStore } from "@/stores/track-evaluation-store";
import { TrackFilterSection } from "@/components/panels/track-evaluation/TrackFilterSection";
import { TrackQualitySection } from "@/components/panels/track-evaluation/TrackQualitySection";

function TrackEvalStatusBar() {
  const connectionState = useTrackEvaluationStore((s) => s.connectionState);
  const queryStatus = useTrackEvaluationStore((s) => s.queryStatus);
  const metricsComputing = useTrackEvaluationStore((s) => s.metricsComputing);

  const wsConnected = connectionState === "open";
  const isAnalyzing = queryStatus.type === "loading" || metricsComputing;

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-nexus-border px-2 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {isAnalyzing ? (
          <>
            <Loader2
              className="h-3.5 w-3.5 shrink-0 animate-spin text-nexus-accent"
              aria-hidden
            />
            <span className="text-[11px] font-medium text-nexus-accent">正在分析...</span>
          </>
        ) : null}
      </div>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
          wsConnected
            ? "bg-emerald-500/15 text-emerald-400"
            : connectionState === "connecting"
              ? "bg-amber-500/15 text-amber-400"
              : "bg-nexus-bg-elevated text-nexus-text-muted",
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            wsConnected ? "bg-emerald-400" : "bg-zinc-500",
          )}
        />
        {wsConnected ? "已连接" : connectionState === "connecting" ? "连接中" : "未连接"}
      </span>
    </div>
  );
}

/** 航迹评估：历史查询、区域框选、质量指标（C++ WS） */
export function TrackEvaluationTab() {
  const mainTab = useTrackEvaluationStore((s) => s.mainTab);
  const setMainTab = useTrackEvaluationStore((s) => s.setMainTab);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TrackEvalStatusBar />
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
