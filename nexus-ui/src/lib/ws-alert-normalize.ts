/**
 * 将后端 / V2（AlertWindow、MCP `map_command` alert）多种字段形态规范为 `AlertData`。
 * 对齐 V2 `components/AlertWindow/index.vue` 的 `addAlert` 与 `useDataWebSocket` 注释中的
 * `{ alert_type, title, message, location }`。
 */

import type { AlertData } from "@/stores/alert-store";

function isoNow() {
  return new Date().toISOString();
}

function newAlertId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `al_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** V2 `alert_type` / 通用 `severity` → store 用的三档 */
export function wsAlertTypeToSeverity(
  raw: string | undefined | null,
): "critical" | "warning" | "info" {
  const t = String(raw ?? "info").trim().toLowerCase();
  if (t === "critical") return "critical";
  if (t === "error" || t === "severe" || t === "fatal") return "warning";
  if (t === "warning" || t === "warn") return "warning";
  return "info";
}

/** 单条 WS 对象 → `AlertData`；无法解析时返回 null */
export function normalizeWsAlertItem(raw: unknown): AlertData | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const title = typeof o.title === "string" ? o.title.trim() : "";
  const body =
    (typeof o.message === "string" && o.message) ||
    (typeof o.content === "string" && o.content) ||
    (typeof o.body === "string" && o.body) ||
    (typeof o.text === "string" && o.text) ||
    "";
  const message =
    title && body ? `${title}: ${body}` : title || body || (typeof o.msg === "string" ? o.msg : "");
  if (!message) return null;

  const alertTypeRaw =
    (typeof o.severity === "string" && o.severity) ||
    (typeof o.alert_type === "string" && o.alert_type) ||
    (typeof o.alertType === "string" && o.alertType) ||
    (typeof o.level === "string" && o.level) ||
    "info";

  const severity = wsAlertTypeToSeverity(alertTypeRaw);

  const idRaw = o.id ?? o.alert_id ?? o.alertId;
  const id =
    typeof idRaw === "string" && idRaw.trim()
      ? idRaw.trim()
      : typeof idRaw === "number" && Number.isFinite(idRaw)
        ? String(idRaw)
        : newAlertId();

  const tsRaw = o.timestamp ?? o.time ?? o.created_at ?? o.createdAt;
  const timestamp =
    typeof tsRaw === "string" && tsRaw.trim()
      ? tsRaw.trim()
      : typeof tsRaw === "number" && Number.isFinite(tsRaw)
        ? new Date(tsRaw).toISOString()
        : isoNow();

  const trackRaw = o.trackId ?? o.track_id ?? o.tid ?? o.track;
  const trackId =
    typeof trackRaw === "string" && trackRaw.trim()
      ? trackRaw.trim()
      : typeof trackRaw === "number" && Number.isFinite(trackRaw)
        ? String(trackRaw)
        : undefined;

  let lat: number | undefined;
  let lng: number | undefined;
  const loc = o.location;
  if (Array.isArray(loc) && loc.length >= 2) {
    lng = Number(loc[0]);
    lat = Number(loc[1]);
  } else if (loc && typeof loc === "object") {
    const L = loc as Record<string, unknown>;
    const la = L.lat ?? L.latitude;
    const ln = L.lng ?? L.longitude ?? L.lon;
    if (la != null && ln != null) {
      lat = Number(la);
      lng = Number(ln);
    }
  }
  if (o.lat != null && o.lng != null) {
    lat = Number(o.lat);
    lng = Number(o.lng);
  }

  const type =
    typeof o.type === "string" && o.type !== "map_command" && o.type !== "alert_batch"
      ? o.type
      : undefined;

  const out: AlertData = {
    id,
    severity,
    message,
    timestamp,
    ...(trackId ? { trackId } : {}),
    ...(lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {}),
    ...(type ? { type } : {}),
  };
  return out;
}

export function normalizeWsAlertList(list: unknown[] | undefined | null): AlertData[] {
  if (!Array.isArray(list)) return [];
  const out: AlertData[] = [];
  for (const item of list) {
    const n = normalizeWsAlertItem(item);
    if (n) out.push(n);
  }
  return out;
}
