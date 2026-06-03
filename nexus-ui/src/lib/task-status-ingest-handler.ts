import { getTaskStatusBridge } from "@/lib/task-status-bridge";
import { taskStatusResponseLabel } from "@/lib/task-status-chat-format";
import {
  accumulateVerifyObjectKeyFromDescriptionForSession,
  buildMinioPathStyleBrowserUrl,
  resetVerifyObjectKeyAccumulatorForSession,
} from "@/lib/task-status-minio-acc.server";
import {
  isTaskStatusMinioPresignConfigured,
  presignTaskStatusGetUrl,
} from "@/lib/task-status-minio-presign.server";
import { resolveScreenshotMetadataFromDb } from "@/lib/task-status-minio-metadata-db.server";
import type { TaskStatusRequestBody } from "@/lib/task-status-types";
import {
  buildVerifySessionKey,
  resolveVerifyEntityRef,
} from "@/lib/task-status-verify-entity-ref";

function normalizeObjectKeySegments(k: string): string {
  return k.replace(/\/+/g, "/").replace(/^\//, "").replace(/\/$/, "");
}

export type TaskStatusIngestResult =
  | { ok: true; body: { code: number; message: string; data: Record<string, unknown> } }
  | { ok: false; status: number; body: { code: number; message: string; data: null } };

function pickBucketFromBody(o: Record<string, unknown>): string | undefined {
  if (typeof o.minioBucket === "string" && o.minioBucket.trim()) return o.minioBucket.trim();
  if (typeof o.bucket === "string" && o.bucket.trim()) return o.bucket.trim();
  return undefined;
}

function pickExplicitObjectKeyFromBody(o: Record<string, unknown>): string | undefined {
  if (typeof o.minioObjectKey === "string" && o.minioObjectKey.trim()) return o.minioObjectKey.trim();
  if (typeof o.objectKey === "string" && o.objectKey.trim()) return o.objectKey.trim();
  return undefined;
}

/**
 * 与 Qt `InitTaskStatusHttp` 中 JSON 解析及广播逻辑一致，供
 * - Next 路由 `/api/alarms/:id/task-status`
 * - 独立端口 `task-status-http-listener`（默认 7774）
 *
 * `EntityId` / `entityId`：上报方实体 id（`camera_004`、`uav-007` 等），用于会话分组与实体识别；
 * 标准光电可由此推导 `cameraIndex`；未带时仍接受 legacy `cameraIndex`。
 * 未带时若配置 `NEXUS_POSTGRES_URL`（或兼容旧名），则按 Qt `getLatestScreenshotMetadata` 查 `minio_multi_metadata`。
 * MinIO 凭证用于同源 `/api/task-status-image-proxy` 或预签名。
 */
export async function processTaskStatusIngest(alarmId: string, body: unknown): Promise<TaskStatusIngestResult> {
  if (!alarmId.trim()) {
    console.warn("[task-status][verify] 拒绝：alarmId 为空");
    return { ok: false, status: 400, body: { code: 400, message: "invalid alarmId", data: null } };
  }

  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    console.warn("[task-status][verify] 拒绝：请求体非 JSON 对象", { alarmId: alarmId.trim() });
    return { ok: false, status: 400, body: { code: 400, message: "请求体必须是JSON对象", data: null } };
  }

  const o = body as Record<string, unknown>;
  if (!("taskStatus" in o) && !("task_status" in o)) {
    console.warn("[task-status][verify] 拒绝：缺少 taskStatus", { alarmId: alarmId.trim() });
    return { ok: false, status: 400, body: { code: 400, message: "缺少taskStatus字段", data: null } };
  }

  const numField = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      if (!(k in o)) continue;
      const v = o[k];
      if (v === null || v === undefined || v === "") continue;
      const n = typeof v === "number" ? v : Number(String(v).trim());
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  };

  const taskStatus = Number(o.taskStatus ?? o.task_status);
  if (!Number.isFinite(taskStatus)) {
    console.warn("[task-status][verify] 拒绝：taskStatus 无效", {
      alarmId: alarmId.trim(),
      raw: o.taskStatus ?? o.task_status,
    });
    return { ok: false, status: 400, body: { code: 400, message: "taskStatus 无效", data: null } };
  }

  const taskIDL = o.taskID ?? o.task_id;
  const taskID =
    typeof taskIDL === "string"
      ? taskIDL
      : taskIDL != null && taskIDL !== ""
        ? String(taskIDL)
        : undefined;
  const cameraIndexRaw = numField("cameraIndex", "camera_index", "CameraIndex");
  const entityRef = resolveVerifyEntityRef(o, cameraIndexRaw);
  const { entityId, cameraIndex } = entityRef;
  const trackID = numField("trackID", "track_id", "trackId", "TrackID");
  const verifyTargetId = numField("verifyTargetId", "verify_target_id", "targetId", "target_id");
  const uniqueIdFromBody = numField("uniqueId", "unique_id", "uniqueID");
  const longitudeDeg = numField("longitudeDeg", "longitude_deg", "lon", "longitude");
  const latitudeDeg = numField("latitudeDeg", "latitude_deg", "lat", "latitude");
  const distanceNm = numField("distanceNm", "distance_nm", "distanceNauticalMiles");
  const azimuthDegrees = numField(
    "azimuthDegrees",
    "azimuth_degrees",
    "azimuth",
    "bearing",
    "course",
  );
  const speedMps = numField("speedMps", "speed_mps");

  const strField = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      if (!(k in o)) continue;
      const v = o[k];
      if (typeof v !== "string") continue;
      const t = v.trim();
      if (t.length > 0) return t;
    }
    return undefined;
  };
  const shipArchiveInfo = strField("shipArchiveInfo", "ship_archive_info", "aisInfo", "ais_info");

  let description = "";
  if (taskStatus === 5 || taskStatus === 6 || taskStatus === 7) {
    if (typeof o.description === "string") description = o.description;
  }

  const pickImageUrl = (): string | undefined => {
    const keys = ["downloadUrl", "imageUrl", "minioDownloadUrl", "picUrl", "snapshotUrl"];
    for (const k of keys) {
      const v = o[k];
      if (typeof v !== "string") continue;
      const t = v.trim();
      if (/^https?:\/\//i.test(t) || t.startsWith("data:image/") || t.startsWith("/")) return t;
    }
    return undefined;
  };

  const trackOk = trackID != null && Number.isFinite(trackID);
  const camOk = cameraIndex != null && Number.isFinite(cameraIndex);
  const sessionKey = trackOk ? buildVerifySessionKey(trackID!, entityRef) : null;

  if (taskStatus === 4 && sessionKey) {
    resetVerifyObjectKeyAccumulatorForSession(sessionKey);
  }

  let downloadUrl = pickImageUrl();
  let imageSource: string | undefined = downloadUrl ? "bodyUrl" : undefined;

  const envBucket = process.env.TASK_STATUS_VERIFY_IMAGE_BUCKET?.trim();
  const bodyBucket = pickBucketFromBody(o);
  /** Body 优先（库表字段）；env 兜底 */
  let bucketForUrl = bodyBucket ?? envBucket;

  const explicitKeyRaw = pickExplicitObjectKeyFromBody(o);
  const explicitKey = explicitKeyRaw ? normalizeObjectKeySegments(explicitKeyRaw) : undefined;

  let mergedKeySuffix: string | undefined;
  if (sessionKey) {
    mergedKeySuffix = accumulateVerifyObjectKeyFromDescriptionForSession(
      sessionKey,
      taskStatus,
      description,
    );
    if (!mergedKeySuffix) mergedKeySuffix = undefined;
  }

  let objectKeyForUrl = explicitKey ?? mergedKeySuffix;

  /** 与 Qt 一致：未带 bucket/key 时读 PostgreSQL `minio_multi_metadata`（需可解析的 cameraIndex） */
  if (!downloadUrl && camOk) {
    const dbRow = await resolveScreenshotMetadataFromDb({
      uniqueId: uniqueIdFromBody ?? undefined,
      trackId: trackOk ? trackID : undefined,
      cameraIndex: cameraIndex!,
    });
    if (dbRow) {
      bucketForUrl = bucketForUrl ?? dbRow.minioBucket;
      objectKeyForUrl = objectKeyForUrl ?? normalizeObjectKeySegments(dbRow.minioObjectKey);
      const du = dbRow.downloadUrl.trim();
      /** 库内常为 HTTP 直链：HTTPS 页面会混合内容拦截；若已配 MinIO 代理则优先走同源代理 */
      if (/^https:\/\//i.test(du)) {
        downloadUrl = du;
        imageSource = "postgres";
      } else if (/^http:\/\//i.test(du) && !isTaskStatusMinioPresignConfigured()) {
        downloadUrl = du;
        imageSource = "postgres";
      } else if (du) {
        imageSource = "postgresMeta";
      }
    }
  }
  if (objectKeyForUrl && !/\.(jpe?g|png|webp|gif)$/i.test(objectKeyForUrl)) {
    const ext = process.env.TASK_STATUS_VERIFY_IMAGE_DEFAULT_EXT?.trim() || ".jpg";
    const e = ext.startsWith(".") ? ext : `.${ext}`;
    objectKeyForUrl = `${objectKeyForUrl}${e}`;
  }

  /** 优先同源代理：HTTPS 页面加载 HTTP MinIO 预签名会被浏览器拦截（混合内容） */
  if (!downloadUrl && bucketForUrl && objectKeyForUrl && isTaskStatusMinioPresignConfigured()) {
    const bp = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
    downloadUrl = `${bp}/api/task-status-image-proxy?bucket=${encodeURIComponent(bucketForUrl)}&objectKey=${encodeURIComponent(objectKeyForUrl)}`;
    imageSource = "minioProxy";
  }
  if (!downloadUrl && bucketForUrl && objectKeyForUrl) {
    downloadUrl = (await presignTaskStatusGetUrl(bucketForUrl, objectKeyForUrl)) ?? undefined;
    if (downloadUrl) imageSource = "minioPresign";
  }
  if (!downloadUrl && bucketForUrl && objectKeyForUrl) {
    downloadUrl = buildMinioPathStyleBrowserUrl(bucketForUrl, objectKeyForUrl) ?? undefined;
    if (downloadUrl) imageSource = "minioPath";
  }

  const imageMediaType =
    typeof o.imageMediaType === "string" && o.imageMediaType.startsWith("image/")
      ? o.imageMediaType
      : undefined;
  let imageFileName: string | undefined;
  if (typeof o.imageFileName === "string" && o.imageFileName.trim()) imageFileName = o.imageFileName.trim();
  else if (typeof o.fileName === "string" && o.fileName.trim()) imageFileName = o.fileName.trim();

  const payload: TaskStatusRequestBody = {
    taskStatus,
    taskID,
    entityId,
    cameraIndex: camOk ? cameraIndex : undefined,
    trackID: trackID != null && Number.isFinite(trackID) ? trackID : undefined,
    uniqueId: uniqueIdFromBody != null && Number.isFinite(uniqueIdFromBody) ? uniqueIdFromBody : undefined,
    description: description || undefined,
    downloadUrl,
    imageMediaType,
    imageFileName,
    verifyTargetId:
      verifyTargetId != null && Number.isFinite(verifyTargetId) ? verifyTargetId : undefined,
    longitudeDeg: longitudeDeg != null && Number.isFinite(longitudeDeg) ? longitudeDeg : undefined,
    latitudeDeg: latitudeDeg != null && Number.isFinite(latitudeDeg) ? latitudeDeg : undefined,
    distanceNm: distanceNm != null && Number.isFinite(distanceNm) ? distanceNm : undefined,
    azimuthDegrees:
      azimuthDegrees != null && Number.isFinite(azimuthDegrees) ? azimuthDegrees : undefined,
    speedMps: speedMps != null && Number.isFinite(speedMps) ? speedMps : undefined,
    shipArchiveInfo,
  };

  const receivedAt = new Date().toISOString();
  getTaskStatusBridge().emitPayload({
    alarmId: alarmId.trim(),
    ...payload,
    receivedAt,
  });

  const updateTime = new Date().toLocaleString("zh-CN", { hour12: false });
  const statusDesc = taskStatusResponseLabel(taskStatus);

  console.info("[task-status][verify] 查证上报", {
    alarmId: alarmId.trim(),
    taskStatus,
    statusDesc,
    entityId: entityId ?? null,
    cameraIndex: camOk ? cameraIndex : null,
    trackID: trackOk ? trackID : null,
    uniqueId: uniqueIdFromBody ?? null,
    taskID: taskID ?? null,
    sessionKey,
    hasImage: Boolean(downloadUrl),
    imageSource: imageSource ?? (downloadUrl ? "resolved" : "none"),
    descriptionLen: description.length,
    receivedAt,
  });

  return {
    ok: true,
    body: {
      code: 200,
      message: "修改任务状态成功",
      data: {
        alarmId: alarmId.trim(),
        taskStatus: statusDesc,
        updateTime,
      },
    },
  };
}
