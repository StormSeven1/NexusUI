"use client";

import {
  collectActiveDisposalForTrack,
  resolveIsAirTrackFromRenderCache,
} from "@/lib/disposal/disposal-active-devices";
import {
  sendDroneReturnHomeSequential,
  type DroneReturnHomeResult,
} from "@/lib/drone/drone-return-home";
import { getHttpChatConfig } from "@/lib/map-app-config";
import { destroyMunitionOnMap } from "@/lib/munition/munition-runtime";
import { useAssetStore, type AssetData } from "@/stores/asset-store";
import { useDisposalPlanStore } from "@/stores/disposal-plan-store";

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

async function postDestroyPublish(
  body: FilterTargetOrForceBody,
  timeoutMs: number,
): Promise<{ ok: boolean; connectedClients: number }> {
  const cfg = getHttpChatConfig();
  const url = cfg.destroyPublishUrl.trim();
  if (!url) {
    console.warn("[alert-destroy] destroyPublishUrl 未配置");
    return { ok: false, connectedClients: 0 };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[alert-destroy] destroy publish POST failed:", url, res.status, text);
      return { ok: false, connectedClients: 0 };
    }
    const json = (await res.json().catch(() => ({}))) as { ok?: unknown; connectedClients?: unknown };
    return {
      ok: json.ok !== false,
      connectedClients: Number.isFinite(Number(json.connectedClients)) ? Number(json.connectedClients) : 0,
    };
  } catch (error) {
    console.error("[alert-destroy] destroy publish POST error:", url, error);
    return { ok: false, connectedClients: 0 };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function postFilterTargetOrForceTask(
  specType: number,
  targetId: string,
  creatorEntityId: string,
): Promise<{ ok: boolean; connectedClients: number }> {
  const cfg = getHttpChatConfig();
  const id = String(targetId ?? "").trim();
  if (!id) return { ok: false, connectedClients: 0 };
  const body = buildFilterTargetOrForceBody(specType, id, creatorEntityId);
  const timeoutMs = cfg.destroyPublishTimeoutMs > 0 ? cfg.destroyPublishTimeoutMs : 8000;
  return postDestroyPublish(body, timeoutMs);
}

export interface AlertDestroyHttpResult {
  publishOk: boolean;
  connectedClients: number;
  deviceEntityIds: string[];
  releasedDeviceIds: string[];
  destroyedMunitionIds: string[];
  droneReturnHomeResults: DroneReturnHomeResult[];
}

function propString(asset: AssetData, key: string): string {
  const props =
    asset.properties && typeof asset.properties === "object"
      ? (asset.properties as Record<string, unknown>)
      : null;
  const value = props?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function findMunitionAssetByDeviceId(deviceId: string): AssetData | undefined {
  const raw = String(deviceId ?? "").trim();
  if (!raw) return undefined;
  const low = raw.toLowerCase();
  return useAssetStore.getState().assets.find((asset) => {
    if (asset.asset_type !== "missile") return false;
    return (
      asset.id.toLowerCase() === low ||
      propString(asset, "entityId").toLowerCase() === low ||
      propString(asset, "entity_id").toLowerCase() === low ||
      propString(asset, "deviceSn").toLowerCase() === low ||
      propString(asset, "device_sn").toLowerCase() === low
    );
  });
}

function destroyActiveMunitions(deviceEntityIds: string[]): string[] {
  const destroyed: string[] = [];
  const seen = new Set<string>();
  for (const deviceId of deviceEntityIds) {
    const asset = findMunitionAssetByDeviceId(deviceId);
    if (!asset || seen.has(asset.id)) continue;
    seen.add(asset.id);
    destroyMunitionOnMap(asset.id, asset.lat, asset.lng);
    destroyed.push(asset.id);
  }
  return destroyed;
}

export async function runAlertDestroyHttp(external_target_id: string, targetID?: string): Promise<AlertDestroyHttpResult> {
  const tid = String(external_target_id ?? "").trim();
  const uid = String(targetID ?? "").trim();
  if (!uid) {
    console.warn("[alert-destroy] skipped: targetID is required", { external_target_id: tid });
    return {
      publishOk: false,
      connectedClients: 0,
      deviceEntityIds: [],
      releasedDeviceIds: [],
      destroyedMunitionIds: [],
      droneReturnHomeResults: [],
    };
  }
  const destroyTargetId = uid;
  const disposalTargetId = destroyTargetId;
  const { deviceEntityIds, droneEntityIds } = collectActiveDisposalForTrack(disposalTargetId);
  const creatorEntityId = deviceEntityIds.join(",");
  const specType = resolveIsAirTrackFromRenderCache(destroyTargetId) ? FILTER_SPEC_AIR_TARGET : FILTER_SPEC_SEA_TARGET;

  console.log("[alert-destroy] matched active disposal", {
    external_target_id: tid,
    targetID: uid,
    disposalTargetId,
    destroyTargetId,
    deviceEntityIds,
    droneEntityIds,
  });

  const publishResult = await postFilterTargetOrForceTask(specType, destroyTargetId, creatorEntityId);
  const releasedDeviceIds = useDisposalPlanStore.getState().releaseEffectsForTarget(disposalTargetId);
  const destroyedMunitionIds = destroyActiveMunitions(deviceEntityIds);
  const droneReturnHomeResults = await sendDroneReturnHomeSequential(droneEntityIds);

  console.log("[alert-destroy] return-home results", {
    external_target_id: tid,
    targetID: uid,
    disposalTargetId,
    destroyTargetId,
    publishOk: publishResult.ok,
    connectedClients: publishResult.connectedClients,
    destroyedMunitionIds,
    releasedDeviceIds,
    droneReturnHomeResults,
  });

  return {
    publishOk: publishResult.ok,
    connectedClients: publishResult.connectedClients,
    deviceEntityIds,
    releasedDeviceIds,
    destroyedMunitionIds,
    droneReturnHomeResults,
  };
}

