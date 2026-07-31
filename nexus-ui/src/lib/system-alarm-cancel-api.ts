/**
 * 系统告警取消：浏览器 → Next BFF → AlarmSys CancelAlarm gRPC。
 */

export type CancelSystemAlarmClientResult = {
  ok: boolean;
  message?: string;
  error?: string;
};

export async function sendSystemAlarmCancelRequest(params: {
  alarmId: string;
  systemId: string;
  reason?: string;
}): Promise<CancelSystemAlarmClientResult> {
  const alarmId = String(params.alarmId ?? "").trim();
  const systemId = String(params.systemId ?? "").trim();
  if (!alarmId || !systemId) {
    return { ok: false, error: "缺少 alarmId 或 systemId" };
  }
  try {
    const res = await fetch("/api/system-alarms/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        alarmId,
        systemId,
        reason: params.reason ?? "NexusUI 告警中心删除",
        timestampMs: Date.now(),
        canceledTimeMs: Date.now(),
      }),
    });
    const body = (await res.json()) as {
      ok?: boolean;
      message?: string;
      error?: string;
    };
    if (!res.ok || body.ok === false) {
      return {
        ok: false,
        message: body.message,
        error: body.error ?? `HTTP ${res.status}`,
      };
    }
    return { ok: true, message: body.message ?? "ok" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
