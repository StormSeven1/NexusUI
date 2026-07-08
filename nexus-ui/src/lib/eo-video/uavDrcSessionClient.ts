"use client";

import type { UavKeyState } from "@/hooks/useUavKeyboardControl";

export type UavDrcSessionStatus = {
  ok: boolean;
  mqttConnected?: boolean;
  brokerUrl?: string | null;
  stickActive?: boolean;
  stickTickCount?: number;
  stickPublishOk?: number;
  stickPublishFail?: number;
  lastStickAt?: number | null;
  stickLastError?: string | null;
  heartBeatActive?: boolean;
  heartBeatTickCount?: number;
  heartBeatPublishOk?: number;
  heartBeatPublishFail?: number;
  lastHeartBeatAt?: number | null;
  detail?: string;
};

async function postDrcSession(body: Record<string, unknown>): Promise<UavDrcSessionStatus> {
  try {
    const res = await fetch("/api/uav-control/drc-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return (await res.json()) as UavDrcSessionStatus;
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export function startUavDrcHeartBeat(airportSN: string) {
  return postDrcSession({ action: "heartbeat_start", airportSN });
}

export function stopUavDrcHeartBeat(airportSN: string) {
  return postDrcSession({ action: "heartbeat_stop", airportSN });
}

export function updateUavStickSession(airportSN: string, keys: UavKeyState) {
  return postDrcSession({ action: "stick_update", airportSN, keys });
}

export function stopUavStickSession(airportSN: string) {
  return postDrcSession({ action: "stick_stop", airportSN });
}

export function fetchUavDrcSessionStatus(airportSN: string) {
  return postDrcSession({ action: "status", airportSN });
}

export function formatUavDrcDebugLine(
  status: UavDrcSessionStatus | null,
  extras?: { mqttRxConnected?: boolean; keys?: UavKeyState },
): string {
  if (!status) return "DRC会话 | 无状态";
  const parts = [
    "DRC会话(服务端1883)",
    `broker:${status.brokerUrl ?? "未配置"}`,
    `mqtt:${status.mqttConnected ? "连" : "断"}`,
    `心跳:${status.heartBeatActive ? "开" : "关"} ok=${status.heartBeatPublishOk ?? 0} fail=${status.heartBeatPublishFail ?? 0}`,
    `stick:${status.stickActive ? "开" : "关"} tick=${status.stickTickCount ?? 0} ok=${status.stickPublishOk ?? 0} fail=${status.stickPublishFail ?? 0}`,
  ];
  if (status.stickLastError) parts.push(`err:${status.stickLastError}`);
  if (extras?.mqttRxConnected != null) parts.push(`浏览器MQTT收:${extras.mqttRxConnected ? "是" : "否"}`);
  if (extras?.keys) {
    const pressed = (Object.entries(extras.keys) as [keyof UavKeyState, boolean][])
      .filter(([, v]) => v)
      .map(([k]) => k);
    parts.push(`按键:${pressed.length ? pressed.join("") : "无"}`);
  }
  return parts.join(" | ");
}
