/**
 * 按「本条告警 trackId」收集正在执行的处置设备（严格 ID 匹配，不扫无关方案）。
 */

import type { MappedDisposalTask } from "@/lib/disposal/disposal-types";
import { taskLooksLikeMunition } from "@/lib/disposal/disposal-execution-utils";
import { useDisposalPlanStore } from "@/stores/disposal-plan-store";
import { useTaskProgressStore } from "@/stores/task-progress-store";
import { getRenderCache } from "@/stores/track-store";

function norm(s: unknown): string {
  return String(s ?? "").trim();
}

function taskBelongsToTrack(task: MappedDisposalTask, trackId: string): boolean {
  const tid = norm(trackId);
  if (!tid) return false;
  const taskTarget = norm(task.targetId);
  // task 未填 targetId 时继承卡片目标；填了则必须与 trackId 一致
  return !taskTarget || taskTarget === tid;
}

function minimalTask(deviceId: string): MappedDisposalTask {
  return {
    deviceId,
    deviceName: deviceId,
    targetId: "",
    actionName: "",
    recommendationScore: 0,
    redForceInfo: {},
    blueForceInfo: {},
  };
}

export interface ActiveDisposalForTrack {
  /** 参与处置的全部设备 entityId（POST body createdBy.entityId 逗号拼接） */
  deviceEntityIds: string[];
  /** 其中识别为巡飞弹/飞弹的 entityId（仅此列表走 DELETE） */
  munitionEntityIds: string[];
}

/**
 * 仅收集与 trackId 严格匹配的正在执行处置：
 * - task-progress：targetId === trackId 且 executing
 * - disposal-plan：卡片 inputParams.targetId === trackId，且 scheme 在 executed/executing 中
 */
export function collectActiveDisposalForTrack(trackId: string): ActiveDisposalForTrack {
  const tid = norm(trackId);
  const deviceSeen = new Set<string>();
  const munitionSeen = new Set<string>();
  const deviceEntityIds: string[] = [];
  const munitionEntityIds: string[] = [];

  const pushDevice = (id: string, task?: MappedDisposalTask) => {
    const d = norm(id);
    if (!d || deviceSeen.has(d)) return;
    deviceSeen.add(d);
    deviceEntityIds.push(d);
    const t = task ?? minimalTask(d);
    if (taskLooksLikeMunition(t) && !munitionSeen.has(d)) {
      munitionSeen.add(d);
      munitionEntityIds.push(d);
    }
  };

  if (!tid) return { deviceEntityIds, munitionEntityIds };

  for (const e of useTaskProgressStore.getState().entries) {
    if (e.targetId === tid && e.status === "executing") {
      pushDevice(e.deviceId, minimalTask(e.deviceId));
    }
  }

  for (const block of useDisposalPlanStore.getState().blocks) {
    for (const row of block.items) {
      if (norm(row.inputParams?.targetId) !== tid) continue;

      for (const sch of row.mappedSchemes ?? []) {
        const active =
          row.executedSchemeIds.includes(sch.schemeId) || row.executingSchemeIds.includes(sch.schemeId);
        if (!active) continue;

        for (const task of sch.tasks ?? []) {
          if (!taskBelongsToTrack(task, tid)) continue;
          pushDevice(task.deviceId, task);
        }
      }
    }
  }

  return { deviceEntityIds, munitionEntityIds };
}

/** 对空/对海：仅查渲染层航迹缓存 */
export function resolveIsAirTrackFromRenderCache(trackId: string): boolean {
  const tid = norm(trackId);
  if (!tid) return false;
  for (const [, t] of getRenderCache()) {
    if (t.trackId === tid) return t.type === "air";
  }
  return false;
}
