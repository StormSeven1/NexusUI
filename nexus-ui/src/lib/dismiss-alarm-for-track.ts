/**
 * 取消航迹告警：与告警面板「删除」相同，POST `filterTargetOrForce` 并从列表移除。
 */

import type { Track } from "@/lib/map-entity-model";
import {
  sendAlarmTrackFilterAllFuseTypes,
  type AlarmFilterPostResult,
} from "@/lib/alarm-filter-api";
import { resolveUniqueIdFromTrack } from "@/lib/alarm-confirm-api";
import { useAlertStore } from "@/stores/alert-store";
import { useTrackStore } from "@/stores/track-store";

/** AlarmSys `addAlarmFilter(type, targetId)` 的 targetId = unique_id */
export function resolveAlarmFilterTargetId(
  track: Pick<Track, "uniqueID" | "showID" | "trackId">,
): string | null {
  const uid = resolveUniqueIdFromTrack(track);
  if (uid != null) return String(uid);
  const tid = track.trackId?.trim();
  return tid || null;
}

function removeAlarmsForTrackFromStore(track: Pick<Track, "uniqueID" | "showID" | "trackId">) {
  const keys = new Set<string>();
  const filterId = resolveAlarmFilterTargetId(track);
  if (filterId) keys.add(filterId);
  const biz = track.trackId?.trim();
  if (biz) keys.add(biz);
  const sid = track.showID?.trim();
  if (sid) keys.add(sid);
  const uid = track.uniqueID?.trim();
  if (uid) keys.add(uid);

  const store = useAlertStore.getState();
  for (const k of keys) {
    store.removeAlarmItemsByTrackId(k);
  }
}

export async function dismissAlarmForTrack(
  track: Pick<Track, "trackId" | "showID" | "uniqueID" | "isAirTrack">,
  options?: { clearManualAffiliation?: boolean },
): Promise<AlarmFilterPostResult> {
  const filterId = resolveAlarmFilterTargetId(track);
  if (!filterId) {
    return { ok: false, message: "航迹缺少 unique_id / track_id" };
  }

  const result = await sendAlarmTrackFilterAllFuseTypes(filterId);
  if (!result.ok) return result;

  removeAlarmsForTrackFromStore(track);

  if (options?.clearManualAffiliation) {
    const showId = track.showID?.trim();
    if (showId) {
      useTrackStore.getState().clearManualTrackAffiliation(showId);
    }
  }

  return result;
}

/** 仅有告警 trackId、尚无航迹对象时的取消（告警 dock 删除兜底） */
export async function dismissAlarmByTargetId(
  targetId: string,
): Promise<AlarmFilterPostResult> {
  const id = targetId.trim();
  if (!id) return { ok: false, message: "缺少 target_id" };

  const result = await sendAlarmTrackFilterAllFuseTypes(id);
  if (!result.ok) return result;

  useAlertStore.getState().removeAlarmItemsByTrackId(id);
  return result;
}
