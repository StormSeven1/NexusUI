"use client";

import type { MappedDisposalTask } from "@/lib/disposal/disposal-types";
import { useAssetStore } from "@/stores/asset-store";
import { useDisposalPlanStore } from "@/stores/disposal-plan-store";
import { useTaskProgressStore } from "@/stores/task-progress-store";
import { getRenderCache } from "@/stores/track-store";

function norm(value: unknown): string {
  return String(value ?? "").trim();
}

function taskBelongsToTrack(task: MappedDisposalTask, targetID: string): boolean {
  const tid = norm(targetID);
  if (!tid) return false;
  const taskTarget = norm(task.targetId);
  return taskTarget === tid;
}

function taskLooksLikeDrone(task: MappedDisposalTask): boolean {
  const red = task.redForceInfo as Record<string, unknown> | undefined;
  const unitType = String(red?.unitType ?? red?.unit_type ?? "").trim().toLowerCase();
  const deviceId = norm(task.deviceId).toLowerCase();
  const deviceName = norm(task.deviceName).toLowerCase();
  return (
    unitType.includes("drone") ||
    unitType.includes("uav") ||
    deviceId.includes("uav") ||
    deviceId.includes("drone") ||
    deviceName.includes("无人机") ||
    deviceName.includes("uav") ||
    deviceName.includes("drone")
  );
}

function resolveDroneEntityId(deviceId: string): string {
  const raw = norm(deviceId);
  if (!raw) return "";

  const state = useAssetStore.getState();
  const low = raw.toLowerCase();
  const direct = state.assets.find((item) => item.asset_type === "drone" && item.id.toLowerCase() === low);
  if (direct) return direct.id;

  const mappedByEntity = state.entityIdToDeviceSn[raw];
  if (mappedByEntity) {
    const mappedAsset = state.assets.find((item) => item.asset_type === "drone" && item.id === mappedByEntity);
    if (mappedAsset) return mappedAsset.id;
    const mappedEntityId = state.deviceSnToEntityId[mappedByEntity];
    if (mappedEntityId) return mappedEntityId;
  }

  const mappedBySn = state.deviceSnToEntityId[raw];
  if (mappedBySn) return mappedBySn;

  for (const asset of state.assets) {
    if (asset.asset_type !== "drone") continue;
    const props =
      asset.properties && typeof asset.properties === "object"
        ? (asset.properties as Record<string, unknown>)
        : null;
    if (!props) continue;
    const entityId = String(props.entity_id ?? props.entityId ?? "").trim();
    const deviceSn = String(props.deviceSn ?? props.device_sn ?? "").trim();
    if ((entityId && entityId.toLowerCase() === low) || (deviceSn && deviceSn.toLowerCase() === low)) {
      return asset.id;
    }
  }

  return raw;
}

export interface ActiveDisposalForTrack {
  deviceEntityIds: string[];
  droneEntityIds: string[];
}

export function collectActiveDisposalForTrack(targetID: string): ActiveDisposalForTrack {
  const tid = norm(targetID);
  const deviceSeen = new Set<string>();
  const droneSeen = new Set<string>();
  const deviceEntityIds: string[] = [];
  const droneEntityIds: string[] = [];

  const pushDevice = (id: string, isDroneTask = false) => {
    const deviceId = norm(id);
    if (!deviceId || deviceSeen.has(deviceId)) return;
    deviceSeen.add(deviceId);
    deviceEntityIds.push(deviceId);
    if (isDroneTask) {
      const droneEntityId = resolveDroneEntityId(deviceId);
      const droneKey = norm(droneEntityId);
      if (droneKey && !droneSeen.has(droneKey)) {
        droneSeen.add(droneKey);
        droneEntityIds.push(droneKey);
      }
    }
  };

  if (!tid) return { deviceEntityIds, droneEntityIds };

  for (const entry of useTaskProgressStore.getState().entries) {
    if (entry.targetId === tid && entry.status === "executing") {
      pushDevice(entry.deviceId);
    }
  }

  for (const block of useDisposalPlanStore.getState().blocks) {
    for (const row of block.items) {
      if (norm(row.inputParams?.targetId) !== tid) continue;

      for (const scheme of row.mappedSchemes ?? []) {
        const active =
          row.executedSchemeIds.includes(scheme.schemeId) ||
          row.executingSchemeIds.includes(scheme.schemeId);
        if (!active) continue;

        for (const task of scheme.tasks ?? []) {
          if (!taskBelongsToTrack(task, tid)) continue;
          pushDevice(task.deviceId, taskLooksLikeDrone(task));
        }
      }
    }
  }

  return { deviceEntityIds, droneEntityIds };
}

export function resolveIsAirTrackFromRenderCache(targetID: string): boolean {
  const tid = norm(targetID);
  if (!tid) return false;
  for (const [, track] of getRenderCache()) {
    if (track.targetID === tid) return track.type === "air";
  }
  return false;
}

