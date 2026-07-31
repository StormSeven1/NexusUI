"use client";

export type UavControlAction =
  | "takeoff"
  | "stop"
  | "back"
  | "hotback"
  | "hotback_close"
  | "reconnect"
  | "emergency";

export type UavControlResult = {
  ok: boolean;
  action: UavControlAction;
  /** WatchSys sendCancelAllTasksRequest：POST {UavServer}/api/v1/tasks */
  viaTaskCancel?: { ok: boolean; status: number; body: string; url: string };
  viaHttp?: { ok: boolean; status: number; body: string; url: string; method?: string };
  viaMqtt?: { ok: boolean; detail: string };
  /** 热备第二步：drone_open（对齐 Qt setUavOpen） */
  viaHttpDroneOpen?: { ok: boolean; status: number; body: string; url: string; method?: string };
  viaMqttDroneOpen?: { ok: boolean; detail: string };
  hotbackSteps?: { debugModeOpen: boolean; droneOpen: boolean; droneOpenDelayMs: number };
  error?: string;
  detail?: string;
};

/** 任一路径成功即视为指令已生效（返航/停止常仅任务通道 DroneFlightBack 成功） */
export function isUavControlEffectivelyOk(ret: UavControlResult): boolean {
  if (ret.ok) return true;
  /** 热备须 debug_mode_open + drone_open；仅第一步成功不算完整热备 */
  if (ret.action === "hotback") {
    if (ret.hotbackSteps) {
      return ret.hotbackSteps.debugModeOpen && ret.hotbackSteps.droneOpen;
    }
    return Boolean(ret.viaHttpDroneOpen?.ok || ret.viaMqttDroneOpen?.ok);
  }
  if (ret.viaTaskCancel?.ok) return true;
  if (ret.viaHttp?.ok) return true;
  if (ret.viaMqtt?.ok) return true;
  return false;
}

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
    if (json && isUavControlEffectivelyOk(json)) return json;
    const msg = json?.detail || json?.error || text.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (!json) throw new Error("uav_control_invalid_response");
  return json;
}

