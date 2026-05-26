/**
 * 航迹告警过滤：POST `filterTargetOrForce` 至告警服务 `/api/alarm_filter`。
 * 经 Next BFF `/api/alarm-filter` 转发，避免浏览器跨域。
 */

/** 0=海上融合航迹，1=对空融合航迹 */
export type AlarmFilterFuseType = 0 | 1;

const FILTER_SPEC_TYPE = "type.casia.tasks.v1.filterTargetOrForce";

/** 将业务 track_id 解析为告警服务要求的正整数 id（非 uniqueID/showID） */
export function parseBusinessTrackIdForAlarmFilter(trackId: string): number | null {
  const s = String(trackId).trim();
  if (!s) return null;
  const direct = Number(s);
  if (Number.isFinite(direct) && direct > 0 && Number.isInteger(direct)) {
    return direct;
  }
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function fuseTypeFromTrackKind(isAirTrack: boolean): AlarmFilterFuseType {
  return isAirTrack ? 1 : 0;
}

export type AlarmFilterPostResult = {
  ok: boolean;
  message?: string;
};

/**
 * 删除/过滤指定航迹告警：POST JSON 体对齐 AlarmSys `AlarmHttpServer`。
 */
export async function sendAlarmTrackFilterRequest(
  trackId: string,
  fuseType: AlarmFilterFuseType,
  options?: { taskId?: string },
): Promise<AlarmFilterPostResult> {
  const id = parseBusinessTrackIdForAlarmFilter(trackId);
  if (id == null) {
    return { ok: false, message: "无法解析业务 track_id" };
  }

  const taskId =
    options?.taskId?.trim() ||
    `task-filter-${Date.now()}`;

  const body = {
    taskId,
    specification: {
      "@type": FILTER_SPEC_TYPE,
      type: fuseType,
      id,
    },
  };

  try {
    const res = await fetch("/api/alarm-filter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => "");
    let message: string | undefined;
    try {
      const j = text ? (JSON.parse(text) as { message?: string; code?: number }) : {};
      message = typeof j.message === "string" ? j.message : undefined;
      if (res.ok && (j.code === 0 || j.code === undefined)) {
        return { ok: true, message: message ?? "ok" };
      }
      if (res.ok) {
        return { ok: true, message };
      }
      return {
        ok: false,
        message: message ?? (text.slice(0, 200) || `HTTP ${res.status}`),
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
