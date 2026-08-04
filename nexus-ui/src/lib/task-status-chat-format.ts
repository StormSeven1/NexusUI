import type { TaskStatusChatPayload } from "@/lib/task-status-types";
import type { FileUIPart } from "ai";
import { enrichTaskStatusPayloadForVerifyUi } from "@/lib/task-status-track-enrich";
import { buildVerifySessionKey } from "@/lib/task-status-verify-entity-ref";

export function pickTaskStatusImageUrl(p: TaskStatusChatPayload): string | null {
  const u = p.downloadUrl?.trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u) || u.startsWith("data:image/")) return u;
  /** 同源 `/api/task-status-image-proxy?...`，避免被误判为非 URL */
  if (u.startsWith("/")) return u;
  return null;
}

export function guessImageMediaTypeFromUrl(url: string): string {
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".bmp")) return "image/bmp";
  if (path.endsWith(".jpeg") || path.endsWith(".jpg")) return "image/jpeg";
  return "image/jpeg";
}

export function taskStatusImageFilePart(p: TaskStatusChatPayload): FileUIPart | null {
  const url = pickTaskStatusImageUrl(p);
  if (!url) return null;
  const mediaType = p.imageMediaType?.startsWith("image/")
    ? p.imageMediaType
    : guessImageMediaTypeFromUrl(url);
  return {
    type: "file",
    url,
    mediaType,
    filename: p.imageFileName?.trim() || "verify-snapshot.jpg",
  };
}

function statusLabel(taskStatus: number): string {
  switch (taskStatus) {
    case 0:
      return "待处理";
    case 1:
      return "已完成";
    case 2:
      return "失败";
    case 4:
      return "查证中";
    case 5:
      return "研判结果";
    case 6:
      return "状态 6";
    case 7:
      return "状态 7";
    case 8:
      return "来访记录";
    default:
      return `状态 ${taskStatus}`;
  }
}

/** 航迹 + 实体：优先 `{target_id}_{entityId}`，无 entityId 时回退 `{target_id}_{cameraIndex}` */
export function taskStatusVerifySessionKey(
  targetId: number | undefined | null,
  entityRef: { entityId?: string | null; cameraIndex?: number | null },
): string | null {
  return buildVerifySessionKey(targetId, {
    entityId: entityRef.entityId?.trim() || undefined,
    cameraIndex:
      entityRef.cameraIndex != null && Number.isFinite(Number(entityRef.cameraIndex))
        ? Number(entityRef.cameraIndex)
        : undefined,
  });
}

function fmtFixed(n: number, frac: number): string {
  return n.toFixed(frac);
}

/**
 * taskStatus==4：首次推送「查证目标信息」，与 Qt `mainwindow.cpp` / trackInfo 文案对齐。
 * 航迹细字段由 HTTP 可选传入（longitudeDeg 等）；缺省时仍输出档案行与收尾句。
 */
export function formatTaskStatusVerificationMarkdown(p: TaskStatusChatPayload): string {
  const targetId = p.verifyTargetId ?? p.uniqueId;
  const entityLabel = p.entityId?.trim();
  const lines: string[] = [];
  lines.push(`**${entityLabel && /^uav/i.test(entityLabel) ? "无人机" : "相机"}查证**`);
  if (entityLabel) lines.push(`- **实体**：\`${entityLabel}\``);
  lines.push("");
  if (targetId != null && Number.isFinite(Number(targetId))) {
    lines.push(`正在查证ID为${targetId}的目标，航迹信息：`);
  } else {
    lines.push("正在查证目标，航迹信息：");
  }
  lines.push("");
  const lon = p.longitudeDeg;
  const lat = p.latitudeDeg;
  if (lon != null && lat != null && Number.isFinite(lon) && Number.isFinite(lat)) {
    lines.push(`- 位置：东经${fmtFixed(lon, 4)}°，北纬${fmtFixed(lat, 4)}°`);
  }
  if (p.distanceNm != null && Number.isFinite(p.distanceNm)) {
    lines.push(`- 距离：${fmtFixed(p.distanceNm, 1)}海里`);
  }
  if (p.azimuthDegrees != null && Number.isFinite(p.azimuthDegrees)) {
    lines.push(`- 方位：${fmtFixed(p.azimuthDegrees, 1)}°`);
  }
  if (p.speedMps != null && Number.isFinite(p.speedMps)) {
    lines.push(`- 速度：${fmtFixed(p.speedMps, 1)}m/s`);
  }
  const ship = p.shipArchiveInfo?.trim();
  lines.push(`- 船舶档案信息：${ship && ship.length > 0 ? ship : "无"}`);
  lines.push("");
  lines.push("目标图片如下，正在调用大模型进行研判");
  return lines.join("\n");
}

/** 查证横幅：合并当前内存航迹 / 告警后再格式化（HTTP 可选字段仍优先） */
export function buildTaskStatusVerifyBannerMarkdown(payload: TaskStatusChatPayload): string {
  return formatTaskStatusVerificationMarkdown(enrichTaskStatusPayloadForVerifyUi(payload));
}

/** 无 target_id/cameraIndex、或其它状态时仍用单条气泡完整展示 */
export function formatTaskStatusAssistantMarkdown(p: TaskStatusChatPayload): string {
  const lines: string[] = [];
  lines.push(`**${p.entityId?.trim() && /^uav/i.test(p.entityId.trim()) ? "无人机" : "相机"}查证**`);
  lines.push("");
  lines.push(`- **阶段**：${statusLabel(p.taskStatus)}（码 ${p.taskStatus}）`);
  if (p.taskID) lines.push(`- **任务 ID**：${p.taskID}`);
  if (p.entityId?.trim()) lines.push(`- **实体 ID**：${p.entityId.trim()}`);
  else if (p.cameraIndex != null) lines.push(`- **相机序号**：${p.cameraIndex}`);
  const targetId = p.verifyTargetId ?? p.uniqueId;
  if (targetId != null) lines.push(`- **目标 ID**：${targetId}`);
  lines.push(`- **时间**：${p.receivedAt}`);
  if (p.description?.trim()) {
    lines.push("");
    lines.push(p.description.trim());
  }
  return lines.join("\n");
}

/** HTTP JSON 中与 Qt 接近的 taskStatus 字符串 */
export function taskStatusResponseLabel(taskStatus: number): string {
  switch (taskStatus) {
    case 0:
      return "PENDING";
    case 1:
      return "COMPLETED";
    case 2:
      return "FAILED";
    case 4:
      return "VERIFYING";
    case 5:
      return "MODEL_REPLY";
    case 6:
      return "EXT_6";
    case 7:
      return "EXT_7";
    case 8:
      return "KB_VISIT";
    default:
      return "UNKNOWN";
  }
}
