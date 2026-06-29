"use client";

import { getStandaloneEngagementConfig } from "@/lib/map-app-config";

export type EngagementKind = "tdoa" | "laser" | "munition";

const ENGAGEMENT_TASK_META: Record<
  EngagementKind,
  { pathKey: "ltStrikePath" | "laserStrikePath" | "munitionStrikePath"; type: string; displayName: string }
> = {
  tdoa: {
    pathKey: "ltStrikePath",
    type: "type.casia.tasks.v1.LTSTrike",
    displayName: "TDOA任务结束",
  },
  laser: {
    pathKey: "laserStrikePath",
    type: "type.casia.tasks.v1.LaserStrike",
    displayName: "激光任务结束",
  },
  munition: {
    pathKey: "munitionStrikePath",
    type: "type.casia.tasks.v1.MunitionStrike",
    displayName: "巡飞弹任务结束",
  },
};

function postEngagementTaskCommand(
  kind: EngagementKind,
  targetId: string,
  deviceId: string,
  commandId: 0 | 1,
): Promise<{ ok: boolean; status?: number; text?: string; url?: string }> {
  const tid = String(targetId ?? "").trim();
  const id = String(deviceId ?? "").trim();
  if (!tid || !id || typeof window === "undefined") return Promise.resolve({ ok: false });

  const meta = ENGAGEMENT_TASK_META[kind];
  const cfg = getStandaloneEngagementConfig();
  const baseUrl = cfg.baseUrl.trim();
  if (!baseUrl) {
    console.warn("[engagement] task skipped: public/app-config.json standaloneEngagement.baseUrl is empty", {
      kind,
      commandId,
      targetId: tid,
      deviceId: id,
    });
    return Promise.resolve({ ok: false });
  }
  const path = cfg[meta.pathKey].trim();
  if (!path) {
    console.warn(`[engagement] task skipped: public/app-config.json standaloneEngagement.${meta.pathKey} is empty`, {
      kind,
      commandId,
      targetId: tid,
      deviceId: id,
    });
    return Promise.resolve({ ok: false });
  }

  const url = `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\/+/, "")}`;
  const body = {
    taskId: `frontend_${commandId === 1 ? "start" : "finish"}_${kind}_${id}_${tid}_${Date.now()}`,
    parentTaskId: "",
    version: {
      definitionVersion: 1,
      statusVersion: 1,
    },
    displayName: meta.displayName,
    taskType: "AUTOMATIC",
    maxExecutionTimeMs: 10000,
    specification: {
      "@type": meta.type,
      commandId,
      trackId: tid,
    },
    createdBy: {
      system: {
        serviceName: "nexus-ui",
        entityId: "nexus-ui",
        managesOwnScheduling: true,
        priority: 1,
      },
    },
    owner: {
      entityId: id,
    },
  };

  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn("[engagement] task failed", {
          kind,
          commandId,
          targetId: tid,
          deviceId: id,
          url,
          status: res.status,
          text,
        });
        return { ok: false, status: res.status, text, url };
      }
      console.info("[engagement] task sent", { kind, commandId, targetId: tid, deviceId: id, url });
      return { ok: true, status: res.status, url };
    })
    .catch((error) => {
      console.warn("[engagement] task error", { kind, commandId, targetId: tid, deviceId: id, url, error });
      return { ok: false, text: error instanceof Error ? error.message : String(error), url };
    });
}

export function postEngagementStartCommand(
  kind: EngagementKind,
  targetId: string,
  deviceId: string,
): Promise<{ ok: boolean; status?: number; text?: string; url?: string }> {
  return postEngagementTaskCommand(kind, targetId, deviceId, 1);
}

export function postEngagementFinishCommand(kind: EngagementKind, targetId: string, deviceId: string): void {
  void postEngagementTaskCommand(kind, targetId, deviceId, 0);
}

