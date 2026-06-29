import { normalizeVerifyEntityId } from "@/lib/task-status-verify-entity-ref";

const UAV_ENTITY_RE = /\buav-[\w-]+\b/gi;
const CAMERA_ENTITY_RE = /\bcamera_\d{3}\b/gi;

const ENTITY_FIELD_KEYS = new Set([
  "entityid",
  "entity_id",
  "entityids",
  "entity_ids",
  "ownerentityid",
  "owner_entity_id",
  "cameraentityid",
  "camera_entity_id",
  "uav_id",
  "uav_ids",
  "uav_id_list",
  "input_uav_id_list",
  "device_id",
  "deviceid",
]);

function addEntityToken(raw: unknown, out: Set<string>): void {
  if (typeof raw === "string") {
    const parts = raw.split(/[,，;\s]+/);
    for (const part of parts) {
      const id = normalizeVerifyEntityId(part);
      if (id) out.add(id);
    }
    for (const m of raw.matchAll(UAV_ENTITY_RE)) {
      const id = normalizeVerifyEntityId(m[0]);
      if (id) out.add(id);
    }
    for (const m of raw.matchAll(CAMERA_ENTITY_RE)) {
      const id = normalizeVerifyEntityId(m[0]);
      if (id) out.add(id);
    }
    return;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) addEntityToken(item, out);
  }
}

function collectVerifyEntityIds(value: unknown, out: Set<string>, depth: number): void {
  if (depth > 10 || value == null) return;
  if (typeof value === "string" || Array.isArray(value)) {
    addEntityToken(value, out);
    return;
  }
  if (typeof value !== "object") return;
  const o = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    const key = k.toLowerCase();
    if (ENTITY_FIELD_KEYS.has(key)) {
      addEntityToken(v, out);
    }
    collectVerifyEntityIds(v, out, depth + 1);
  }
}

/** 从 LangGraph SSE / interrupt 事件 JSON 中提取 uav-*、camera_* 等查证实体 id */
export function extractVerifyEntityIdsFromLangGraphEvent(
  parsed: Record<string, unknown>,
  message?: string,
): string[] {
  const out = new Set<string>();
  if (message?.trim()) addEntityToken(message, out);
  collectVerifyEntityIds(parsed.data, out, 0);
  collectVerifyEntityIds(parsed, out, 0);
  return [...out];
}

/** @deprecated 使用 extractVerifyEntityIdsFromLangGraphEvent */
export function extractVerifyEntityIdsFromInterrupt(
  parsed: Record<string, unknown>,
  message?: string,
): string[] {
  return extractVerifyEntityIdsFromLangGraphEvent(parsed, message);
}
