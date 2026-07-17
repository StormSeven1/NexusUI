"use client";

import { toast } from "sonner";
import { getHttpConfig } from "@/lib/map-app-config";

export type DroneActionType = "poweron" | "poweroff" | "trace" | "strike" | "back" | "reset";

export type DroneCommandPayload =
  | {
      taskId: string;
      params: {
        entityId: string;
      };
    }
  | {
      taskId: string;
      params: {
        type: DroneActionType;
        entityId: string;
      };
    };

export interface DroneCommandResult {
  ok: boolean;
  command: "returnHome" | "action";
  entityId: string;
  type?: DroneActionType;
  taskId?: string;
  message?: string;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const data = await res.json();
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function newTaskId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `task-${crypto.randomUUID()}`;
  }
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildDroneReturnHomePayload(entityId: string): DroneCommandPayload {
  return {
    taskId: newTaskId(),
    params: {
      entityId: text(entityId),
    },
  };
}

export function buildDroneActionPayload(entityId: string, type: DroneActionType): DroneCommandPayload {
  return {
    taskId: newTaskId(),
    params: {
      type,
      entityId: text(entityId),
    },
  };
}

function getDroneCommandEndpoint(): string {
  const backendUrl = getHttpConfig().backendUrl.trim().replace(/\/+$/, "");
  if (!backendUrl) {
    throw new Error("Missing backendUrl in app-config");
  }
  return `${backendUrl}/api/drone/udp-command`;
}

async function postDroneCommandPayload(input: {
  command: "returnHome" | "action";
  payload: DroneCommandPayload;
  type?: DroneActionType;
}): Promise<DroneCommandResult> {
  const entityId = "entityId" in input.payload.params ? text(input.payload.params.entityId) : "";

  try {
    const res = await fetch(getDroneCommandEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.payload),
    });
    const data = await readJson(res);
    const ok = res.ok && data.ok === true;

    return {
      ok,
      command: input.command,
      entityId,
      type: input.type,
      taskId: typeof data.taskId === "string" ? data.taskId : input.payload.taskId,
      message: ok ? undefined : String(data.error ?? data.message ?? `HTTP ${res.status}`),
    };
  } catch (error) {
    return {
      ok: false,
      command: input.command,
      entityId,
      type: input.type,
      message: error instanceof Error ? error.message : "network error",
    };
  }
}

export function sendDroneReturnHomeCommand(entityId: string): Promise<DroneCommandResult> {
  return postDroneCommandPayload({
    command: "returnHome",
    payload: buildDroneReturnHomePayload(entityId),
  });
}

export function sendDroneActionCommand(entityId: string, type: DroneActionType): Promise<DroneCommandResult> {
  return postDroneCommandPayload({
    command: "action",
    payload: buildDroneActionPayload(entityId, type),
    type,
  });
}

function commandLabel(result: DroneCommandResult): string {
  if (result.command === "returnHome") return "无人机返航";
  if (result.type === "strike") return "无人机打击";
  if (result.type === "poweroff") return "无人机待机";
  if (result.type === "poweron") return "无人机上电";
  if (result.type === "trace") return "无人机跟踪";
  if (result.type === "back") return "无人机返航";
  if (result.type === "reset") return "无人机复位";
  return "无人机动作";
}

export function toastDroneCommandResult(result: DroneCommandResult, sourceLabel: string): void {
  const label = commandLabel(result);
  if (result.ok) {
    toast.success(`${sourceLabel}已发送${label}指令`, {
      description: result.taskId ? `${result.entityId} · ${result.taskId}` : result.entityId,
    });
    return;
  }

  toast.error(`${sourceLabel}${label}发送失败`, {
    description: result.message ? `${result.entityId} · ${result.message}` : result.entityId,
  });
}
