"use client";

/** 与 Qt / EoVideoPanel 一致 */
export const UAV_AIRPORT_FPV_PAYLOAD = "165-0-7";
export const UAV_DRONE_MAIN_PAYLOAD = "81-0-0";
export const UAV_DRONE_MAIN_PAYLOAD_SPECIAL = "80-0-0";

export function uavMainPayloadForDroneSn(droneSn: string): string {
  return droneSn.trim() === "1581F6QAD241200BWX4E"
    ? UAV_DRONE_MAIN_PAYLOAD_SPECIAL
    : UAV_DRONE_MAIN_PAYLOAD;
}

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

/**
 * 按舱内/舱外选择 start 目标；MQTT 未知时机场+机体各发一次（对齐 Qt 首次切流）。
 */
export async function pokeUavLiveStreamsForView(args: {
  airportSn: string;
  droneSn: string;
  mqttDroneInDock: boolean | null;
}): Promise<{ parts: string[]; anyOk: boolean }> {
  const ap = args.airportSn.trim();
  const dr = args.droneSn.trim();
  const mainPayload = uavMainPayloadForDroneSn(dr);
  const parts: string[] = [];
  let anyOk = false;

  const pokeOne = async (label: string, sn: string, payload: string) => {
    if (!sn) {
      parts.push(`${label}=skip_no_sn`);
      return;
    }
    const r = await pokeDroneLiveStream(sn, payload);
    if (r.ok) anyOk = true;
    parts.push(`${label}=${r.ok ? "ok" : r.detail ?? "fail"}`);
  };

  if (args.mqttDroneInDock === false) {
    await pokeOne("air", dr, mainPayload);
  } else if (args.mqttDroneInDock === true) {
    await pokeOne("dock", ap, UAV_AIRPORT_FPV_PAYLOAD);
  } else {
    await Promise.all([
      pokeOne("dock", ap, UAV_AIRPORT_FPV_PAYLOAD),
      pokeOne("air", dr, mainPayload),
    ]);
  }

  return { parts, anyOk };
}
