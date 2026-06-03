/**
 * disposal-plan-store — 处置方案状态管理
 *
 * 【核心数据结构】
 *   - DisposalPlanBlock: 一次方案生成的结果（含 taskId、来源、时间、items）
 *   - DisposalPlanCardRow: 单个方案卡片（含 mappedSchemes、执行状态、错误信息）
 *   - blocks: DisposalPlanBlock[] — 方案列表（最新在前）
 *
 * 【数据流】
 *   1. HTTP 手动产生方案 → fetchDisposalPlansHttp → appendFromNormalized(_, "http")
 *   2. WS 自动推送方案 → DisposalPlanWsClient → appendFromNormalized(_, "ws")
 *   3. 用户执行方案 → executeScheme → postDisposalExecute → applySchemeSideEffects
 *      - 激活激光/TDOA 扇区
 *      - 更新执行状态（executedSchemeIds / executingSchemeIds）
 *
 * 【跨方案去重】
 *   - globalExecutedDisposalKeys: 全局已执行方案 key 集合
 *   - 同一目标+设备名组合的方案只执行一次（跨卡片继承）
 *   - getExecutionTrackingKey: targetId + 设备名集合（排序后 \u001f 拼接）
 *
 * 【地图效果管理】
 *   - applySchemeSideEffects: 执行成功后激活激光/TDOA
 *   - reconcileDisposalMapEffectsForIncomingPayload: 新方案包到达时收敛旧效果
 *   - cleanupEffectsForMissingTargets: 目标消失时清理激光/TDOA
 *   - clearBlocks: 全清时同时清理所有地图效果
 */

"use client";

import { create } from "zustand";
import { postDisposalExecute } from "@/lib/disposal/disposal-api";
import type {
  DisposalInputParams,
  DisposalPlanSource,
  MappedDisposalScheme,
  MappedDisposalTask,
  NormalizedDisposalPlans,
} from "@/lib/disposal/disposal-types";
import {
  getExecutionTrackingKey,
  primaryTargetIdFromNormalized,
} from "@/lib/disposal/disposal-execution-utils";
import { activateLaser, deactivateAllLasers, deactivateLaser } from "@/lib/laser-activation";
import { activateTdoa, deactivateAllTdoa, deactivateTdoa } from "@/lib/tdoa-activation";
import {
  clearAllConnectionLines,
  resolveTrackLngLatForTargetId,
} from "@/lib/asset-target-line";
import { setLaserActivationEnabled, setTdoaActivationEnabled } from "@/lib/map-app-config";
import { useAssetStore } from "@/stores/asset-store";
import { useTaskProgressStore } from "@/stores/task-progress-store";
import {
  clearAllWeaponActivationSuppressions,
  clearWeaponActivationSuppression,
  suppressWeaponActivationForTargetDevices,
} from "@/lib/weapon/weapon-device-runtime";
import { toast } from "sonner";

export type DisposalWsStatus = "idle" | "connecting" | "open" | "error";
export type DisposalRunMode = "manual" | "auto";

export interface DisposalPlanCardRow {
  cardInstanceId: string;
  userQuery: string;
  inputParams: DisposalInputParams;
  mappedSchemes: MappedDisposalScheme[];
  noPlansReason?: string;
  executedSchemeIds: string[];
  /** 可同时多条在请求中：同卡片内多方案可依次/并行执行，互不锁其它方案 */
  executingSchemeIds: string[];
  lastError: string | null;
}

export interface DisposalPlanBlock {
  blockId: string;
  taskId: string;
  source: DisposalPlanSource;
  createdAt: number;
  summary: string;
  items: DisposalPlanCardRow[];
}

function randomId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function buildBlockSummary(source: DisposalPlanSource, taskId: string, itemCount: number): string {
  const src = source === "ws" ? "实时推送" : "一键处置";
  return `${src} · 任务 ${taskId} · ${itemCount} 组方案`;
}

