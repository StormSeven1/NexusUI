/**
 * 无人机控制授权客户端
 * 对应 C++ UAV_CTRL_CONNECT → UAV_CTRL_ENTER / UAV_CTRL_EXIT 流程
 */

export interface DroneCtrlInfo {
  address: string;
  username: string;
  password: string;
  client_id: string;
  expire_time: string;
  enable_tls: string;
}

export interface UavAuthResult {
  ok: boolean;
  action: "connect" | "enter" | "exit";
  ctrlInfo?: DroneCtrlInfo;
  message?: string;
  detail?: string;
}

export async function postUavAuth(
  action: "connect" | "enter" | "exit",
  airportSN: string,
  clientId?: string,
): Promise<UavAuthResult> {
  try {
    const res = await fetch("/api/uav-control/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, airportSN, clientId }),
    });
    return (await res.json()) as UavAuthResult;
  } catch (e) {
    return {
      ok: false,
      action,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export interface StickControlParams {
  airportSN: string;
  roll: number;
  pitch: number;
  throttle: number;
  yaw: number;
  seq: number;
}

export interface StickControlResult {
  ok: boolean;
  airportSN: string;
  seq: number;
  detail?: string;
}

export async function postUavStickControl(params: StickControlParams): Promise<StickControlResult> {
  try {
    const res = await fetch("/api/uav-control/stick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return (await res.json()) as StickControlResult;
  } catch (e) {
    return {
      ok: false,
      airportSN: params.airportSN,
      seq: params.seq,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
