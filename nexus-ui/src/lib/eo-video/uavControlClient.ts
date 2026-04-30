"use client";

export type UavControlAction = "takeoff" | "stop" | "back" | "hotback" | "reconnect" | "emergency";

export type UavControlResult = {
  ok: boolean;
  action: UavControlAction;
  /** WatchSys sendCancelAllTasksRequest：POST {UavServer}/api/v1/tasks */
  viaTaskCancel?: { ok: boolean; status: number; body: string; url: string };
  viaHttp?: { ok: boolean; status: number; body: string; url: string };
  viaMqtt?: { ok: boolean; detail: string };
  error?: string;
  detail?: string;
};

export async function postUavControlAction(args: {
  action: UavControlAction;
  airportSN: string;
  deviceSN?: string | null;
  /** 可选：与 WatchSys 起飞点一致，不传则走服务端 NEXUS_UAV_CTRL_AIRPORT_DEFAULT_* 环境变量 */
  takeoffTarget?: { latitude: number; longitude: number; heightM?: number };
}): Promise<UavControlResult> {
  const res = await fetch("/api/uav-control/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  let json: UavControlResult | null = null;
  try {
    json = text ? (JSON.parse(text) as UavControlResult) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = json?.detail || json?.error || text.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (!json) throw new Error("uav_control_invalid_response");
  return json;
}

