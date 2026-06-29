export type FetchActiveAlarmSchemeResult =
  | { ok: true; schemeId: string }
  | { ok: false; error: string };

/**
 * 读取当前激活告警方案 ID（`alarm_master_schemes.enabled = true`），
 * 对齐 Qt `DataAccessLayer::getActiveSchemeId()`。
 */
export async function fetchActiveAlarmSchemeId(signal?: AbortSignal): Promise<FetchActiveAlarmSchemeResult> {
  try {
    const res = await fetch("/api/master-schemes/active", {
      cache: "no-store",
      signal,
    });
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      scheme_id?: string | null;
      message?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: json.message?.trim() || `读取激活方案失败 HTTP ${res.status}`,
      };
    }
    const schemeId = typeof json.scheme_id === "string" ? json.scheme_id.trim() : "";
    if (!schemeId) {
      return {
        ok: false,
        error:
          json.message?.trim() ||
          "未找到 enabled=true 的告警方案（alarm_master_schemes），无法启动日常查证",
      };
    }
    return { ok: true, schemeId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
