"use client";

/**
 * 对齐 Qt `ptzmainwidget.cpp::sendStartLiveStream`：请求私有云推流再拉 ZLM/WebRTC。
 * 仅唤醒，不替代取流解析；失败不抛错，由上游日志 / 拉流结果体现。
 */
export async function pokeDroneLiveStream(deviceSn: string, payloadIndex: string): Promise<{
  ok: boolean;
  detail?: string;
}> {
  const ds = deviceSn.trim();
  const pi = payloadIndex.trim();
  if (!ds || !pi) return { ok: false, detail: "empty_sn_or_payload" };

  try {
    const res = await fetch("/api/uav-live/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        deviceSn: ds,
        payloadIndex: pi,
        urlType: 1,
        videoQuality: 0,
      }),
      cache: "no-store",
    });
    const text = await res.text().catch(() => "");
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (json.ok === true) {
      return { ok: true, detail: typeof json.message === "string" ? json.message : undefined };
    }
    return {
      ok: false,
      detail: typeof json.error === "string" ? json.error : text.slice(0, 200),
    };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