function blockPrimaryTargetId(b: DisposalPlanBlock): string {
  const ip = b.items[0]?.inputParams;
  return ip?.targetId != null ? String(ip.targetId).trim() : "";
}

function targetIdForAutoExecute(block: DisposalPlanBlock, row: DisposalPlanCardRow, scheme: MappedDisposalScheme): string {
  return String(row.inputParams?.targetId ?? scheme.disposalTargetId ?? blockPrimaryTargetId(block) ?? "").trim();
}

function disposalTargetExists(targetId: string): boolean {
  return !!targetId && resolveTrackLngLatForTargetId(targetId) != null;
}

/** 跨方案卡片继承：与 V2 DisposalCard `executedExecutionKeys` 一致 */
const globalExecutedDisposalKeys = new Set<string>();
const activatedLaserDeviceIds = new Set<string>();
const activatedTdoaDeviceIds = new Set<string>();
const activatedDevicesByTarget = new Map<string, { lasers: Set<string>; tdoa: Set<string> }>();
let cleanupMissingTargetsInProgress = false;

function clearDisposalActivationState(): void {
  const ids = [...new Set([...activatedLaserDeviceIds, ...activatedTdoaDeviceIds])];
  globalExecutedDisposalKeys.clear();
  activatedLaserDeviceIds.clear();
  activatedTdoaDeviceIds.clear();
  activatedDevicesByTarget.clear();
  clearAllWeaponActivationSuppressions();
  for (const id of ids) {
    markSchemeWeaponStandby(id);
  }
}

function activationBucketForTarget(targetId: string): { lasers: Set<string>; tdoa: Set<string> } {
  const tid = String(targetId ?? "").trim();
  let bucket = activatedDevicesByTarget.get(tid);
  if (!bucket) {
    bucket = { lasers: new Set<string>(), tdoa: new Set<string>() };
    activatedDevicesByTarget.set(tid, bucket);
  }
  return bucket;
}

function setSchemeWeaponDeviceState(deviceId: string, deviceState: 0 | 2): void {
  const id = String(deviceId ?? "").trim();
  if (!id) return;
  const store = useAssetStore.getState();
  const cur = store.assets.find((a) => a.id === id);
  if (!cur) return;
  const props =
    cur.properties && typeof cur.properties === "object"
      ? (cur.properties as Record<string, unknown>)
      : {};
  const label = deviceState === 2 ? "执行" : "待机";
  const nextStatus = deviceState === 2 ? "online" : "offline";
  const nextSchemeActivated = deviceState === 2;
  if (
    cur.status === nextStatus &&
    Number(props.deviceState) === deviceState &&
    props.deviceStateLabel === label &&
    props.schemeActivatedWeapon === nextSchemeActivated
  ) {
    return;
  }
  store.mergeAssetFields(id, {
    status: nextStatus,
    properties: {
      ...props,
      deviceState,
      deviceStateLabel: label,
      schemeActivatedWeapon: nextSchemeActivated,
    },
  });
}

function markSchemeWeaponExecuting(deviceId: string): void {
  setSchemeWeaponDeviceState(deviceId, 2);
}

function markSchemeWeaponStandby(deviceId: string): void {
  setSchemeWeaponDeviceState(deviceId, 0);
}

/**
 * 判断任务是否为激光/光电/打击类（用于激活激光扇区）。
 * 匹配 actionName/deviceId/unitType 中的关键词。
 */
function taskLooksLikeLaser(task: MappedDisposalTask): boolean {
  const a = String(task.actionName ?? "").toLowerCase();
  if (
    a.includes("laser") ||
    a.includes("激光") ||
    a.includes("光电") ||
    a.includes("可见光") ||
    a.includes("红外") ||
    a.includes("打击")
  )
    return true;
  const red = task.redForceInfo as Record<string, unknown> | undefined;
  const ut = String(red?.unitType ?? "").toLowerCase();
  if (ut.includes("laser") || ut.includes("camera") || ut.includes("opto")) return true;
  const id = String(task.deviceId ?? "").toLowerCase();
  if (id.includes("laser") || id.includes("opto") || id.includes("camera")) return true;
  return false;
}

