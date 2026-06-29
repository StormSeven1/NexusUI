/**
 * disposal-api — 处置方案 HTTP 交互层
 *
 * 1. fetchDisposalPlansHttp — 手动产生方案
 * 2. postDisposalExecute — 执行方案
 *
 * 告警消灭走 alert-destroy.runAlertDestroyHttp。
 */

import { getHttpChatConfig } from "@/lib/map-app-config";
import type { NormalizedDisposalPlans } from "./disposal-types";
import {
  buildGrpcDisposalExecuteBody,
  buildNormalizedDisposalPlansFromHttp500Detail,
  normalizeDisposalPlansFromHttpJson,
} from "./normalize-disposal-plans";
import type { MappedDisposalScheme } from "./disposal-types";

/** 判断错误是否为网络类错误（超时/断网/DNS 等），用于友好提示 */
function isLikelyNetworkError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: string; message?: string };
  if (e.name === "AbortError") return true;
  const msg = String(e.message || "").toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||
    msg.includes("timeout") ||
    msg.includes("timed out")
  );
}

/** 将网络类错误转为中文友好提示，非网络错误返回原始 message */
function getNetworkFriendlyMessage(error: unknown, fallback = "网络不通畅，请检查网络后重试"): string {
  if (isLikelyNetworkError(error)) return fallback;
  return error instanceof Error ? error.message : fallback;
}

/**
 * 构建一键处置请求体：从 disposalData 中提取 targetInfo 字段，
 * 确保所有数值字段有默认值 0，targetId 为字符串。
 * 支持嵌套 targetInfo 和扁平结构两种输入格式。
 */
export function buildOneClickDisposalRequestBody(disposalData: { targetInfo?: Record<string, unknown> } | Record<string, unknown>) {
  const ti = (disposalData?.targetInfo || disposalData) as Record<string, unknown>;
  const rawId = ti.targetId;
  const targetId = rawId != null && rawId !== "" ? String(rawId) : "";
  return {
    targetInfo: {
      targetId,
      targetType: Number(ti.targetType) || 0,
      longitude: Number(ti.longitude) || 0,
      latitude: Number(ti.latitude) || 0,
      speed: Number(ti.speed) || 0,
      course: Number(ti.course) || 0,
    },
  };
}

/**
 * 手动产生处置方案（一键处置）
 *
 * 【请求】POST disposalManualGeneratePlanUrl
 * 【请求体】{ targetInfo: { targetId, targetType, longitude, latitude, speed, course } }
 * 【响应处理】
 *   - 200 + JSON → normalizeDisposalPlansFromHttpJson → 方案卡片
 *   - 500 + { detail: "..." } → 业务说明（含「未生成有效方案」），走空方案卡片，不抛错
 *   - 其他错误 → 抛出异常
 * 【超时】disposalHttpTimeoutMs（默认 8000ms）
 */
export async function fetchDisposalPlansHttp(disposalData: { targetInfo?: Record<string, unknown> }): Promise<NormalizedDisposalPlans | null> {
  const config = getHttpChatConfig();
  // 使用合并后的手动产生方案完整 URL（原 disposalUrl + disposalPath 已合并为 disposalManualGeneratePlanUrl）
  const url = config.disposalManualGeneratePlanUrl;
  const timeoutMs = config.disposalHttpTimeoutMs > 0 ? config.disposalHttpTimeoutMs : 8000;
  const body = buildOneClickDisposalRequestBody(disposalData);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    throw new Error(getNetworkFriendlyMessage(error));
  } finally {
    clearTimeout(timeoutId);
  }

  // 读取响应文本（无论 ok 与否都需要，500 时要解析 detail）
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 500) {
      let detail = "";
      try {
        if (text.trim()) {
          const j = JSON.parse(text) as { detail?: string };
          if (typeof j.detail === "string") detail = j.detail;
        }
      } catch {
        /* ignore */
      }
      const trimmed = detail.trim();
      // 与 V2 ChatContainer 一致：FastAPI `{ "detail": "…" }` 表示业务说明（含「未生成有效方案」），不抛错，走空方案卡片
      if (trimmed) {
        return buildNormalizedDisposalPlansFromHttp500Detail(trimmed, disposalData);
      }
      const err = new Error("处置触发 HTTP 500") as Error & { status?: number; detail?: string };
      err.status = 500;
      err.detail = "";
      throw err;
    }
    throw new Error(`处置触发 HTTP ${response.status}`);
  }

  if (!text.trim()) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  return normalizeDisposalPlansFromHttpJson(json, disposalData);
}

/** 处置方案执行结果 */
export interface ExecuteDisposalResult {
  ok: boolean;
  success?: boolean;
  message?: string;
  businessWorkflowId?: string;
  pageUrl?: string;
}

/**
 * 执行处置方案（grpc-disposal/execute）
 * POST disposalExecuteUrl，body 由 buildGrpcDisposalExecuteBody 构建
 */
export async function postDisposalExecute(
  scheme: MappedDisposalScheme,
  parentTaskId: string,
): Promise<ExecuteDisposalResult> {
  const config = getHttpChatConfig();
  const url = config.disposalExecuteUrl;
  const timeoutMs = config.disposalExecuteTimeoutMs > 0 ? config.disposalExecuteTimeoutMs : 8000;
  const requestBody = buildGrpcDisposalExecuteBody(scheme, parentTaskId);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const text = await response.text();
    let result: Record<string, unknown> = {};
    try {
      result = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      result = {};
    }
    if (!response.ok) {
      return { ok: false, success: false, message: String(result?.message || `HTTP ${response.status}`) };
    }
    return {
      ok: true,
      success: result.success !== false,
      message: typeof result.message === "string" ? result.message : undefined,
      businessWorkflowId: typeof result.businessWorkflowId === "string" ? result.businessWorkflowId : undefined,
      pageUrl:
        typeof result.pageUrl === "string"
          ? result.pageUrl
          : typeof result.page_url === "string"
            ? result.page_url
            : typeof result.url === "string"
              ? result.url
              : undefined,
    };
  } catch (error) {
    return { ok: false, success: false, message: getNetworkFriendlyMessage(error) };
  } finally {
    clearTimeout(timeoutId);
  }
}

