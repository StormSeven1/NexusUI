/**
 * workflow-status-store — 快捷工作流执行状态
 *
 * 【用途】管理快捷工作流执行后的状态追踪，供 WorkflowStatusOverlay 展示。
 *
 * 【生命周期】
 *   1. QuickWorkflowModal 执行成功 → addWorkflow() 写入初始状态
 *   2. WorkflowStatusWsClient 收到 WS 推送 → updateStatus() 更新
 *   3. 成功/失败 → Overlay 自动关闭 → removeWorkflow() 清理
 *
 * 【WS 消息格式】预留，待后端确认后补充解析逻辑
 */

import { create } from "zustand";
import type { WorkflowStatusWsClient } from "@/lib/workflow/workflow-status-ws-client";

export type WorkflowStatus = "starting" | "completed" | "failed" | "interrupted" | "cancelled";

export interface WorkflowStatusEntry {
  /** 工作流唯一标识（POST 时生成的 thread_id，与 WS 的 main_thread_id 匹配） */
  threadId: string;
  /** 工作流配置 ID */
  workflowId: string;
  /** 显示名称 */
  name: string;
  /** 当前状态 */
  status: WorkflowStatus;
  /** 状态描述文字（优先取 data.result.message，否则根据 status 生成） */
  message: string;
  /** 启动时间戳 */
  startedAt: number;
  /** 完成时间戳 */
  completedAt: number | null;
}

interface WorkflowStatusState {
  entries: WorkflowStatusEntry[];
  /** 当前活跃的 WS 客户端，关闭 Overlay 时需要断开 */
  wsClient: WorkflowStatusWsClient | null;
  addWorkflow: (entry: Omit<WorkflowStatusEntry, "status" | "message" | "completedAt">, wsClient: WorkflowStatusWsClient) => void;
  updateStatus: (threadId: string, status: WorkflowStatus, message?: string) => void;
  removeWorkflow: (threadId: string) => void;
  clearAll: () => void;
  /** 关闭 Overlay 并断开 WS */
  closeAndDisconnect: () => void;
}

const STATUS_DEFAULT_MESSAGE: Record<WorkflowStatus, string> = {
  starting: "正在启动…",
  completed: "执行完成",
  failed: "执行失败",
  interrupted: "已中断",
  cancelled: "已取消",
};

const isTerminal = (s: WorkflowStatus) => s === "completed" || s === "failed" || s === "interrupted" || s === "cancelled";

export const useWorkflowStatusStore = create<WorkflowStatusState>((set, get) => ({
  entries: [],
  wsClient: null,

  addWorkflow: (entry, wsClient) =>
    set((s) => ({
      entries: [
        ...s.entries,
        { ...entry, status: "starting", message: STATUS_DEFAULT_MESSAGE.starting, completedAt: null },
      ],
      wsClient,
    })),

  updateStatus: (threadId, status, message) =>
    set((s) => ({
      entries: s.entries.map((e) =>
        e.threadId === threadId
          ? {
              ...e,
              status,
              message: message ?? STATUS_DEFAULT_MESSAGE[status] ?? e.message,
              completedAt: isTerminal(status) ? Date.now() : null,
            }
          : e,
      ),
    })),

  removeWorkflow: (threadId) =>
    set((s) => ({
      entries: s.entries.filter((e) => e.threadId !== threadId),
    })),

  clearAll: () => {
    const ws = get().wsClient;
    if (ws) ws.stop();
    set({ entries: [], wsClient: null });
  },

  closeAndDisconnect: () => {
    const ws = get().wsClient;
    if (ws) ws.stop();
    set({ entries: [], wsClient: null });
  },
}));
