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
 *      - 绘制资产→目标连线
 *      - 更新执行状态（executedSchemeIds / executingSchemeIds）
 *
 * 【跨方案去重】
 *   - globalExecutedDisposalKeys: 全局已执行方案 key 集合
 *   - 同一目标+设备名组合的方案只执行一次（跨卡片继承）
 *   - getExecutionTrackingKey: targetId + 设备名集合（排序后 \u001f 拼接）
 *
 * 【地图效果管理】
 *   - applySchemeSideEffects: 执行成功后激活激光/TDOA + 绘制连线
 *   - reconcileDisposalMapEffectsForIncomingPayload: 新方案包到达时收敛旧效果
 *   - cleanupEffectsForMissingTargets: 目标消失时清理连线与激光/TDOA
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
  collectAllDeviceIdsFromNormalized,
  getExecutionTrackingKey,
  inferIsAirTrackFromInputParams,
  primaryTargetIdFromNormalized,
} from "@/lib/disposal/disposal-execution-utils";
import { activateLaser, deactivateAllLasers, deactivateLaser } from "@/lib/laser-activation";
import { activateTdoa, deactivateAllTdoa, deactivateTdoa } from "@/lib/tdoa-activation";
import {
  mergeConnectionLines,
  clearAllConnectionLines,
  pruneConnectionLinesForTarget,
  pruneConnectionLinesForMissingTargets,
  type AssetTargetConnection,
  resolveTrackLngLatForTargetId,
} from "@/lib/asset-target-line";
import { findDisposalFollowDevicesToRelease } from "@/lib/disposal/disposal-weapon-follow";
import { setLaserActivationEnabled, setTdoaActivationEnabled } from "@/lib/map-app-config";
import { useAssetStore } from "@/stores/asset-store";
import { useDroneStore } from "@/stores/drone-store";
import { toast } from "sonner";

export type DisposalWsStatus = "idle" | "connecting" | "open" | "error";

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

/** 跨方案卡片继承：与 V2 DisposalCard `executedExecutionKeys` 一致 */
const globalExecutedDisposalKeys = new Set<string>();
const activatedLaserDeviceIds = new Set<string>();
const activatedTdoaDeviceIds = new Set<string>();

function clearDisposalActivationState(): void {
  globalExecutedDisposalKeys.clear();
  activatedLaserDeviceIds.clear();
  activatedTdoaDeviceIds.clear();
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
 * 解析处置目标的经纬度坐标（用于激光/TDOA 扇区定位和资产→目标连线）。
 * 优先从 track-store 查找实时航迹坐标，回退到 blueForceInfo 中的静态坐标。
 */
function resolveDisposalTargetLngLat(
  targetId: string,
  inputParams: DisposalInputParams | undefined,
  blue: Record<string, unknown> | undefined,
): { lng: number; lat: number } | null {
  const hint = inferIsAirTrackFromInputParams(inputParams);
  const fromTrack = resolveTrackLngLatForTargetId(targetId, hint);
  if (fromTrack) return fromTrack;
  const loose = resolveTrackLngLatForTargetId(targetId, undefined);
  if (loose) return loose;
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
 *   与 `properties.entity_id` 及 `drone-store.entityIdToDeviceSn` 一致（见 useUnifiedWsFeed.syncDroneAndAirportAssetsFromRelationships）。
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

  const entityMap = useDroneStore.getState().entityIdToDeviceSn;
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
    if (useDroneStore.getState().drones[sn] != null) return true;
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
    description: `「${name}」中的设备 id 在当前资产列表中不存在：${list}。已跳过这些任务的地图激活与连线。`,
    duration: 8000,
  });
}

/**
 * 去掉某资产上处置触发的专题层状态（激光扇区/TDOA 扇区）。
 * 非激光/TDOA 类设备调用为 no-op。
 */
function releaseDisposalAssetBindings(deviceId: string): void {
  const id = String(deviceId ?? "").trim();
  if (!id) return;
  deactivateLaser(id);
  activatedLaserDeviceIds.delete(id);
  deactivateTdoa(id);
  activatedTdoaDeviceIds.delete(id);
}

function syncGlobalActivationFlagsByCurrentDevices(): void {
  if (activatedLaserDeviceIds.size === 0) setLaserActivationEnabled(false);
  if (activatedTdoaDeviceIds.size === 0) setTdoaActivationEnabled(false);
}

/**
 * 同一目标后续推送的新处置包若缩小了参与设备集合：此前已画的连线与激光/TDOA 等需收敛，
 * 否则会一直显示资产→目标连线或扇区跟随（见 WS 连续两包方案设备集合不一致）。
 */