/**
 * 判断任务是否为 TDOA/电侦/电子压制类（用于激活 TDOA 扇区）。
 * 匹配 actionName/deviceId/unitType 中的关键词。
 */
function taskLooksLikeTdoa(task: MappedDisposalTask): boolean {
  const a = String(task.actionName ?? "").toLowerCase();
  if (
    a.includes("tdoa") ||
    a.includes("电侦") ||
    a.includes("电子侦察") ||
    a.includes("定向压制") ||
    a.includes("压制覆盖")
  )
    return true;
  const red = task.redForceInfo as Record<string, unknown> | undefined;
  const ut = String(red?.unitType ?? "").toLowerCase();
  if (ut.includes("tdoa") || ut.includes("electronic") || ut.includes("电侦")) return true;
  const id = String(task.deviceId ?? "").toLowerCase();
  if (id.includes("tdoa")) return true;
  return false;
}

/**
 * 解析处置目标的经纬度坐标（用于激光/TDOA 扇区定位）。
 * 优先从 track-store 查找实时航迹坐标，回退到 blueForceInfo 中的静态坐标。
 */
function resolveDisposalTargetLngLat(
  targetId: string,
  _inputParams: DisposalInputParams | undefined,
  blue: Record<string, unknown> | undefined,
): { lng: number; lat: number } | null {
  const fromTrack = resolveTrackLngLatForTargetId(targetId);
  if (fromTrack) return fromTrack;
  const lng = Number(blue?.longitude);
  const lat = Number(blue?.latitude);
  if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat };
  return null;
}

/**
 * 方案 task.deviceId 是否与当前系统「可指代的资产」对齐。
 *
 * - 雷达/光电/激光/TDOA 等：资产行 `id` 即实体 id。
 * - 无人机：资产行 `id` 为 **deviceSn**，处置/告警里常为 **entityId**（如 `uav-102`），
 *   与 `properties.entity_id` 及 `asset-store.entityIdToDeviceSn` 一致。
 */
function assetIdExistsInStore(deviceId: string): boolean {
  const raw = String(deviceId ?? "").trim();
  if (!raw) return false;
  const low = raw.toLowerCase();
  const assets = useAssetStore.getState().assets;

  if (assets.some((a) => a.id === raw || a.id.toLowerCase() === low)) return true;

  for (const a of assets) {
    const p = a.properties && typeof a.properties === "object" ? (a.properties as Record<string, unknown>) : null;
    if (!p) continue;
    const eid = p.entity_id ?? p.entityId;
    if (typeof eid === "string" && (eid === raw || eid.toLowerCase() === low)) return true;
  }

  const entityMap = useAssetStore.getState().entityIdToDeviceSn;
  let sn: string | undefined = entityMap[raw];
  if (!sn) {
    for (const [eid, mappedSn] of Object.entries(entityMap)) {
      if (eid.toLowerCase() === low) {
        sn = mappedSn;
        break;
      }
    }
  }
  if (sn) {
    const sl = sn.toLowerCase();
    if (assets.some((a) => a.id === sn || a.id.toLowerCase() === sl)) return true;
  }

  return false;
}

/** 方案内引用的设备 id 在资产列表中不存在时返回去重后的原始 id 列表（大小写保留首条） */
function missingSchemeDeviceIds(scheme: MappedDisposalScheme): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const task of scheme.tasks) {
    const raw = String(task.deviceId ?? "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!assetIdExistsInStore(raw)) out.push(raw);
  }
  return out;
}

function toastMissingSchemeAssets(scheme: MappedDisposalScheme, missingIds: string[]): void {
  const name = String(scheme.schemeName ?? "").trim() || scheme.schemeId;
  const list =
    missingIds.length <= 5
      ? missingIds.join("、")
      : `${missingIds.slice(0, 5).join("、")} 等共 ${missingIds.length} 个`;
  toast.error("处置方案：未找到对应资产", {
    description: `「${name}」中的设备 id 在当前资产列表中不存在：${list}。已跳过这些任务的地图激活。`,
    duration: 8000,
  });
}

