/**
 * 从 WS/DDS 报文推断 `Track.lastUpdate`（ISO 字符串）。
 * Worker 与 `ws-track-normalize` 共用；勿依赖 `@/` 重型模块。
 *
 * 说明：前端超时剔除优先使用 `track-store` 内「上次 ingest 时间」；
 * 本字段仍供列表/调试显示，并与 DDS `timestamp` 等对齐齐。
 */
export function resolveTrackLastUpdateString(rec: Record<string, unknown>): string {
  const tryIso = (v: unknown): string | null => {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    const p = Date.parse(s);
    return Number.isFinite(p) ? s : null;
  };

  const fromExplicit =
    tryIso(rec.lastUpdate) ??
    tryIso(rec.last_update) ??
    tryIso(rec.updated_at);
  if (fromExplicit) return fromExplicit;

  const ts = rec.timestamp ?? rec.timeStamp ?? rec.time_stamp;
  if (typeof ts === "number" && Number.isFinite(ts)) {
    let ms: number;
    if (ts > 1e12) ms = ts;
    else if (ts > 1e9) ms = ts * 1000;
    else return new Date().toISOString();
    if (ms > 946684800000 && ms < Date.now() + 86400000 * 365 * 50) return new Date(ms).toISOString();
  } else if (ts != null) {
    const s = String(ts).trim();
    if (/^\d{10,13}$/.test(s)) {
      const n = Number(s);
      const ms = s.length >= 13 ? n : n * 1000;
      if (ms > 946684800000 && ms < Date.now() + 86400000 * 365 * 50) return new Date(ms).toISOString();
    } else {
      const iso = tryIso(s);
      if (iso) return iso;
    }
  }

  return new Date().toISOString();
}
