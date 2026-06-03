/**
 * 人工确认告警：POST `/api/alarm_confirm` 至 AlarmSys（经 Next BFF 转发）。
 */

import type { AlertData } from "@/stores/alert-store";
import type { Track } from "@/lib/map-entity-model";
import { resolveTrackFromAlarmTrackId } from "@/lib/run-gis-track-verification";

export type AlarmConfirmPostResult = {
  ok: boolean;
  message?: string;
};

/** 解析 unique_id（正整数） */
export function parseUniqueIdForAlarmConfirm(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  return null;
}

export function resolveUniqueIdFromTrack(
  track: Pick<Track, "uniqueID" | "showID" | "trackId">,
): number | null {
  return (
    parseUniqueIdForAlarmConfirm(track.uniqueID) ??
    parseUniqueIdForAlarmConfirm(track.showID) ??
    parseUniqueIdForAlarmConfirm(track.trackId)
  );
}

/** 告警条目 → unique_id（优先 alert.uniqueID，回退匹配航迹） */
export function resolveUniqueIdForAlert(
  alert: Pick<AlertData, "uniqueID" | "trackId">,
  shadowTracks: ReadonlyMap<string, Track>,
): number | null {
  const direct = parseUniqueIdForAlarmConfirm(alert.uniqueID);
  if (direct != null) return direct;

  const trackId = alert.trackId?.trim();
  if (!trackId) return null;

  const track = resolveTrackFromAlarmTrackId(trackId, shadowTracks, alert);
  if (!track) return null;
  return resolveUniqueIdFromTrack(track);
}

/**
 * 确认告警：AlarmSys 将 taskStatus 置为 VERIFY_SUCCESS 并 DDS 发布。
 */
export async function sendAlarmConfirmRequest(uniqueId: number): Promise<AlarmConfirmPostResult> {
  if (!Number.isFinite(uniqueId) || uniqueId <= 0) {
    return { ok: false, message: "invalid uniqueId" };
  }

  try {
    const res = await fetch("/api/alarm-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uniqueId }),
    });
    const text = await res.text().catch(() => "");
    let message: string | undefined;
    try {
      const j = text ? (JSON.parse(text) as { message?: string; code?: number }) : {};
      message = typeof j.message === "string" ? j.message : undefined;
      if (res.ok && (j.code === 0 || j.code === undefined)) {
        return { ok: true, message: message ?? "ok" };
      }
      const fallback = text.trim() === "{}" ? `HTTP ${res.status}（AlarmSys 可能未升级或未找到航迹）` : undefined;
      return {
        ok: false,
        message: message ?? fallback ?? (text.slice(0, 200) || `HTTP ${res.status}`),
      };
    } catch {
      if (res.ok) return { ok: true };
      return { ok: false, message: text.slice(0, 200) || `HTTP ${res.status}` };
    }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
