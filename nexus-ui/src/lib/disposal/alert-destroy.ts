/**
 * 告警面板“消灭”：
 * 1. 按 trackId 组装当前 destroy 任务体
 * 2. 只发一次 HTTP 到 Custombackend
 * 3. 后端再负责走 gRPC 广播
 *
 * 说明：
 * - 前端只调用 Custombackend 这一条 HTTP。
 * - destroy 的 gRPC 订阅流与 REST 不共用同一个端口，但监听地址复用后端 HOST。
 */

import {
  collectActiveDisposalForTrack,
  resolveIsAirTrackFromRenderCache,
} from "@/lib/disposal/disposal-active-devices";
import { getHttpChatConfig } from "@/lib/map-app-config";

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
      console.error("[alert-destroy] destroy publish POST 失败:", url, res.status, text);
      return { ok: false, connectedClients: 0 };
    }
    const json = (await res.json().catch(() => ({}))) as { ok?: unknown; connectedClients?: unknown };
    return {
      ok: json.ok !== false,
      connectedClients: Number.isFinite(Number(json.connectedClients)) ? Number(json.connectedClients) : 0,
    };
  } catch (e) {
    console.error("[alert-destroy] destroy publish POST 异常:", url, e);
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
}

/** 告警消灭：只发一次 HTTP，由后端负责继续向 gRPC 客户端广播。 */
export async function runAlertDestroyHttp(trackId: string, uniqueId?: string): Promise<AlertDestroyHttpResult> {
  const tid = String(trackId ?? "").trim();
  const uid = String(uniqueId ?? "").trim();
  const destroyTargetId = uid || tid;
  const { deviceEntityIds } = collectActiveDisposalForTrack(tid);
  const creatorEntityId = deviceEntityIds.join(",");
  const specType = resolveIsAirTrackFromRenderCache(tid) ? FILTER_SPEC_AIR_TARGET : FILTER_SPEC_SEA_TARGET;

  const publishResult = await postFilterTargetOrForceTask(specType, destroyTargetId, creatorEntityId);

  return {
    publishOk: publishResult.ok,
    connectedClients: publishResult.connectedClients,
    deviceEntityIds,
  };
}
