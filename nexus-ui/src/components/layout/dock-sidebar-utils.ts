import type { PanelId } from "@/stores/dock-store";

export const LEFT_DOCK_TOOL_IDS = [
  "tracks",
  "assets",
  "layers",
  "alerts",
  "track-display",
] as const satisfies readonly PanelId[];

export const RIGHT_DOCK_TOOL_IDS = [
  "target-profile",
  "system-evaluation",
  "chat",
] as const satisfies readonly PanelId[];

/** 旧版 cleanup 曾写入 left-default/right-default，UI 只认 left-0/right-0 等 */
export function normalizeDockPartitionId(partitionId: string): string {
  if (partitionId === "left-default") return "left-0";
  if (partitionId === "right-default") return "right-0";
  return partitionId;
}

/** 与 DockLeftSidebar / RightSidebar 共用：某分区内所有 dock 中的面板（按 displayOrder） */
export function dockedPanelsInPartition(
  panels: { id: PanelId; location: string | null; mode: string; displayOrder?: number }[],
  partitionId: string,
) {
  const normalized = normalizeDockPartitionId(partitionId);
  return panels
    .filter(
      (p) =>
        p.mode === "docked" &&
        (p.location === partitionId ||
          p.location === normalized ||
          (p.location != null && normalizeDockPartitionId(p.location) === normalized)),
    )
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
}