/**
 * 去掉某资产上处置触发的专题层状态（激光扇区/TDOA 扇区）。
 * 非激光/TDOA 类设备调用为 no-op。
 */
function releaseDisposalAssetBindings(deviceId: string, kind?: "laser" | "tdoa"): void {
  const id = String(deviceId ?? "").trim();
  if (!id) return;
  let released = false;
  if (kind === undefined || kind === "laser") {
    released = activatedLaserDeviceIds.delete(id) || released;
    deactivateLaser(id);
  }
  if (kind === undefined || kind === "tdoa") {
    released = activatedTdoaDeviceIds.delete(id) || released;
    deactivateTdoa(id);
  }
  if (released || kind === undefined) {
    markSchemeWeaponStandby(id);
  }
}

function releaseActivatedDeviceForTarget(targetId: string, deviceId: string): void {
  const tid = String(targetId ?? "").trim();
  const id = String(deviceId ?? "").trim();
  if (!tid || !id) return;
  const bucket = activatedDevicesByTarget.get(tid);
  if (!bucket) return;
  const wasLaser = bucket.lasers.has(id);
  const wasTdoa = bucket.tdoa.has(id);
  bucket.lasers.delete(id);
  bucket.tdoa.delete(id);
  if (bucket.lasers.size === 0 && bucket.tdoa.size === 0) {
    activatedDevicesByTarget.delete(tid);
  }
  if (wasLaser) releaseDisposalAssetBindings(id, "laser");
  if (wasTdoa) releaseDisposalAssetBindings(id, "tdoa");
}

function releaseAllActivatedDevicesForTarget(targetId: string): string[] {
  const tid = String(targetId ?? "").trim();
  if (!tid) return [];
  const bucket = activatedDevicesByTarget.get(tid);
  if (!bucket) return [];
  const ids = [...new Set([...bucket.lasers, ...bucket.tdoa])];
  const lasers = [...bucket.lasers];
  const tdoa = [...bucket.tdoa];
  activatedDevicesByTarget.delete(tid);
  for (const id of lasers) releaseDisposalAssetBindings(id, "laser");
  for (const id of tdoa) releaseDisposalAssetBindings(id, "tdoa");
  syncGlobalActivationFlagsByCurrentDevices();
  return ids;
}

function syncGlobalActivationFlagsByCurrentDevices(): void {
  if (activatedLaserDeviceIds.size === 0) setLaserActivationEnabled(false);
  if (activatedTdoaDeviceIds.size === 0) setTdoaActivationEnabled(false);
}

function allowedWeaponDevicesByTarget(n: NormalizedDisposalPlans): Map<string, { lasers: Set<string>; tdoa: Set<string> }> {
  const out = new Map<string, { lasers: Set<string>; tdoa: Set<string> }>();
  for (const item of n.items || []) {
    const fallbackTid = String(item.inputParams?.targetId ?? primaryTargetIdFromNormalized(n) ?? "").trim();
    for (const sch of item.mappedSchemes || []) {
      const targetId = String(item.inputParams?.targetId ?? sch.disposalTargetId ?? fallbackTid ?? "").trim();
      if (!targetId) continue;
      let bucket = out.get(targetId);
      if (!bucket) {
        bucket = { lasers: new Set<string>(), tdoa: new Set<string>() };
        out.set(targetId, bucket);
      }
      for (const task of sch.tasks || []) {
        const id = String(task.deviceId ?? "").trim();
        if (!id) continue;
        if (taskLooksLikeLaser(task)) bucket.lasers.add(id);
        if (taskLooksLikeTdoa(task)) bucket.tdoa.add(id);
      }
    }
  }
  return out;
}

/**
 * 同一目标后续推送的新处置包若缩小了参与设备集合：此前激活的激光/TDOA 等需收敛，
 * 否则会一直显示旧设备扇区跟随（见 WS 连续两包方案设备集合不一致）。
 */
