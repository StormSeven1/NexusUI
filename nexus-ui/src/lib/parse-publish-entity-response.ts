/** 上游 `POST /api/v1/publishEntity` 标准响应 */
export type PublishEntityUpstream = {
  code?: number;
  message?: string;
  data?: { entityId?: string } | null;
};

export type ParsedPublishEntityResult = {
  ok: boolean;
  code?: number;
  message: string;
  entityId?: string;
};

export function parsePublishEntityUpstream(upstream: unknown): ParsedPublishEntityResult {
  if (upstream == null || typeof upstream !== "object") {
    return { ok: false, message: "上游返回格式异常" };
  }
  const u = upstream as PublishEntityUpstream;
  const code = u.code != null ? Number(u.code) : NaN;
  const entityId =
    u.data && typeof u.data === "object" && u.data.entityId != null
      ? String(u.data.entityId).trim()
      : undefined;
  const message =
    (u.message != null && String(u.message).trim()) ||
    (code === 0 ? "注册成功" : "注册失败");

  if (code === 0) {
    return { ok: true, code: 0, message, entityId };
  }
  return {
    ok: false,
    code: Number.isFinite(code) ? code : undefined,
    message,
    entityId,
  };
}
