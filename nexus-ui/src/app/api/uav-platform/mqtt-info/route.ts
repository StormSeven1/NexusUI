import { NextResponse } from "next/server";
import { resolveDronePlatformBase } from "@/lib/drone-platform-base-url";

const LOGIN_TIMEOUT_MS = 15000;

function pickStr(r: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** 与 WatchSys 一致：登录 data.mqtt_addr 多为 tcp://host:1883；浏览器 mqtt.js 需 ws/wss */
function deriveBrowserMqttWsUrl(tcpOrSslAddr: string): string | null {
  const raw = tcpOrSslAddr.trim();
  if (!raw) return null;
  if (/^wss?:\/\//i.test(raw)) return raw;
  const m = raw.match(/^(tcp|ssl|tls):\/\/([^:/]+)(?::(\d+))?/i);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const host = m[2];
  if (!host) return null;
  const preferSsl = scheme === "ssl" || scheme === "tls";
  const wsPort = process.env.NEXUS_UAV_MQTT_WS_PORT?.trim() || "8083";
  const pathRaw = process.env.NEXUS_UAV_MQTT_WS_PATH?.trim() || "/mqtt";
  const path = pathRaw.startsWith("/") ? pathRaw : `/${pathRaw}`;
  const proto = preferSsl ? "wss" : "ws";
  return `${proto}://${host}:${wsPort}${path}`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, stage: string): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${stage}_timeout_or_fetch_error: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

async function loginAndGetData(base: string): Promise<Record<string, unknown>> {
  const username = process.env.NEXUS_DRONE_PLATFORM_USERNAME ?? "adminPC";
  const password = process.env.NEXUS_DRONE_PLATFORM_PASSWORD ?? "adminPC";
  const loginRes = await fetchWithTimeout(
    `${base}/manage/api/v1/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username, password, flag: 1 }),
      cache: "no-store",
    },
    LOGIN_TIMEOUT_MS,
    "login",
  );
  const loginText = await loginRes.text().catch(() => "");
  if (!loginRes.ok) {
    throw new Error(`login ${loginRes.status}: ${loginText.slice(0, 300)}`);
  }
  const loginJson = loginText ? (JSON.parse(loginText) as Record<string, unknown>) : {};
  const data = (loginJson.data ?? {}) as Record<string, unknown>;
  const token = typeof data.access_token === "string" ? data.access_token.trim() : "";
  if (!token) {
    throw new Error(`login no access_token: ${loginText.slice(0, 300)}`);
  }
  return data;
}

/**
 * 从私有云登录结果读取 MQTT，并给出浏览器 WebSocket 地址（EoVideoPanel 未配置 NEXT_PUBLIC_MQTT_WS_URL 时用）。
 */
export async function GET() {
  const { base, source } = resolveDronePlatformBase();
  try {
    const data = await loginAndGetData(base);
    const wsDirect = pickStr(data, [
      "mqtt_ws_addr",
      "mqtt_ws_url",
      "mqttWsAddr",
      "mqtt_ws",
      "ws_mqtt_addr",
      "mqttAddressWs",
    ]);
    const mqttAddr = pickStr(data, ["mqtt_addr", "mqttAddr", "mqtt_address"]);
    const mqttUsername = pickStr(data, ["mqtt_username", "mqttUsername"]);
    const mqttPassword = pickStr(data, ["mqtt_password", "mqttPassword"]);

    const wsUrl = wsDirect || deriveBrowserMqttWsUrl(mqttAddr);
    if (!wsUrl) {
      return NextResponse.json({
        ok: false,
        error: "no_mqtt_ws_or_tcp_addr",
        platformBase: base,
        platformBaseSource: source,
        rawMqttAddr: mqttAddr || null,
      });
    }
    return NextResponse.json({
      ok: true,
      wsUrl,
      wsSource: wsDirect ? "login_ws_field" : "derived_from_tcp",
      rawMqttAddr: mqttAddr || null,
      mqttUsername: mqttUsername || undefined,
      mqttPassword: mqttPassword || undefined,
      platformBase: base,
      platformBaseSource: source,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ok: false,
        error: "mqtt_info_exception",
        detail: msg,
        platformBase: base,
        platformBaseSource: source,
      },
      { status: 500 },
    );
  }
}