function reconcileDisposalMapEffectsForIncomingPayload(n: NormalizedDisposalPlans): void {
  const allowedByTarget = allowedWeaponDevicesByTarget(n);
  for (const [targetId, active] of [...activatedDevicesByTarget.entries()]) {
    const allowed = allowedByTarget.get(targetId);
    if (!allowed) continue;
    const removed: string[] = [];
    for (const id of [...active.lasers]) {
      if (allowed.lasers.has(id)) continue;
      releaseActivatedDeviceForTarget(targetId, id);
      removed.push(id);
    }
    for (const id of [...active.tdoa]) {
      if (allowed.tdoa.has(id)) continue;
      releaseActivatedDeviceForTarget(targetId, id);
      removed.push(id);
    }
    if (removed.length > 0) {
      useTaskProgressStore.getState().terminateByTargetDevices(targetId, removed);
    }
  }
  syncGlobalActivationFlagsByCurrentDevices();
}

function applySchemeSideEffects(scheme: MappedDisposalScheme, inputParams: DisposalInputParams | undefined): void {
  const tid = String(inputParams?.targetId ?? "").trim();

  const missingIds = missingSchemeDeviceIds(scheme);
  const missingSet = new Set(missingIds.map((id) => id.toLowerCase()));
  if (missingIds.length > 0) {
    toastMissingSchemeAssets(scheme, missingIds);
  }

  for (const task of scheme.tasks) {
    const rawDev = String(task.deviceId ?? "").trim();
    if (rawDev && missingSet.has(rawDev.toLowerCase())) continue;

    const blue = task.blueForceInfo as Record<string, unknown> | undefined;
    const targetCoords = resolveDisposalTargetLngLat(String(task.targetId ?? tid), inputParams, blue);

    const trackId = String(task.targetId ?? tid).trim();
    if (!trackId) continue;

    if (taskLooksLikeLaser(task) && targetCoords) {
      clearWeaponActivationSuppression(trackId, task.deviceId);
      if (
        activateLaser(task.deviceId, targetCoords.lng, targetCoords.lat, {
          trackTargetId: trackId,
          inputParams,
        })
      ) {
        activatedLaserDeviceIds.add(task.deviceId);
        activationBucketForTarget(trackId).lasers.add(task.deviceId);
        markSchemeWeaponExecuting(task.deviceId);
      }
    }

    if (taskLooksLikeTdoa(task) && targetCoords) {
      clearWeaponActivationSuppression(trackId, task.deviceId);
      if (
        activateTdoa(task.deviceId, targetCoords.lng, targetCoords.lat, {
          trackTargetId: trackId,
          inputParams,
        })
      ) {
        activatedTdoaDeviceIds.add(task.deviceId);
        activationBucketForTarget(trackId).tdoa.add(task.deviceId);
        markSchemeWeaponExecuting(task.deviceId);
      }
    }
  }
}

export interface DisposalPlanState {
  blocks: DisposalPlanBlock[];
  wsStatus: DisposalWsStatus;
  runMode: DisposalRunMode;
  setWsStatus: (s: DisposalWsStatus) => void;
  setRunMode: (mode: DisposalRunMode) => void;
  appendFromNormalized: (n: NormalizedDisposalPlans, source: DisposalPlanSource) => void;
  clearBlocks: () => void;
  cleanupEffectsForMissingTargets: () => void;
  executeScheme: (blockId: string, cardInstanceId: string, scheme: MappedDisposalScheme) => Promise<boolean>;
  executeBestSchemesByTarget: (block: DisposalPlanBlock) => Promise<boolean[]>;
}

