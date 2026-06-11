import { pickTaskStatusImageUrl } from "@/lib/task-status-chat-format";
import { findTrackForTaskStatusVerify } from "@/lib/task-status-track-enrich";
import type { TaskStatusChatPayload } from "@/lib/task-status-types";
import type { Track } from "@/lib/map-entity-model";
import { resolveVerifyTargetIdFromPayload } from "@/lib/task-status-verify-target-id";

function normUniqueId(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return /^\d+$/.test(s) ? s : null;
}

/** 从查证 HTTP/SSE 载荷解析 unique_id（`target_id` 优先，否则按 trackID 查内存航迹） */
export function resolveVerifyUniqueId(
  payload: TaskStatusChatPayload,
  tracks: readonly Track[],
): string | null {
  const fromBody = normUniqueId(resolveVerifyTargetIdFromPayload(payload));
  if (fromBody) return fromBody;

  const track = findTrackForTaskStatusVerify(resolveVerifyTargetIdFromPayload(payload), tracks);
  if (track) {
    const uid = normUniqueId(track.uniqueID);
    if (uid) return uid;
    return normUniqueId(track.showID);
  }
  return null;
}

/** 智能助手收到可展示查证图 → 视为查证完成 */
export function taskStatusPayloadIndicatesVerifyComplete(payload: TaskStatusChatPayload): boolean {
  return Boolean(pickTaskStatusImageUrl(payload));
}
