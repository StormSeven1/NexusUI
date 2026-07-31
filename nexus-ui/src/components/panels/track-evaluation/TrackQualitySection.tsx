"use client";

import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  QUALITY_METRIC_TABS,
  useTrackEvaluationStore,
} from "@/stores/track-evaluation-store";
import { QualityMetricContent } from "@/components/panels/track-evaluation/QualityMetricContent";
import { openEvalReportPreview } from "@/lib/eval-report/open-eval-report-preview";

export function TrackQualitySection() {
  const qualityTab = useTrackEvaluationStore((s) => s.qualityTab);
  const setQualityTab = useTrackEvaluationStore((s) => s.setQualityTab);
  const metrics = useTrackEvaluationStore((s) => s.metrics);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      {metrics ? (
        <div className="flex shrink-0 items-center justify-end">
          <button
            type="button"
            onClick={() =>
              openEvalReportPreview({
                reuseExistingResults: true,
                selectedKinds: ["track"],
              })
            }
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-nexus-accent/50 bg-nexus-accent/15 px-2 py-1 text-[10px]",
              "text-nexus-text-primary hover:bg-nexus-accent/25",
            )}
            title="用当前航迹质量结果生成评估报告（不重新评估）"
          >
            <FileText size={12} />
            生成评估报告
          </button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="flex w-[120px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-nexus-border pr-1.5">
          {QUALITY_METRIC_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setQualityTab(tab.id)}
              className={cn(
                "rounded-md px-2 py-1.5 text-left text-[11px] leading-snug transition-colors",
                qualityTab === tab.id
                  ? "bg-nexus-accent-glow/20 text-nexus-text-primary"
                  : "text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-secondary",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <QualityMetricContent />
        </div>
      </div>
    </div>
  );
}
