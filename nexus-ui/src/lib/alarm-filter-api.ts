/**
 * 航迹告警过滤：POST `filterTargetOrForce` 至告警服务 `/api/alarm_filter`。
 * 经 Next BFF `/api/alarm-filter` 转发，避免浏览器跨域。
 */

/** 0=海上融合航迹，1=对空融合航迹 */
export type AlarmFilterFuseType = 0 | 1;

const FILTER_SPEC_TYPE = "type.casia.tasks.v1.filterTargetOrForce";

/** 解析 NewTrack target_id（支持大整数，字符串原样传递） */
export function parseTargetIdForAlarmFilter(trackId: string): string | null {
  const s = String(trackId).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return s;
  const digits = s.replace(/\D/g, "");
  return digits || null;
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
 * specification.id 为 NewTrack DDS target_id。
 */
export async function sendAlarmTrackFilterRequest(
  trackId: string,
  fuseType: AlarmFilterFuseType,
  options?: { taskId?: string },
): Promise<AlarmFilterPostResult> {
  const id = parseTargetIdForAlarmFilter(trackId);
  if (id == null) {
    return { ok: false, message: "无法解析 target_id" };
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
