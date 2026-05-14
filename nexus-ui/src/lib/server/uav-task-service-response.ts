/**
 * 任务服务 `POST .../api/v1/tasks` 常 HTTP 200 但 JSON 内 `code≠0` 表示失败（与私有云 api4third 类似）。
 */
export function isUavTaskServiceResponseOk(httpOk: boolean, responseText: string): boolean {
  if (!httpOk) return false;
  const t = responseText.trim();
  if (!t) return true;
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    if (typeof j.code === "number" && j.code !== 0) return false;
    if (j.success === false) return false;
    if (j.ok === false) return false;
  } catch {
    /* 非 JSON 时仅依据 HTTP */
  }
  return true;
}
