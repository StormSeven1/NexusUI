import type { PanelId } from "@/stores/dock-store";
import { useDockStore } from "@/stores/dock-store";
import {
  useEvalReportStore,
  type CachedSystemPerfSnapshot,
} from "@/stores/eval-report-store";
import type { EvalReportSectionKind } from "@/lib/eval-report/types";

const REPORT_PANEL_ID = "eval-report" as PanelId;

export type OpenEvalReportPreviewOptions = {
  /** 使用质量评估页当前结果，不重新评估（航迹）；系统可附带 cachedSystem */
  reuseExistingResults?: boolean;
  /** 打开时预勾选的章节；不传则按 reuse 决定默认 */
  selectedKinds?: EvalReportSectionKind[];
  /** 系统评估页当前快照（reuse 时系统章节直接使用） */
  cachedSystem?: CachedSystemPerfSnapshot | null;
};

/** 打开评估报告面板（不自动生成；由用户勾选类型后点「开始生成」） */
export function openEvalReportPreview(opts?: OpenEvalReportPreviewOptions): void {
  useEvalReportStore.getState().prepareOpen({
    reuseExistingResults: opts?.reuseExistingResults === true,
    selectedKinds: opts?.selectedKinds,
    cachedSystem: opts?.cachedSystem ?? null,
  });

  const state = useDockStore.getState();
  const existing = state.panels.find((p) => p.id === REPORT_PANEL_ID);

  if (!existing) {
    useDockStore.setState((s) => ({
      panels: [
        ...s.panels,
        {
          id: REPORT_PANEL_ID,
          location: null,
          mode: "popup" as const,
          position: { x: 160, y: 72 },
          size: { width: 720, height: 680 },
          zIndex: s.nextZIndex,
          lastPopupPosition: null,
          displayOrder: 20,
        },
      ],
      nextZIndex: s.nextZIndex + 1,
      activePanelId: REPORT_PANEL_ID,
    }));
  } else {
    useDockStore.setState((s) => ({
      panels: s.panels.map((p) =>
        p.id === REPORT_PANEL_ID
          ? {
              ...p,
              mode: "popup" as const,
              location: null,
              position: p.lastPopupPosition ?? p.position ?? { x: 160, y: 72 },
              size: {
                width: Math.max(p.size?.width ?? 720, 640),
                height: Math.max(p.size?.height ?? 680, 520),
              },
              zIndex: s.nextZIndex,
            }
          : p,
      ),
      nextZIndex: s.nextZIndex + 1,
      activePanelId: REPORT_PANEL_ID,
    }));
  }
}
