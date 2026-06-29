"use client";

import { toast } from "sonner";
import { getHttpChatConfig } from "@/lib/map-app-config";
import { useAssetStore } from "@/stores/asset-store";

export interface DroneReturnHomeTaskBody {
  taskId: string;
  parentTaskId: string;
  version: {
    definitionVersion: number;
    statusVersion: number;
  };
  displayName: string;
  taskType: string;
  maxExecutionTimeMs: number;
  specification: {
    "@type": string;
    deviceSn: string;
  };
  createdBy: {
    system: {
      serviceName: string;
      userId: string;
      managesOwnScheduling: boolean;
      priority: number;
    };
  };
  owner: {
    entityId: string;
  };
}

export interface DroneReturnHomeTarget {
  entityId: string;
  deviceSn: string;
  displayName: string;
}

export interface DroneReturnHomeResult {
  ok: boolean;
  entityId: string;
  deviceSn: string;
  displayName: string;
  status?: number;
  message?: string;
}

function norm(value: unknown): string {
  return String(value ?? "").trim();
}

function newReturnHomeTaskId(entityId: string): string {
  const safeEntityId = norm(entityId) || "unknown";
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `cancel_uav_all_tasks_${safeEntityId}_${crypto.randomUUID()}`;
  }
  return `cancel_uav_all_tasks_${safeEntityId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function readDroneProps(asset: { properties: Record<string, unknown> | null }): Record<string, unknown> {
  return asset.properties && typeof asset.properties === "object"
    ? (asset.properties as Record<string, unknown>)
    : {};
}

function resolveDroneAssetByAnyId(id: string) {
  const raw = norm(id);
  if (!raw) return null;

  const state = useAssetStore.getState();
  const low = raw.toLowerCase();

  const byId = state.assets.find((item) => item.asset_type === "drone" && item.id.toLowerCase() === low);
  if (byId) return byId;

  const mappedSn = state.entityIdToDeviceSn[raw];
  if (mappedSn) {
    const byMappedSn = state.assets.find((item) => item.asset_type === "drone" && item.id === mappedSn);
    if (byMappedSn) return byMappedSn;
  }

  const mappedEntityId = state.deviceSnToEntityId[raw];
  if (mappedEntityId) {
    const byMappedEntityId = state.assets.find((item) => item.asset_type === "drone" && item.id === mappedEntityId);
    if (byMappedEntityId) return byMappedEntityId;
  }

  for (const asset of state.assets) {
    if (asset.asset_type !== "drone") continue;
    const props = readDroneProps(asset);
    const entityId = norm(props.entityId ?? props.entity_id).toLowerCase();
    const deviceSn = norm(props.deviceSn ?? props.device_sn).toLowerCase();
    if ((entityId && entityId === low) || (deviceSn && deviceSn === low)) {
      return asset;
    }
  }

  return null;
}

export function resolveDroneReturnHomeTarget(entityId: string): DroneReturnHomeTarget | null {
  const id = norm(entityId);
  if (!id) return null;

  const state = useAssetStore.getState();
  const asset = resolveDroneAssetByAnyId(id);
  if (!asset) return null;

  const props = readDroneProps(asset);
  const canonicalEntityId =
    norm(props.entityId ?? props.entity_id) ||
    norm(state.deviceSnToEntityId[asset.id]) ||
    norm(asset.id);
  const deviceSn =
    norm(state.entityIdToDeviceSn[canonicalEntityId]) ||
    norm(state.entityIdToDeviceSn[id]) ||
    norm(props.deviceSn ?? props.device_sn) ||
    norm(asset.id);

  if (!canonicalEntityId || !deviceSn) return null;

  return {
    entityId: canonicalEntityId,
    deviceSn,
    displayName: norm(asset.name) || canonicalEntityId,
  };
}

export function buildDroneReturnHomeBody(target: DroneReturnHomeTarget): DroneReturnHomeTaskBody {
  return {
    taskId: newReturnHomeTaskId(target.entityId),
    parentTaskId: "",
    version: {
      definitionVersion: 1,
      statusVersion: 1,
    },
    displayName: "取消无人机所有元任务并返航",
    taskType: "AUTOMATIC",
    maxExecutionTimeMs: 10000,
    specification: {
      "@type": "type.casia.tasks.v1.DroneFlightBackAndReturnHome",
      deviceSn: target.deviceSn,
    },
    createdBy: {
      system: {
        serviceName: "display_control_service",
        userId: "显控",
        managesOwnScheduling: true,
        priority: 5,
      },
    },
    owner: {
      entityId: target.entityId,
    },
  };
}

export async function sendDroneReturnHome(entityId: string): Promise<DroneReturnHomeResult> {
  const target = resolveDroneReturnHomeTarget(entityId);
  if (!target) {
    return {
      ok: false,
      entityId: norm(entityId),
      deviceSn: "",
      displayName: norm(entityId) || "无人机",
      message: "未找到无人机或 deviceSn",
    };
  }

  const cfg = getHttpChatConfig();
  const url = norm(cfg.droneReturnHomeUrl);
  if (!url) {
    return {
      ok: false,
      entityId: target.entityId,
      deviceSn: target.deviceSn,
      displayName: target.displayName,
      message: "未配置无人机返航地址",
    };
  }

  const controller = new AbortController();
  const timeoutMs = cfg.droneReturnHomeTimeoutMs > 0 ? cfg.droneReturnHomeTimeoutMs : 10000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    console.log("[drone-return-home] send", {
      entityId: target.entityId,
      deviceSn: target.deviceSn,
      displayName: target.displayName,
      url,
    });

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildDroneReturnHomeBody(target)),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[drone-return-home] http failed", {
        entityId: target.entityId,
        deviceSn: target.deviceSn,
        status: res.status,
        message: text,
      });
      return {
        ok: false,
        entityId: target.entityId,
        deviceSn: target.deviceSn,
        displayName: target.displayName,
        status: res.status,
        message: text || `HTTP ${res.status}`,
      };
    }

    return {
      ok: true,
      entityId: target.entityId,
      deviceSn: target.deviceSn,
      displayName: target.displayName,
      status: res.status,
    };
  } catch (error) {
    console.warn("[drone-return-home] send error", {
      entityId: target.entityId,
      deviceSn: target.deviceSn,
      error,
    });
    return {
      ok: false,
      entityId: target.entityId,
      deviceSn: target.deviceSn,
      displayName: target.displayName,
      message: error instanceof Error ? error.message : "未知错误",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function sendDroneReturnHomeSequential(entityIds: string[]): Promise<DroneReturnHomeResult[]> {
  const dedupedEntityIds = [...new Set(entityIds.map((id) => norm(id)).filter(Boolean))];
  const results: DroneReturnHomeResult[] = [];
  for (const entityId of dedupedEntityIds) {
    results.push(await sendDroneReturnHome(entityId));
  }
  return results;
}

export function toastDroneReturnHomeSummary(results: DroneReturnHomeResult[], sourceLabel: string): void {
  if (results.length === 0) return;

  const success = results.filter((item) => item.ok);
  const failed = results.filter((item) => !item.ok);

  if (success.length > 0) {
    toast.success(`${sourceLabel}已发送无人机返航指令`, {
      description:
        success.length === 1
          ? `${success[0].displayName} (${success[0].deviceSn})`
          : `${success.length} 架无人机已依次发送返航指令`,
    });
  }

  if (failed.length > 0) {
    const brief = failed
      .slice(0, 3)
      .map((item) => item.displayName || item.entityId)
      .join("、");
    toast.warning(`${sourceLabel}部分无人机返航发送失败`, {
      description:
        failed.length <= 3
          ? `${brief}${failed[0]?.message ? `：${failed[0].message}` : ""}`
          : `${brief} 等 ${failed.length} 架无人机返航失败`,
    });
  }
}
