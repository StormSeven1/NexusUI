import type { TaskStatusChatPayload } from "@/lib/task-status-types";

/** 与 watch-sys-camera `kStableUniqueIdThreshold` 一致 */
export const STABLE_TARGET_ID_THRESHOLD = 100_000;

export function normTargetIdDigits(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.trunc(n);
}

const BODY_TARGET_ID_KEYS = [
  "target_id",
  "targetId",
  "verifyTargetId",
  "verify_target_id",
  "uniqueId",
  "unique_id",
  "uniqueID",
] as const;

/**
 * 从 7774 查证 JSON 解析 canonical `target_id`（与航迹 `uniqueID`、库表 `unique_id` 对齐）。
 * 不使用 legacy `trackID`：库表 `trackid` 为 external_target_id，与 `target_id` 不同。
 */
export function resolveVerifyTargetIdFromBody(o: Record<string, unknown>): number | undefined {
  for (const k of BODY_TARGET_ID_KEYS) {
    const v = normTargetIdDigits(o[k]);
    if (v != null) return v;
  }
  return undefined;
}

/** 查证会话唯一键：仅 `target_id` / verifyTargetId / uniqueId，不用 HTTP trackID */
export function resolveVerifyTargetIdFromPayload(p: TaskStatusChatPayload): number | undefined {
  return normTargetIdDigits(p.verifyTargetId) ?? normTargetIdDigits(p.uniqueId);
}
