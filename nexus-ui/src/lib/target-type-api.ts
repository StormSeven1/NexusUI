/**
 * 手动设置对海目标类型：BFF → TrackManager TargetTypeService.UpdateTargetType。
 */
import type { Track } from "@/lib/map-entity-model";
import { resolveUniqueIdFromTrack } from "@/lib/alarm-confirm-api";
import {
  UNIT_TYPE_BUOY,
  UNIT_TYPE_OTHER,
  UNIT_TYPE_SURFACE_SHIP,
} from "@/lib/track-category-id-parse";

export type SeaManualTargetType = "ship" | "buoy" | "other";

export type UpdateTargetTypeResult = {
  ok: boolean;
  message?: string;
  targetType?: SeaManualTargetType;
};

export function seaManualTargetTypeToClassifiedType(t: SeaManualTargetType): number {
  if (t === "buoy") return UNIT_TYPE_BUOY;
  if (t === "ship") return UNIT_TYPE_SURFACE_SHIP;
  return UNIT_TYPE_OTHER;
}

export const SEA_MANUAL_TARGET_TYPE_OPTIONS: Array<{
  value: SeaManualTargetType;
  label: string;
}> = [
  { value: "ship", label: "船 (ship)" },
  { value: "buoy", label: "浮标 (buoy)" },
  { value: "other", label: "其他 (other)" },
];

export async function sendUpdateTargetTypeRequest(
  track: Pick<Track, "uniqueID" | "showID" | "trackId">,
  targetType: SeaManualTargetType,
): Promise<UpdateTargetTypeResult> {
  const uniqueId = resolveUniqueIdFromTrack(track);
  if (uniqueId == null) {
    return { ok: false, message: "航迹缺少有效 uniqueId / target_id" };
  }

  try {
    const res = await fetch("/api/target-type", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: uniqueId, targetType }),
    });
    const text = await res.text().catch(() => "");
    let message: string | undefined;
    let parsedType: string | undefined;
    try {
      const j = text ? (JSON.parse(text) as { message?: string; targetType?: string; ok?: boolean }) : {};
      message = typeof j.message === "string" ? j.message : undefined;
      parsedType = typeof j.targetType === "string" ? j.targetType : undefined;
      if (res.ok && j.ok !== false) {
        return {
          ok: true,
          message: message ?? "ok",
          targetType: (parsedType as SeaManualTargetType) || targetType,
        };
      }
      return {
        ok: false,
        message: message ?? (text.slice(0, 200) || `HTTP ${res.status}`),
      };
    } catch {
      if (res.ok) return { ok: true, targetType };
      return { ok: false, message: text.slice(0, 200) || `HTTP ${res.status}` };
    }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