function reconcileDisposalMapEffectsForIncomingPayload(n: NormalizedDisposalPlans): void {
  const tid = String(primaryTargetIdFromNormalized(n) ?? "").trim();
  if (!tid) return;

  const allowedAssets = collectAllDeviceIdsFromNormalized(n);
  const removedFromLines = pruneConnectionLinesForTarget(tid, allowedAssets);
  for (const assetId of removedFromLines) {
    releaseDisposalAssetBindings(assetId);
  }

  const keepLasers = new Set<string>();
  const keepTdoa = new Set<string>();
  for (const item of n.items || []) {
    for (const sch of item.mappedSchemes || []) {
      for (const task of sch.tasks || []) {
        const id = String(task.deviceId ?? "").trim();
        if (!id) continue;
        if (taskLooksLikeLaser(task)) keepLasers.add(id);
        if (taskLooksLikeTdoa(task)) keepTdoa.add(id);
      }
    }
  }

  const { laserDeviceIds, tdoaDeviceIds } = findDisposalFollowDevicesToRelease(tid, keepLasers, keepTdoa);
  for (const id of laserDeviceIds) releaseDisposalAssetBindings(id);
  for (const id of tdoaDeviceIds) releaseDisposalAssetBindings(id);
}

function applySchemeSideEffects(scheme: MappedDisposalScheme, inputParams: DisposalInputParams | undefined): void {
  const connections: AssetTargetConnection[] = [];
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

    const trackId = String(task.targetId ?? tid);

    if (taskLooksLikeLaser(task) && targetCoords) {
      if (
        activateLaser(task.deviceId, targetCoords.lng, targetCoords.lat, {
          trackTargetId: trackId,
          inputParams,
        })
      ) {
        activatedLaserDeviceIds.add(task.deviceId);
      }
    }

    if (taskLooksLikeTdoa(task) && targetCoords) {
      if (
        activateTdoa(task.deviceId, targetCoords.lng, targetCoords.lat, {
          trackTargetId: trackId,
          inputParams,
        })
      ) {
        activatedTdoaDeviceIds.add(task.deviceId);
      }
    }

    const flng = blue != null ? Number(blue.longitude) : NaN;
    const flat = blue != null ? Number(blue.latitude) : NaN;
    connections.push({
      assetEntityId: task.deviceId,
      targetId: String(task.targetId ?? tid),
      ...(Number.isFinite(flng) && Number.isFinite(flat) ? { targetFallbackLng: flng, targetFallbackLat: flat } : {}),
    });
  }

  mergeConnectionLines(connections);
}

export interface DisposalPlanState {
  blocks: DisposalPlanBlock[];
  wsStatus: DisposalWsStatus;
  setWsStatus: (s: DisposalWsStatus) => void;
  appendFromNormalized: (n: NormalizedDisposalPlans, source: DisposalPlanSource) => void;
  clearBlocks: () => void;
  cleanupEffectsForMissingTargets: () => void;
  executeScheme: (blockId: string, cardInstanceId: string, scheme: MappedDisposalScheme) => Promise<boolean>;
}

export const useDisposalPlanStore = create<DisposalPlanState>((set, get) => ({
  blocks: [],
  wsStatus: "idle",

  setWsStatus: (s) => set({ wsStatus: s }),

  /**
   * 将归一化后的方案包写入 store。
   * 数据流：normalizeDisposalPayload → 本方法 → blocks 列表更新 → DisposalPlanFeed 重新渲染
   *
   * 步骤：
   *   1. reconcileDisposalMapEffectsForIncomingPayload: 收敛旧方案包的地图效果（连线/激光/TDOA）
   *   2. 遍历 items，为每个 DisposalPlanCardRow 生成 cardInstanceId
   *   3. 跨卡片继承：检查 globalExecutedDisposalKeys，标记已执行方案
   *   4. 构建 DisposalPlanBlock 并插入 blocks 列表（最新在前）
   */
  appendFromNormalized: (n, source) => {
    const now = Date.now();
    const { blocks } = get();
    const targetId = primaryTargetIdFromNormalized(n);

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
    set({
      blocks: [
        {
          blockId: `blk_${randomId()}`,
          taskId: n.taskId,
          source,
          createdAt: now,
          summary,
          items,
        },
        ...blocks,
      ],
    });
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
    const removedFromLines = pruneConnectionLinesForMissingTargets();
    for (const assetId of removedFromLines) {
      releaseDisposalAssetBindings(assetId);
    }
    syncGlobalActivationFlagsByCurrentDevices();
  },

  /**
   * 执行方案：POST grpc-disposal/execute → 成功后激活地图效果（激光/TDOA/连线）
   *
   * 执行流：
   *   1. 标记 scheme 为 executing（UI 显示 loading）
   *   2. postDisposalExecute 发送执行请求
   *   3. 成功：applySchemeSideEffects（激活激光/TDOA + 绘制资产→目标连线）
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
      const tid = String(row?.inputParams?.targetId ?? blockPrimaryTargetId(block) ?? "").trim();
      const execKey = getExecutionTrackingKey(tid, scheme);
      if (execKey) globalExecutedDisposalKeys.add(execKey);
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
}));
