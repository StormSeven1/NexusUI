/**
 * 告警面板「消灭」：按 trackId 查正在执行的方案 → POST 处置结束 → 仅有飞弹时 DELETE。
 */

import {
  collectActiveDisposalForTrack,
  resolveIsAirTrackFromRenderCache,
} from "@/lib/disposal/disposal-active-devices";
import { getHttpChatConfig } from "@/lib/map-app-config";
import { destroyMunitionOnMap } from "@/lib/munition/munition-runtime";
import { useAssetStore } from "@/stores/asset-store";

const FILTER_SPEC_SEA_TARGET = 0;
const FILTER_SPEC_AIR_TARGET = 1;

interface FilterTargetOrForceBody {
  taskId: string;
  parentTaskId: string;
  version: { definitionVersion: number; statusVersion: number };
  displayName: string;
  taskType: string;
  maxExecutionTimeMs: number;
  specification: { "@type": string; type: number; id: string };
  createdBy: {
    system: {
      serviceName: string;
      entityId: string;
      managesOwnScheduling: boolean;
      priority: number;
    };
  };
  owner: { entityId: string };
}

function newFilterTargetOrForceTaskId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `filterTargetOrForce_${crypto.randomUUID()}`;
  }
  return `filterTargetOrForce_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildFilterTargetOrForceBody(
  specType: number,
  targetId: string,
  creatorEntityId: string,
): FilterTargetOrForceBody {
  return {
    taskId: newFilterTargetOrForceTaskId(),
    parentTaskId: "",
    version: { definitionVersion: 1, statusVersion: 1 },
    displayName: "仿真引擎裁决目标或兵力子任务",
    taskType: "AUTOMATIC",
    maxExecutionTimeMs: 10000,
    specification: {
      "@type": "type.casia.tasks.v1.filterTargetOrForce",
      type: specType,
      id: targetId,
    },
    createdBy: {
      system: {
        serviceName: "display_control_service",
        entityId: creatorEntityId,
        managesOwnScheduling: true,
        priority: 1,
      },
    },
    owner: { entityId: "task_manager_service" },
  };
}

async function postFilterTargetOrForceToUrl(
  url: string,
  body: FilterTargetOrForceBody,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("/api/disposal/filter-target-or-force", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, body }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[alert-destroy] 处置结束 POST 失败:", url, res.status, text);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[alert-destroy] 处置结束 POST 异常:", url, e);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function postFilterTargetOrForceTask(
  specType: number,
  targetId: string,
  creatorEntityId: string,
): Promise<boolean> {
  const cfg = getHttpChatConfig();
  const urls = cfg.filterTargetOrForceUrls.map((u) => u.trim()).filter(Boolean);
  if (urls.length === 0) {
    console.warn("[alert-destroy] filterTargetOrForceUrls 未配置");
    return false;
  }
  const id = String(targetId ?? "").trim();
  if (!id) return false;
  const body = buildFilterTargetOrForceBody(specType, id, creatorEntityId);
  const timeoutMs = cfg.filterTargetOrForceTimeoutMs > 0 ? cfg.filterTargetOrForceTimeoutMs : 8000;
  const results = await Promise.all(
    urls.map((url) => postFilterTargetOrForceToUrl(url, body, timeoutMs)),
  );
  return results.every(Boolean);
}

async function deleteMunitionEntity(entityId: string): Promise<boolean> {
  const cfg = getHttpChatConfig();
  const template = cfg.entityDeleteUrl?.trim();
  if (!template) {
    console.warn("[alert-destroy] entityDeleteUrl 未配置");
    return false;
  }
  if (!template.includes("{entityId}")) {
    console.warn("[alert-destroy] entityDeleteUrl 须包含 {entityId}");
    return false;
  }
  const eid = encodeURIComponent(String(entityId ?? "").trim());
  if (!eid) return false;
  const url = template.replace(/\{entityId\}/g, eid);
  const timeoutMs = cfg.entityDeleteTimeoutMs > 0 ? cfg.entityDeleteTimeoutMs : 5000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, signal: controller.signal });
    if (!res.ok) {
      console.error("[alert-destroy] DELETE 飞弹失败:", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[alert-destroy] DELETE 飞弹异常:", e);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface AlertDestroyHttpResult {
  adjudicationOk: boolean;
  deviceEntityIds: string[];
  munitionEntityIds: string[];
}

async function deleteMunitionDevicesOnly(munitionEntityIds: string[]): Promise<void> {
  const assets = useAssetStore.getState().assets;
  for (const entityId of munitionEntityIds) {
    const eid = String(entityId ?? "").trim();
    if (!eid) continue;
    const asset = assets.find((a) => a.id === eid);
    await deleteMunitionEntity(eid);
    const lat = asset?.lat;
    const lng = asset?.lng;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      destroyMunitionOnMap(eid, lat!, lng!);
    } else {
      destroyMunitionOnMap(eid, 0, 0, { skipExplosion: true });
    }
  }
}

/** 告警消灭：始终 POST；仅当有飞弹时 DELETE 飞弹 */
export async function runAlertDestroyHttp(trackId: string): Promise<AlertDestroyHttpResult> {
  const tid = String(trackId ?? "").trim();
  const { deviceEntityIds, munitionEntityIds } = collectActiveDisposalForTrack(tid);
  const creatorEntityId = deviceEntityIds.join(",");
  const specType = resolveIsAirTrackFromRenderCache(tid) ? FILTER_SPEC_AIR_TARGET : FILTER_SPEC_SEA_TARGET;

  const adjudicationOk = await postFilterTargetOrForceTask(specType, tid, creatorEntityId);

  if (munitionEntityIds.length > 0) {
    await deleteMunitionDevicesOnly(munitionEntityIds);
  }

  return { adjudicationOk, deviceEntityIds, munitionEntityIds };
}
