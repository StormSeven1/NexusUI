import type { PanelId } from "@/stores/dock-store";

/** 与 DockLeftSidebar / RightSidebar 共用：某分区内所有 dock 中的面板（按 displayOrder） */
export function dockedPanelsInPartition(
  panels: { id: PanelId; location: string | null; mode: string; displayOrder?: number }[],
  partitionId: string,
) {
  return panels
    .filter((p) => p.location === partitionId && p.mode === "docked")
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
}
