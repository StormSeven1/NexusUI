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
  taskLooksLikeMunition,
} from "@/lib/disposal/disposal-execution-utils";
import { resolveTrackLngLatForTargetId } from "@/lib/asset-target-line";
import { useAssetStore } from "@/stores/asset-store";
import { useTaskProgressStore } from "@/stores/task-progress-store";
import { resolveAliasByTargetId } from "@/stores/track-alias-store";
import { getRenderCache } from "@/stores/track-store";
import { toast } from "sonner";
import { useDzwlAlarmStore } from "@/stores/dzwl-alarm-store";
import {
  postEngagementFinishCommand,
  type EngagementKind,
} from "@/lib/engagement/engagement-finish";
import { saveDisposalPlanHistoryBlock } from "@/lib/conversation-history-client";

export type DisposalWsStatus = "idle" | "connecting" | "open" | "error";
export type DisposalRunMode = "manual" | "auto";

export interface DisposalPlanCardRow {
  cardInstanceId: string;
  userQuery: string;
  inputParams: DisposalInputParams;
  targetAlias?: string;
  mappedSchemes: MappedDisposalScheme[];
  noPlansReason?: string;
  executedSchemeIds: string[];
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

function targetExistsInRenderCache(targetId: string): boolean {
  const tid = String(targetId ?? "").trim();
  if (!tid) return false;
  for (const [, track] of getRenderCache()) {
    if (String(track.targetID ?? "").trim() === tid) return true;
  }
  return false;
}

const globalExecutedDisposalKeys = new Set<string>();
const activatedDevicesByTarget = new Map<string, { lasers: Set<string>; tdoa: Set<string>; munitions: Set<string> }>();
const skippedPlanToastTimestamps = new Map<string, number>();
const SKIPPED_PLAN_TOAST_TTL_MS = 10_000;
let cleanupMissingTargetsInProgress = false;

function clearDisposalActivationState(): void {
  globalExecutedDisposalKeys.clear();
  activatedDevicesByTarget.clear();
}

function activationBucketForTarget(targetId: string): { lasers: Set<string>; tdoa: Set<string>; munitions: Set<string> } {
  const tid = String(targetId ?? "").trim();
  let bucket = activatedDevicesByTarget.get(tid);
  if (!bucket) {
    bucket = { lasers: new Set<string>(), tdoa: new Set<string>(), munitions: new Set<string>() };
    activatedDevicesByTarget.set(tid, bucket);
  }
  return bucket;
}

function assetStringProp(asset: { properties?: unknown }, key: string): string {
  const props =
    asset.properties && typeof asset.properties === "object"
      ? (asset.properties as Record<string, unknown>)
      : null;
  const value = props?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function resolveMunitionAssetId(deviceId: string): string {
  const id = String(deviceId ?? "").trim();
  if (!id) return "";
  const low = id.toLowerCase();
  const asset = useAssetStore.getState().assets.find((a) => {
    if (a.asset_type !== "missile") return false;
    return (
      a.id.toLowerCase() === low ||
      assetStringProp(a, "entityId").toLowerCase() === low ||
      assetStringProp(a, "entity_id").toLowerCase() === low ||
      assetStringProp(a, "deviceSn").toLowerCase() === low ||
      assetStringProp(a, "device_sn").toLowerCase() === low
    );
  });
  return asset?.id ?? id;
}

function taskLooksLikeLaser(task: MappedDisposalTask): boolean {
  const a = String(task.actionName ?? "").toLowerCase();
  if (a.includes("laser") || a.includes("激光") || a.includes("光电") || a.includes("打击")) return true;
  const red = task.redForceInfo as Record<string, unknown> | undefined;
  const ut = String(red?.unitType ?? red?.unit_type ?? "").toLowerCase();
  if (ut.includes("laser") || ut.includes("opto")) return true;
  const id = String(task.deviceId ?? "").toLowerCase();
  return id.includes("laser");
}

function taskLooksLikeTdoa(task: MappedDisposalTask): boolean {
  const a = String(task.actionName ?? "").toLowerCase();
  if (a.includes("tdoa") || a.includes("电侦") || a.includes("电子侦察")) return true;
  const red = task.redForceInfo as Record<string, unknown> | undefined;
  const ut = String(red?.unitType ?? red?.unit_type ?? "").toLowerCase();
  if (ut.includes("tdoa") || ut.includes("electronic") || ut.includes("电侦")) return true;
  const id = String(task.deviceId ?? "").toLowerCase();
  return id.includes("tdoa");
}

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
  const list = missingIds.length <= 5 ? missingIds.join("、") : `${missingIds.slice(0, 5).join("、")} 等共 ${missingIds.length} 个`;
  toast.error("处置方案：未找到对应资产", {
    description: `《${name}》中的设备 id 在当前资产列表中不存在：${list}。已跳过这些任务的地图绑定。`,
    duration: 8000,
  });
}

function shouldEmitSkippedPlanToast(source: DisposalPlanSource, skippedTargetIds: string[]): boolean {
  const normalizedIds = [...new Set(skippedTargetIds.map((id) => String(id ?? "").trim()).filter(Boolean))].sort();
  if (normalizedIds.length === 0) return false;
  const now = Date.now();
  const key = `${source}:${normalizedIds.join("|")}`;
  const lastAt = skippedPlanToastTimestamps.get(key) ?? 0;
  if (now - lastAt < SKIPPED_PLAN_TOAST_TTL_MS) return false;
  skippedPlanToastTimestamps.set(key, now);
  return true;
}

function releaseDisposalAssetBindings(targetId: string, deviceId: string, kind: EngagementKind): void {
  const tid = String(targetId ?? "").trim();
  const id = String(deviceId ?? "").trim();
  if (!tid || !id) return;
  postEngagementFinishCommand(kind, tid, id);
}

function engagementKindForDeviceId(deviceId: string): EngagementKind | null {
  const id = String(deviceId ?? "").trim();
  if (!id) return null;
  const low = id.toLowerCase();
  const asset = useAssetStore.getState().assets.find((a) => {
    if (a.id.toLowerCase() === low) return true;
    const props = a.properties && typeof a.properties === "object" ? (a.properties as Record<string, unknown>) : null;
    if (!props) return false;
    const aliases = [
      props.entityId,
      props.entity_id,
      props.deviceSn,
      props.device_sn,
    ].map((v) => String(v ?? "").trim().toLowerCase()).filter(Boolean);
    return aliases.includes(low);
  });
  if (asset?.asset_type === "laser") return "laser";
  if (asset?.asset_type === "tdoa") return "tdoa";
  if (asset?.asset_type === "missile") return "munition";
  if (low.includes("laser")) return "laser";
  if (low.includes("tdoa")) return "tdoa";
  if (low.includes("munition") || low.includes("missile")) return "munition";
  return null;
}

function releaseExecutingProgressDevicesForTarget(targetId: string, alreadyReleased: string[]): string[] {
  const tid = String(targetId ?? "").trim();
  if (!tid) return alreadyReleased;
  const releasedKeys = new Set(
    alreadyReleased
      .map((id) => String(id ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  const released = [...alreadyReleased];
  for (const entry of useTaskProgressStore.getState().entries) {
    if (entry.status !== "executing" || String(entry.targetId ?? "").trim() !== tid) continue;
    const rawDeviceId = String(entry.deviceId ?? "").trim();
    if (!rawDeviceId) continue;
    const kind = engagementKindForDeviceId(rawDeviceId);
    if (!kind) continue;
    if (kind === "munition") continue;
    const deviceId = rawDeviceId;
    const key = `${kind}:${deviceId}`.toLowerCase();
    if (releasedKeys.has(key)) continue;
    releasedKeys.add(key);
    released.push(deviceId);
    releaseDisposalAssetBindings(tid, deviceId, kind);
  }
  return released;
}

function releaseProgressDevicesNotAllowedForTarget(
  targetId: string,
  allowed: { lasers: Set<string>; tdoa: Set<string>; munitions: Set<string> },
  alreadyReleased: string[],
): string[] {
  const tid = String(targetId ?? "").trim();
  if (!tid) return alreadyReleased;
  const releasedKeys = new Set(
    alreadyReleased
      .map((id) => String(id ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  const released = [...alreadyReleased];
  for (const entry of useTaskProgressStore.getState().entries) {
    if (entry.status !== "executing" || String(entry.targetId ?? "").trim() !== tid) continue;
    const rawDeviceId = String(entry.deviceId ?? "").trim();
    if (!rawDeviceId) continue;
    const kind = engagementKindForDeviceId(rawDeviceId);
    if (!kind) continue;
    if (kind === "munition") continue;
    const deviceId = rawDeviceId;
    const isAllowed =
      kind === "laser"
        ? allowed.lasers.has(deviceId)
        : allowed.tdoa.has(deviceId);
    if (isAllowed) continue;
    const key = `${kind}:${deviceId}`.toLowerCase();
    if (releasedKeys.has(key)) continue;
    releasedKeys.add(key);
    released.push(deviceId);
    releaseDisposalAssetBindings(tid, deviceId, kind);
  }
  return released;
}

function releaseActivatedDeviceForTarget(targetId: string, deviceId: string): void {
  const tid = String(targetId ?? "").trim();
  const id = String(deviceId ?? "").trim();
  if (!tid || !id) return;
  const bucket = activatedDevicesByTarget.get(tid);
  if (!bucket) return;
  const wasLaser = bucket.lasers.delete(id);
  const wasTdoa = bucket.tdoa.delete(id);
  const wasMunition = bucket.munitions.delete(id);
  if (bucket.lasers.size === 0 && bucket.tdoa.size === 0 && bucket.munitions.size === 0) {
    activatedDevicesByTarget.delete(tid);
  }
  if (wasLaser) releaseDisposalAssetBindings(tid, id, "laser");
  if (wasTdoa) releaseDisposalAssetBindings(tid, id, "tdoa");
  if (wasMunition) releaseDisposalAssetBindings(tid, resolveMunitionAssetId(id), "munition");
}

function releaseAllActivatedDevicesForTarget(targetId: string): string[] {
  const tid = String(targetId ?? "").trim();
  if (!tid) return [];
  const bucket = activatedDevicesByTarget.get(tid);
  if (!bucket) return [];
  const ids = [
    ...[...bucket.lasers].map((id) => `laser:${id}`),
    ...[...bucket.tdoa].map((id) => `tdoa:${id}`),
    ...[...bucket.munitions].map((id) => `munition:${resolveMunitionAssetId(id)}`),
  ];
  const lasers = [...bucket.lasers];
  const tdoa = [...bucket.tdoa];
  const munitions = [...bucket.munitions];
  activatedDevicesByTarget.delete(tid);
  for (const id of lasers) releaseDisposalAssetBindings(tid, id, "laser");
  for (const id of tdoa) releaseDisposalAssetBindings(tid, id, "tdoa");
  for (const id of munitions) releaseDisposalAssetBindings(tid, resolveMunitionAssetId(id), "munition");
  return ids;
}

function allowedWeaponDevicesByTarget(n: NormalizedDisposalPlans): Map<string, { lasers: Set<string>; tdoa: Set<string>; munitions: Set<string> }> {
  const out = new Map<string, { lasers: Set<string>; tdoa: Set<string>; munitions: Set<string> }>();
  for (const item of n.items || []) {
    const fallbackTid = String(item.inputParams?.targetId ?? primaryTargetIdFromNormalized(n) ?? "").trim();
    const itemTargetId = fallbackTid;
    if (itemTargetId && !out.has(itemTargetId)) {
      out.set(itemTargetId, { lasers: new Set<string>(), tdoa: new Set<string>(), munitions: new Set<string>() });
    }
    for (const sch of item.mappedSchemes || []) {
      const targetId = String(item.inputParams?.targetId ?? sch.disposalTargetId ?? fallbackTid ?? "").trim();
      if (!targetId) continue;
      let bucket = out.get(targetId);
      if (!bucket) {
        bucket = { lasers: new Set<string>(), tdoa: new Set<string>(), munitions: new Set<string>() };
        out.set(targetId, bucket);
      }
      for (const task of sch.tasks || []) {
        const id = String(task.deviceId ?? "").trim();
        if (!id) continue;
        if (taskLooksLikeLaser(task)) bucket.lasers.add(id);
        if (taskLooksLikeTdoa(task)) bucket.tdoa.add(id);
        if (taskLooksLikeMunition(task)) bucket.munitions.add(resolveMunitionAssetId(id));
      }
    }
  }
  return out;
}

function reconcileDisposalMapEffectsForIncomingPayload(n: NormalizedDisposalPlans): void {
  const allowedByTarget = allowedWeaponDevicesByTarget(n);
  for (const [targetId, allowed] of allowedByTarget.entries()) {
    const active = activatedDevicesByTarget.get(targetId) ?? {
      lasers: new Set<string>(),
      tdoa: new Set<string>(),
      munitions: new Set<string>(),
    };
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
    const released = releaseProgressDevicesNotAllowedForTarget(targetId, allowed, removed);
    if (released.length > removed.length) removed.push(...released.slice(removed.length));
    if (removed.length > 0) {
      useTaskProgressStore.getState().terminateByTargetDevices(targetId, removed);
    }
  }
}

function applySchemeSideEffects(scheme: MappedDisposalScheme, inputParams: DisposalInputParams | undefined): void {
  const tid = String(inputParams?.targetId ?? "").trim();
  const missingIds = missingSchemeDeviceIds(scheme);
  const missingSet = new Set(missingIds.map((id) => id.toLowerCase()));
  if (missingIds.length > 0) toastMissingSchemeAssets(scheme, missingIds);

  for (const task of scheme.tasks) {
    const rawDev = String(task.deviceId ?? "").trim();
    if (rawDev && missingSet.has(rawDev.toLowerCase())) continue;
    const targetId = String(task.targetId ?? tid).trim();
    if (!targetId) continue;
    if (taskLooksLikeLaser(task)) activationBucketForTarget(targetId).lasers.add(task.deviceId);
    if (taskLooksLikeTdoa(task)) activationBucketForTarget(targetId).tdoa.add(task.deviceId);
    if (taskLooksLikeMunition(task)) activationBucketForTarget(targetId).munitions.add(resolveMunitionAssetId(task.deviceId));
  }
}

export interface DisposalPlanState {
  blocks: DisposalPlanBlock[];
  wsStatus: DisposalWsStatus;
  runMode: DisposalRunMode;
  setWsStatus: (s: DisposalWsStatus) => void;
  setRunMode: (mode: DisposalRunMode) => void;
  appendFromNormalized: (n: NormalizedDisposalPlans, source: DisposalPlanSource) => void;
  hydrateBlockFromHistory: (block: DisposalPlanBlock) => void;
  clearBlocks: () => void;
  cleanupEffectsForMissingTargets: () => void;
  releaseEffectsForTarget: (targetId: string) => string[];
  executeScheme: (blockId: string, cardInstanceId: string, scheme: MappedDisposalScheme) => Promise<boolean>;
  executeBestSchemesByTarget: (block: DisposalPlanBlock) => Promise<boolean[]>;
}

export const useDisposalPlanStore = create<DisposalPlanState>((set, get) => ({
  blocks: [],
  wsStatus: "idle",
  runMode: "manual",

  setWsStatus: (s) => set({ wsStatus: s }),
  setRunMode: (mode) => set({ runMode: mode }),

  appendFromNormalized: (n, source) => {
    const now = Date.now();
    const { blocks } = get();
    const targetId = primaryTargetIdFromNormalized(n);
    const skippedTargetIds = new Set<string>();

    if (n.taskId && blocks.some((b) => b.taskId === n.taskId)) {
      console.log("[DisposalPlanStore] duplicate taskId skipped:", n.taskId);
      return;
    }

    reconcileDisposalMapEffectsForIncomingPayload(n);

    const items: DisposalPlanCardRow[] = [];
    for (const [idx, it] of (n.items || []).entries()) {
      const tidForKeys = String(it.inputParams?.targetId ?? targetId ?? "").trim();
      if (!targetExistsInRenderCache(tidForKeys)) {
        if (tidForKeys) skippedTargetIds.add(tidForKeys);
        console.warn("[DisposalPlanStore] skip plans for missing cached target:", {
          source,
          taskId: n.taskId,
          targetId: tidForKeys,
          schemeIds: (it.mappedSchemes || []).map((sch) => sch.schemeId),
        });
        continue;
      }

      const targetAlias = resolveAliasByTargetId(tidForKeys);
      const preExecuted: string[] = [];
      for (const sch of it.mappedSchemes || []) {
        const k = getExecutionTrackingKey(tidForKeys, sch);
        if (k && globalExecutedDisposalKeys.has(k)) preExecuted.push(sch.schemeId);
      }
      items.push({
        cardInstanceId: `card_${source}_${now}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
        userQuery: it.userQuery,
        inputParams: it.inputParams,
        targetAlias,
        mappedSchemes: it.mappedSchemes,
        noPlansReason: it.noPlansReason,
        executedSchemeIds: [...new Set(preExecuted)],
        executingSchemeIds: [],
        lastError: null,
      });
    }

    if (skippedTargetIds.size > 0 && shouldEmitSkippedPlanToast(source, [...skippedTargetIds])) {
      const skippedList = [...skippedTargetIds];
      toast.warning("已跳过失效目标的处置方案", {
        description:
          skippedList.length === 1
            ? `目标 ${skippedList[0]} 已不在航迹缓存中，本次方案未显示。`
            : `共跳过 ${skippedList.length} 个已不在航迹缓存中的目标方案：${skippedList.join("、")}`,
      });
    }

    if (items.length === 0) {
      console.warn("[DisposalPlanStore] all incoming plans skipped because target was not found in render cache:", {
        source,
        taskId: n.taskId,
        primaryTargetId: targetId,
      });
      return;
    }

    const block: DisposalPlanBlock = {
      blockId: `blk_${randomId()}`,
      taskId: n.taskId,
      source,
      createdAt: now,
      summary: buildBlockSummary(source, n.taskId, items.length),
      items,
    };
    set({ blocks: [...blocks, block] });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("current-disposal-plan-updated", { detail: { blockId: block.blockId } }));
    }
    void saveDisposalPlanHistoryBlock(block);

    if (get().runMode === "auto") {
      void get().executeBestSchemesByTarget(block);
    }
  },

  hydrateBlockFromHistory: (block) => {
    set((st) => {
      const restored = { ...block, historyRestored: true } as DisposalPlanBlock;
      if (st.blocks.some((item) => item.blockId === block.blockId)) {
        return { blocks: st.blocks.map((item) => (item.blockId === block.blockId ? restored : item)) };
      }
      return { blocks: [...st.blocks, restored] };
    });
  },

  clearBlocks: () => {
    for (const targetId of [...activatedDevicesByTarget.keys()]) {
      releaseAllActivatedDevicesForTarget(targetId);
    }
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
        releaseExecutingProgressDevicesForTarget(targetId, released);
      }

      for (const targetId of missingTargetIds) {
        useTaskProgressStore.getState().endByTarget(targetId);
      }
    } finally {
      cleanupMissingTargetsInProgress = false;
    }
  },

  releaseEffectsForTarget: (targetId) => {
    const tid = String(targetId ?? "").trim();
    if (!tid) return [];
    const released = releaseAllActivatedDevicesForTarget(tid);
    if (released.length > 0) useTaskProgressStore.getState().endByTarget(tid);
    return released;
  },

  executeScheme: async (blockId, cardInstanceId, scheme) => {
    const { blocks } = get();
    const block = blocks.find((b) => b.blockId === blockId);
    if (!block) return false;
    const row = block.items.find((r) => r.cardInstanceId === cardInstanceId);
    const parentTaskId = block.taskId;
    const createdTaskId = `${parentTaskId}_${scheme.schemeId}`;

    set((st) => ({
      blocks: st.blocks.map((b) =>
        b.blockId !== blockId
          ? b
          : {
              ...b,
              items: b.items.map((r) =>
                r.cardInstanceId !== cardInstanceId
                  ? r
                  : {
                      ...r,
                      executingSchemeIds: [...new Set([...r.executingSchemeIds, scheme.schemeId])],
                      lastError: null,
                    },
              ),
            },
      ),
    }));

    const result = await postDisposalExecute(scheme, parentTaskId);
    const ok = result.ok && result.success !== false;

    if (ok) {
      if (result.pageUrl) {
        const alarmStore = useDzwlAlarmStore.getState();
        alarmStore.setPageUrl(result.pageUrl);
        alarmStore.show();
      }
      applySchemeSideEffects(scheme, row?.inputParams);
      const tid = row ? targetIdForAutoExecute(block, row, scheme) : String(scheme.disposalTargetId ?? blockPrimaryTargetId(block) ?? "").trim();
      const execKey = getExecutionTrackingKey(tid, scheme);
      if (execKey) globalExecutedDisposalKeys.add(execKey);
      if (tid) {
        const progressItems = scheme.tasks
          .filter((t) => String(t.deviceId ?? "").trim())
          .map((t) => ({
            targetId: tid,
            targetAlias: row?.targetAlias || resolveAliasByTargetId(tid),
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
      blocks: st.blocks.map((b) =>
        b.blockId !== blockId
          ? b
          : {
              ...b,
              items: b.items.map((r) => {
                if (r.cardInstanceId !== cardInstanceId) return r;
                const executed = new Set(r.executedSchemeIds);
                if (ok) executed.add(scheme.schemeId);
                return {
                  ...r,
                  executingSchemeIds: r.executingSchemeIds.filter((id) => id !== scheme.schemeId),
                  executedSchemeIds: [...executed],
                  lastError: ok ? null : (result.message ?? "执行失败"),
                };
              }),
            },
      ),
    }));

    if (!ok) console.warn("[DisposalPlan] execute failed", createdTaskId, result);
    const updatedBlock = get().blocks.find((b) => b.blockId === blockId);
    if (ok && updatedBlock) void saveDisposalPlanHistoryBlock(updatedBlock);
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
