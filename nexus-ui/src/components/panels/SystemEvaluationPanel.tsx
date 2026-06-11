"use client";

import { cn } from "@/lib/utils";
import {
  SYSTEM_EVAL_SECTION_TABS,
} from "@/components/panels/system-evaluation/types";
import { TrackEvaluationTab } from "@/components/panels/system-evaluation/TrackEvaluationTab";
import { SystemPerfEvalTab } from "@/components/panels/system-evaluation/SystemPerfEvalTab";
import { CameraEvalTab } from "@/components/panels/system-evaluation/CameraEvalTab";
import { EvalPlaceholderSection } from "@/components/panels/system-evaluation/EvalPlaceholderSection";
import { useSystemEvaluationUiStore } from "@/stores/system-evaluation-ui-store";

export function SystemEvaluationPanel() {
  const section = useSystemEvaluationUiStore((s) => s.section);
  const setSection = useSystemEvaluationUiStore((s) => s.setSection);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {section === "system" ? <SystemPerfEvalTab /> : null}
          {section === "track" ? <TrackEvaluationTab /> : null}
          {section === "camera" ? <CameraEvalTab /> : null}
          {section === "algorithm" ? (
            <EvalPlaceholderSection
              title="算法评估"
              description="按评估类型（对空/对海目标检测）触发后台全流程评估；接口见系统设计文档。"
            />
          ) : null}
        </div>

        <div className="flex w-[92px] shrink-0 flex-col gap-0.5 border-l border-nexus-border bg-nexus-bg-base/40 py-1.5 pl-1 pr-1.5">
          {SYSTEM_EVAL_SECTION_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSection(tab.id)}
              className={cn(
                "rounded-md px-2 py-2 text-left text-[10px] leading-snug transition-colors",
                section === tab.id
                  ? "bg-nexus-accent-glow/20 font-medium text-nexus-text-primary"
                  : "text-nexus-text-muted hover:bg-nexus-bg-elevated hover:text-nexus-text-secondary",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
