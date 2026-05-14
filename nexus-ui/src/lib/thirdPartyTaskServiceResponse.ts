/**
 * 第三方相机任务服务统一回调体（与光电任务 POST 返回一致）：
 * `{ refTaskId, result: "OK"|"REJECTED"|"FAILED", message }`
 */

export type ThirdPartyTaskResultToken = "OK" | "REJECTED" | "FAILED";

export interface ParsedThirdPartyTaskResponse {
  refTaskId?: string;
  result?: string;
  message?: string;
}

export function parseThirdPartyTaskServiceResponse(text: string): ParsedThirdPartyTaskResponse | null {
  const t = text.trim();
  if (!t || t[0] !== "{") return null;
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    return {
      refTaskId: typeof j.refTaskId === "string" ? j.refTaskId : undefined,
      result: typeof j.result === "string" ? j.result : undefined,
      message: typeof j.message === "string" ? j.message : undefined,
    };
  } catch {
    return null;
  }
}

export function isThirdPartyTaskResultFailure(result: string | undefined): boolean {
  if (!result) return false;
  const u = result.trim().toUpperCase();
  return u === "REJECTED" || u === "FAILED";
}

export function formatThirdPartyTaskLogLine(parsed: ParsedThirdPartyTaskResponse | null): string {
  if (!parsed) return "";
  const parts: string[] = [];
  if (parsed.refTaskId) parts.push(`refTaskId=${parsed.refTaskId}`);
  if (parsed.result) parts.push(`result=${parsed.result}`);
  if (parsed.message) parts.push(`message=${parsed.message}`);
  return parts.join(" · ");
}

/** HTTP 层成功且 body 内 `result` 非 REJECTED/FAILED 时视为受理成功 */
export function evaluateThirdPartyTaskHttpResponse(
  httpOk: boolean,
  bodyText: string,
): { accepted: boolean; logLine: string } {
  const parsed = parseThirdPartyTaskServiceResponse(bodyText);
  const detail = formatThirdPartyTaskLogLine(parsed);
  if (!httpOk) {
    return {
      accepted: false,
      logLine: detail ? `HTTP 失败 · ${detail}` : "HTTP 失败",
    };
  }
  if (parsed?.result && isThirdPartyTaskResultFailure(parsed.result)) {
    return {
      accepted: false,
      logLine: detail || `result=${parsed.result}`,
    };
  }
  return {
    accepted: true,
    logLine: detail || "OK",
  };
}
