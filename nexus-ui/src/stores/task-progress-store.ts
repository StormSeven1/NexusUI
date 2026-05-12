/**
 * task-progress-store — 任务进展状态管理
 *
 * 【数据流】
 *   - executeScheme 成功 → addEntries（状态 executing）
 *   - 用户点击「消灭」  → endByTarget（状态 ended，强制停止该目标所有任务）
 *   - 方案更新淘汰旧方案 → terminateByKeys（状态 terminated）
 */

"use client";

import { create } from "zustand";

export type TaskProgressStatus = "executing" | "ended" | "terminated";

export interface TaskProgressEntry {
  id: string;
  targetId: string;
  deviceId: string;
  deviceName: string;
  schemeId: string;
  blockId: string;
  startedAt: number;
  endedAt?: number;
  status: TaskProgressStatus;
}

interface TaskProgressState {
  entries: TaskProgressEntry[];
  /** 执行方案成功后批量写入 */
  addEntries: (items: Omit<TaskProgressEntry, "id" | "startedAt" | "status">[]) => void;
  /** 消灭目标：该 targetId 下所有 executing 条目 → ended */
  endByTarget: (targetId: string) => void;
  /** 方案更新淘汰：指定 blockId + schemeId 组合 → terminated */
  terminateEntries: (pairs: { blockId: string; schemeId: string }[]) => void;
  /** 按 targetId + deviceId 判断是否已有 executing 条目（避免重复写入） */
  hasExecuting: (targetId: string, deviceId: string) => boolean;
  clearAll: () => void;
}

let _seq = 0;
function nextId(): string {
  return `tp_${Date.now().toString(36)}_${(++_seq).toString(36)}`;
}

export const useTaskProgressStore = create<TaskProgressState>((set, get) => ({
  entries: [],

  addEntries: (items) => {
    const now = Date.now();
    const cur = get().entries;
    const newEntries = items
      .filter((it) => {
        // 同 targetId + deviceId 如果已有 executing，跳过
        return !cur.some(
          (e) => e.targetId === it.targetId && e.deviceId === it.deviceId && e.status === "executing",
        );
      })
      .map((it) => ({
        ...it,
        id: nextId(),
        startedAt: now,
        status: "executing" as const,
      }));
    if (newEntries.length === 0) return;
    set({ entries: [...cur, ...newEntries] });
  },

  endByTarget: (targetId) => {
    set((s) => ({
      entries: s.entries.map((e) =>
        e.targetId === targetId && e.status === "executing" ? { ...e, status: "ended", endedAt: Date.now() } : e,
      ),
    }));
  },

  terminateEntries: (pairs) => {
    if (pairs.length === 0) return;
    const keySet = new Set(pairs.map((p) => `${p.blockId}|${p.schemeId}`));
    set((s) => ({
      entries: s.entries.map((e) =>
        e.status === "executing" && keySet.has(`${e.blockId}|${e.schemeId}`) ? { ...e, status: "terminated", endedAt: Date.now() } : e,
      ),
    }));
  },

  hasExecuting: (targetId, deviceId) => {
    return get().entries.some((e) => e.targetId === targetId && e.deviceId === deviceId && e.status === "executing");
  },

  clearAll: () => set({ entries: [] }),
}));