export const useDisposalPlanStore = create<DisposalPlanState>((set, get) => ({
  blocks: [],
  wsStatus: "idle",
  runMode: "manual",

  setWsStatus: (s) => set({ wsStatus: s }),
  setRunMode: (mode) => set({ runMode: mode }),

  /**
   * 将归一化后的方案包写入 store。
   * 数据流：normalizeDisposalPayload → 本方法 → blocks 列表更新 → DisposalPlanFeed 重新渲染
   *
   * 步骤：
   *   1. reconcileDisposalMapEffectsForIncomingPayload: 收敛旧方案包的地图效果（激光/TDOA）
   *   2. 遍历 items，为每个 DisposalPlanCardRow 生成 cardInstanceId
   *   3. 跨卡片继承：检查 globalExecutedDisposalKeys，标记已执行方案
   *   4. 构建 DisposalPlanBlock 并插入 blocks 列表（最新在前）
   */
  appendFromNormalized: (n, source) => {
    const now = Date.now();
    const { blocks } = get();
    const targetId = primaryTargetIdFromNormalized(n);

    // 按 taskId 去重：同一任务不重复插入
    if (n.taskId && blocks.some((b) => b.taskId === n.taskId)) {
      console.log("[DisposalPlanStore] duplicate taskId skipped:", n.taskId);
      return;
    }

    reconcileDisposalMapEffectsForIncomingPayload(n);

    const items: DisposalPlanCardRow[] = (n.items || []).map((it, idx) => {
      const tidForKeys = String(it.inputParams?.targetId ?? targetId ?? "").trim();
      const preExecuted: string[] = [];
      for (const sch of it.mappedSchemes || []) {
        const k = getExecutionTrackingKey(tidForKeys, sch);
        if (k && globalExecutedDisposalKeys.has(k)) {
          preExecuted.push(sch.schemeId);
        }
      }
      return {
        cardInstanceId: `card_${source}_${now}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
        userQuery: it.userQuery,
        inputParams: it.inputParams,
        mappedSchemes: it.mappedSchemes,
        noPlansReason: it.noPlansReason,
        executedSchemeIds: [...new Set(preExecuted)],
        executingSchemeIds: [],
        lastError: null,
      };
    });

    const summary = buildBlockSummary(source, n.taskId, items.length);
    const block: DisposalPlanBlock = {
      blockId: `blk_${randomId()}`,
      taskId: n.taskId,
      source,
      createdAt: now,
      summary,
      items,
    };
    set({ blocks: [...blocks, block] });

    if (get().runMode === "auto") {
      void get().executeBestSchemesByTarget(block);
    }
  },

  clearBlocks: () => {
    deactivateAllLasers();
    deactivateAllTdoa();
    setLaserActivationEnabled(false);
    setTdoaActivationEnabled(false);
    clearAllConnectionLines();
    clearDisposalActivationState();
    set({ blocks: [] });
  },

  cleanupEffectsForMissingTargets: () => {
    if (cleanupMissingTargetsInProgress) return;
    cleanupMissingTargetsInProgress = true;
    try {
      const progressTargets = useTaskProgressStore
        .getState()
        .entries
        .filter((e) => e.status === "executing")
        .map((e) => String(e.targetId ?? "").trim())
        .filter(Boolean);
      const candidateTargetIds = new Set([...activatedDevicesByTarget.keys(), ...progressTargets]);
      const missingTargetIds = new Set<string>();

      for (const targetId of candidateTargetIds) {
        if (resolveTrackLngLatForTargetId(targetId) != null) continue;
        missingTargetIds.add(targetId);
        const released = releaseAllActivatedDevicesForTarget(targetId);
        suppressWeaponActivationForTargetDevices(targetId, released);
      }

      if (missingTargetIds.size > 0) {
        for (const targetId of missingTargetIds) {
          useTaskProgressStore.getState().endByTarget(targetId);
        }
      }
      syncGlobalActivationFlagsByCurrentDevices();
    } finally {
      cleanupMissingTargetsInProgress = false;
    }
  },

  /**
   * 执行方案：POST grpc-disposal/execute → 成功后激活地图效果（激光/TDOA）
   *
   * 执行流：
   *   1. 标记 scheme 为 executing（UI 显示 loading）
   *   2. postDisposalExecute 发送执行请求
   *   3. 成功：applySchemeSideEffects（激活激光/TDOA）
   *          + 写入 globalExecutedDisposalKeys（跨卡片去重）
   *   4. 失败：toast 提示 + 记录 lastError
   *   5. 更新 executedSchemeIds / executingSchemeIds 状态
   */
  executeScheme: async (blockId, cardInstanceId, scheme) => {
    const { blocks } = get();
    const block = blocks.find((b) => b.blockId === blockId);
    if (!block) return false;
    const row = block.items.find((r) => r.cardInstanceId === cardInstanceId);
    const parentTaskId = block.taskId;
    const createdTaskId = `${parentTaskId}_${scheme.schemeId}`;

    set((st) => ({
      blocks: st.blocks.map((b) => {
        if (b.blockId !== blockId) return b;
        return {
          ...b,
          items: b.items.map((r) => {
            if (r.cardInstanceId !== cardInstanceId) return r;
            const ids = new Set(r.executingSchemeIds);
            ids.add(scheme.schemeId);
            return {
              ...r,
              executingSchemeIds: [...ids],
              lastError: null,
            };
          }),
        };
      }),
    }));

    const result = await postDisposalExecute(scheme, parentTaskId);
    const ok = result.ok && result.success !== false;

    if (ok) {
      applySchemeSideEffects(scheme, row?.inputParams);
      const tid = row ? targetIdForAutoExecute(block, row, scheme) : String(scheme.disposalTargetId ?? blockPrimaryTargetId(block) ?? "").trim();
      const execKey = getExecutionTrackingKey(tid, scheme);
      if (execKey) globalExecutedDisposalKeys.add(execKey);
      // 写入任务进展
      if (tid) {
        const progressItems = scheme.tasks
          .filter((t) => String(t.deviceId ?? "").trim())
          .map((t) => ({
            targetId: tid,
            deviceId: String(t.deviceId).trim(),
            deviceName: String(t.deviceName || t.deviceId).trim(),
            schemeId: scheme.schemeId,
            blockId,
          }));
        if (progressItems.length > 0) useTaskProgressStore.getState().addEntries(progressItems);
      }
    } else {
      toast.error("方案执行失败", { description: result.message ?? "执行失败" });
    }

    set((st) => ({
      blocks: st.blocks.map((b) => {
        if (b.blockId !== blockId) return b;
        return {
          ...b,
          items: b.items.map((r) => {
            if (r.cardInstanceId !== cardInstanceId) return r;
            const executed = new Set(r.executedSchemeIds);
            if (ok) executed.add(scheme.schemeId);
            const still = r.executingSchemeIds.filter((id) => id !== scheme.schemeId);
            return {
              ...r,
              executingSchemeIds: still,
              executedSchemeIds: [...executed],
              lastError: ok ? null : (result.message ?? "执行失败"),
            };
          }),
        };
      }),
    }));

    if (!ok) {
      console.warn("[DisposalPlan] execute failed", createdTaskId, result);
    }
    return ok;
  },
  executeBestSchemesByTarget: async (block) => {
    const jobs: Array<Promise<boolean>> = [];
    for (const row of block.items) {
      let best: MappedDisposalScheme | null = null;
      for (const scheme of row.mappedSchemes) {
        if (
          !best ||
          scheme.priority < best.priority ||
          (scheme.priority === best.priority && scheme.maxRecommendationScore > best.maxRecommendationScore)
        ) {
          best = scheme;
        }
      }
      if (!best) continue;
      const targetId = targetIdForAutoExecute(block, row, best);
      if (!disposalTargetExists(targetId)) continue;
      if (row.executedSchemeIds.includes(best.schemeId)) continue;
      if (row.executingSchemeIds.includes(best.schemeId)) continue;
      jobs.push(get().executeScheme(block.blockId, row.cardInstanceId, best));
    }
    if (!jobs.length) return [];
    return Promise.all(jobs);
  },
}));
