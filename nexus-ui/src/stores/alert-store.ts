/**
 * ============================================================================
 * alert-store — 实时告警列表（合并 + 截断策略）
 * ============================================================================
 *
 * 【谁写入】`useUnifiedWsFeed` 内 WS 收到 `alert_batch` 时调用 `addAlerts`。
 *
 * 【分配 / 合并策略】`addAlerts` 把新数组 **拼到旧列表前面**：`[...newAlerts, ...s.alerts]`，
 * 再 `.slice(0, MAX_ALERTS)`，防止无限增长（内存「缓存」上限）。
 *
 * 【谁读取】`AlertPanel` / `LeftSidebar` 角标 / `WorkspaceDetails` 态势栏等：`useAlertStore(s => s.alerts)`。
 *
 * 【与 track-store 对比】航迹是全量替换；告警是增量前置 + 截断，适合事件流。
 */

import { create } from "zustand";

export interface AlertData {
  id: string;
  severity: "critical" | "warning" | "info";
  message: string;
  timestamp: string;
  trackId?: string;
  lat?: number;
  lng?: number;
  type?: string;
}

interface AlertState {
  alerts: AlertData[];
  addAlerts: (newAlerts: AlertData[]) => void;
  clearAlerts: () => void;
}

const MAX_ALERTS = 100;

export const useAlertStore = create<AlertState>((set) => ({
  alerts: [],

  addAlerts: (newAlerts) =>
    set((s) => ({
      alerts: [...newAlerts, ...s.alerts].slice(0, MAX_ALERTS),
    })),

  clearAlerts: () => set({ alerts: [] }),
}));
