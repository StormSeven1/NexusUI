import { canonicalEntityId } from "@/lib/camera-entity-id";
import { extractEntityRecords } from "@/lib/eo-video/mapEntitiesToDroneDevices";
import { isCameraEntityId } from "@/lib/eo-video/mapEntitiesToCameraDevices";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickStr(r: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function rowLabel(raw: Record<string, unknown>, entityId: string): string {
  const aliases = raw.aliases;
  if (isRecord(aliases) && typeof aliases.name === "string" && aliases.name.trim()) {
    return aliases.name.trim();
  }
  return entityId;
}

/** 实体列表里与航迹元任务 owner 相关的相机行（服务端与客户端共用解析） */
export type EntityTaskRow = {
  entityId: string;
  label: string;
  /** `sensorParameters.capabilities.hasPtz` */
  hasPtz: boolean;
  /** `aliases.auth.parent_device_id` */
  parentDeviceId: string;
};

/**
 * 航迹任务 owner 规则：`hasPtz` 且主设备（`aliases.auth.parent_device_id` 为空）。
 */
export function isTrackTaskOwnerRowAllowed(row: EntityTaskRow): boolean {
  return row.hasPtz && row.parentDeviceId.length === 0;
}

/** 从 `/api/v1/entities` 分页 JSON 提取全部 `camera_*` 任务相关字段 */
export function buildEntityTaskRowsFromEntitiesPayload(payload: unknown): EntityTaskRow[] {
  const records = extractEntityRecords(payload);
  const byId = new Map<string, EntityTaskRow>();
  for (const raw of records) {
    if (!isRecord(raw)) continue;
    const rawId = pickStr(raw, ["entityId", "entity_id", "id"]);
    if (!rawId || !isCameraEntityId(rawId)) continue;
    const entityId = canonicalEntityId(rawId);
    let parentDeviceId = "";
    const aliases = raw.aliases;
    if (isRecord(aliases)) {
      const auth = aliases.auth;
      if (isRecord(auth) && typeof auth.parent_device_id === "string") {
        parentDeviceId = auth.parent_device_id.trim();
      }
    }
    let hasPtz = false;
    const sp = raw.sensorParameters;
    if (isRecord(sp)) {
      const cap = sp.capabilities;
      if (isRecord(cap)) {
        const hp = cap.hasPtz;
        hasPtz = hp === 1 || hp === true || hp === "1";
      }
    }
    byId.set(entityId, {
      entityId,
      label: rowLabel(raw, entityId),
      hasPtz,
      parentDeviceId: parentDeviceId ? canonicalEntityId(parentDeviceId) : "",
    });
  }
  return [...byId.values()].sort((a, b) =>
    a.entityId.localeCompare(b.entityId, undefined, { numeric: true }),
  );
}
