/**
 * 对空/探鸟雷达数据采集 API（Custombackend /api/air-radar-collect）。
 */
import { getHttpConfig } from "@/lib/map-app-config";

function backendBase(): string {
  return getHttpConfig().backendUrl.replace(/\/$/, "");
}

export type AirRadarCollectParamsPayload = {
  collect_type: 0 | 1;
  azi_center: number;
  azi_range: number;
  dis_center: number;
  dis_range: number;
  target_type: number;
  track_type: number;
  track_id: number;
  start?: boolean;
};

export type AirRadarCollectApiResult =
  | { ok: true; message?: string; host?: string; port?: number }
  | { ok: false; message: string };

export type AirRadarCollectRemoteConfig = {
  configured: boolean;
  send_ip: string;
  send_port: number;
  radar_lat: number;
  radar_lon: number;
};

export async function fetchAirRadarCollectConfig(): Promise<AirRadarCollectRemoteConfig | null> {
  try {
    const res = await fetch(`${backendBase()}/api/air-radar-collect/config`, { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as Partial<AirRadarCollectRemoteConfig> & {
      ok?: boolean;
    };
    if (!res.ok) return null;
    return {
      configured: Boolean(data.configured),
      send_ip: String(data.send_ip ?? ""),
      send_port: Number(data.send_port ?? 0),
      radar_lat: Number(data.radar_lat ?? 37.54887),
      radar_lon: Number(data.radar_lon ?? 122.09432),
    };
  } catch {
    return null;
  }
}

export async function postAirRadarCollectParams(
  payload: AirRadarCollectParamsPayload,
): Promise<AirRadarCollectApiResult> {
  try {
    const res = await fetch(`${backendBase()}/api/air-radar-collect/params`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      host?: string;
      port?: number;
    };
    if (!res.ok || data.ok === false) {
      return { ok: false, message: data.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, host: data.host, port: data.port };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function postAirRadarCollectControl(
  startFlag: 0 | 1,
): Promise<AirRadarCollectApiResult> {
  try {
    const res = await fetch(`${backendBase()}/api/air-radar-collect/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_flag: startFlag }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    if (!res.ok || data.ok === false) {
      return { ok: false, message: data.message ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
