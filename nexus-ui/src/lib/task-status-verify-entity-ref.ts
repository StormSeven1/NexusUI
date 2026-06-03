import {
  cameraEntityIdFromIndex,
  cameraIndexFromOwnerEntityId,
  resolveOwnerEntityIdForCameraTask,
} from "@/lib/camera-management-client";

/** 查证上报侧实体引用：优先 `EntityId`，`cameraIndex` 仅作库表/兼容兜底 */
export type VerifyEntityRef = {
  entityId?: string;
  cameraIndex?: number;
};

const VERIFY_ENTITY_ID_KEYS = [
  "EntityId",
  "entityId",
  "entity_id",
  "ownerEntityId",
  "owner_entity_id",
  "cameraEntityId",
  "camera_entity_id",
] as const;

/**
 * 规范化上报实体 id：
 * - `camera_004` / `4` → `camera_004`
 * - `uav-007`、第三方实体 id → 原样 trim（小写不强制）
 */
export function normalizeVerifyEntityId(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  const cam = resolveOwnerEntityIdForCameraTask(t);
  if (/^camera_\d{3}$/i.test(cam)) return cam;
  return t;
}

export function pickVerifyEntityIdFromBody(o: Record<string, unknown>): string | undefined {
  for (const k of VERIFY_ENTITY_ID_KEYS) {
    if (!(k in o)) continue;
    const v = o[k];
    if (typeof v === "string") {
      const id = normalizeVerifyEntityId(v);
      if (id) return id;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      const id = normalizeVerifyEntityId(String(v));
      if (id) return id;
    }
  }
  return undefined;
}

export function resolveVerifyEntityRef(
  o: Record<string, unknown>,
  cameraIndexFromBody: number | undefined,
): VerifyEntityRef {
  let entityId = pickVerifyEntityIdFromBody(o);
  let cameraIndex = cameraIndexFromBody;

  if (entityId && cameraIndex == null) {
    const fromId = cameraIndexFromOwnerEntityId(entityId);
    if (fromId != null) cameraIndex = fromId;
  }

  if (!entityId && cameraIndex != null && Number.isFinite(cameraIndex)) {
    entityId = cameraEntityIdFromIndex(cameraIndex);
  }

  return {
    entityId: entityId || undefined,
    cameraIndex:
      cameraIndex != null && Number.isFinite(cameraIndex) ? Math.trunc(cameraIndex) : undefined,
  };
}

/** 是否已识别到上报实体（EntityId 或 legacy cameraIndex） */
export function verifyEntityRefOk(ref: VerifyEntityRef): boolean {
  return Boolean(ref.entityId?.trim()) || (ref.cameraIndex != null && Number.isFinite(ref.cameraIndex));
}

/**
 * 查证会话 / MinIO 分片累积 key。
 * 优先 `{trackID}_{entityId}`；无 entityId 时回退 `{trackID}_{cameraIndex}`（Qt 兼容）。
 */
export function buildVerifySessionKey(
  trackID: number | undefined | null,
  ref: VerifyEntityRef,
): string | null {
  if (trackID == null) return null;
  const t = Number(trackID);
  if (!Number.isFinite(t) || t <= 0) return null;
  const id = ref.entityId?.trim();
  if (id) return `${t}_${id}`;
  if (ref.cameraIndex != null && Number.isFinite(ref.cameraIndex)) {
    return `${t}_${Math.trunc(ref.cameraIndex)}`;
  }
  return null;
}
