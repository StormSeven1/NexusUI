import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import mqttImport, { type IClientOptions, type MqttClient } from "mqtt";
import { getDronePlatformBaseUrl } from "@/lib/drone-platform-base-url";
import {
  fetchWithTimeout,
  getUavTaskApiBase,
  loginAndGetSession,
  type LoginSession,
} from "@/lib/server/uav-platform-server-session";

export const runtime = "nodejs";

type UavAction = "takeoff" | "stop" | "back" | "hotback" | "reconnect" | "emergency";

type ControlBody = {
  action?: unknown;
  airportSN?: unknown;
  deviceSN?: unknown;
  /** 与 WatchSys uavctrlboard::onUavTakeOff 一致：起飞 MQTT 体需要目标点与高度 */
  takeoffTarget?: {
    latitude?: unknown;
    longitude?: unknown;
    heightM?: unknown;
  };
};

const TIMEOUT_MS = 15000;

/** 与 uavctrlboard::sendCancelAllTasksRequest 请求体一致（POST m_struUrlConfig.UAV_TRACE_TASK） */
async function postCancelAllMetaTasks(
  token: string,
  airportSN: string,
): Promise<{ ok: boolean; status: number; body: string; url: string }> {
  const taskBase = getUavTaskApiBase();
  if (!taskBase) {
    return { ok: true, status: 0, body: "skipped_no_NEXUS_UAV_TASK_API_BASE_URL", url: "" };
  }
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  const taskId = `cancel_uav_all_tasks_${ts}`;
  const ownerEntityId = process.env.NEXUS_UAV_TASK_OWNER_ENTITY_ID?.trim() || "uav-001";
  const taskJson: Record<string, unknown> = {
    taskId,
    parentTaskId: "",
    version: { definitionVersion: 1, statusVersion: 1 },
    displayName: "取消无人机所有元任务",
    taskType: "MANUAL",
    maxExecutionTimeMs: 10000,
    specification: {
      "@type": "type.casia.tasks.v1.DroneFlightBack",
      deviceSn: airportSN,
    },
    createdBy: {
      system: {
        serviceName: "display_control_service",
        userId: "显控",
        managesOwnScheduling: true,
        priority: 5,
      },
    },
    owner: { entityId: ownerEntityId },
  };
  const url = `${taskBase}/api/v1/tasks`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-auth-token": token,
      },
      body: JSON.stringify(taskJson),
      cache: "no-store",
    },
    TIMEOUT_MS,
    "uav_cancel_meta_tasks",
  );
  const txt = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body: txt.slice(0, 800), url };
}

function resolveMqttConnect(): (url: string, opts?: IClientOptions) => MqttClient {
  const m = mqttImport as unknown as {
    connect?: (url: string, opts?: IClientOptions) => MqttClient;
    default?: { connect?: (url: string, opts?: IClientOptions) => MqttClient } | ((url: string, opts?: IClientOptions) => MqttClient);
  };
  if (typeof m.connect === "function") return m.connect;
  const d = m.default;
  if (d && typeof d === "object" && "connect" in d && typeof (d as { connect: unknown }).connect === "function") {
    return (d as { connect: (url: string, opts?: IClientOptions) => MqttClient }).connect;
  }
  if (typeof d === "function") return d as (url: string, opts?: IClientOptions) => MqttClient;
  throw new Error("mqtt_connect_unavailable");
}

function fillTemplate(tpl: string, airportSN: string, deviceSN: string): string {
  return tpl.replaceAll("{{airportSN}}", airportSN).replaceAll("{{deviceSN}}", deviceSN);
}

function envByAction(action: UavAction, suffix: "URL" | "METHOD" | "MQTT_TOPIC" | "MQTT_PAYLOAD"): string {
  const key = `NEXUS_UAV_CTRL_${action.toUpperCase()}_${suffix}`;
  return process.env[key]?.trim() ?? "";
}

function readEnvNumber(key: string): number | null {
  const v = process.env[key]?.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildTakeoffToPointPayload(lat: number, lon: number, heightM: number): string {
  const nTime = Date.now();
  const strip = (u: string) => u.replace(/-/g, "");
  const bid = strip(randomUUID());
  const tid = strip(randomUUID());
  const flightid = strip(randomUUID());
  const dHeight = Math.round(heightM * 10) / 10;
  const data = {
    flight_id: flightid,
    security_takeoff_height: dHeight - 17,
    target_latitude: Math.round(lat * 1e6) / 1e6,
    target_longitude: Math.round(lon * 1e6) / 1e6,
    target_height: dHeight,
    commander_flight_mode: 1,
    commander_flight_height: dHeight - 17,
    commander_mode_lost_action: 1,
    rth_mode: 1,
    rth_altitude: dHeight - 17,
    rc_lost_action: 2,
    max_speed: 15,
    flight_safety_advance_check: 0,
  };
  return JSON.stringify({
    method: "takeoff_to_point",
    timestamp: nTime,
    bid,
    tid,
    data,
  });
}

/** 与 api4third `debug_mode_open` / Qt uavctrlboard 热备一致，走 `thing/product/{sn}/services` */
function buildDebugModeMqttPayload(method: "debug_mode_open" | "debug_mode_close"): string {
  const nTime = Date.now();
  const strip = (u: string) => u.replace(/-/g, "");
  return JSON.stringify({
    method,
    timestamp: nTime,
    bid: strip(randomUUID()),
    tid: strip(randomUUID()),
    data: {},
  });
}

function parseTakeoffCoords(body: ControlBody): { lat: number; lon: number; heightM: number } | null {
  const defH = readEnvNumber("NEXUS_UAV_CTRL_TAKEOFF_DEFAULT_HEIGHT_M") ?? 120;
  const tt = body.takeoffTarget;
  if (tt && typeof tt === "object") {
    const lat = typeof tt.latitude === "number" ? tt.latitude : Number(tt.latitude);
    const lon = typeof tt.longitude === "number" ? tt.longitude : Number(tt.longitude);
    const hm =
      tt.heightM === undefined || tt.heightM === null
        ? defH
        : typeof tt.heightM === "number"
          ? tt.heightM
          : Number(tt.heightM);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(hm)) {
      return { lat, lon, heightM: hm };
    }
  }
  const dLat = readEnvNumber("NEXUS_UAV_CTRL_AIRPORT_DEFAULT_LAT");
  const dLon = readEnvNumber("NEXUS_UAV_CTRL_AIRPORT_DEFAULT_LON");
  if (dLat == null || dLon == null) return null;
  return { lat: dLat, lon: dLon, heightM: defH };
}

function resolveMqttTopicAndPayload(
  action: UavAction,
  airportSN: string,
  deviceSN: string,
  body: ControlBody,
): { topic: string; payload: string } | { skip: string } {
  const topicTpl = envByAction(action, "MQTT_TOPIC");
  if (!topicTpl) return { skip: "no_mqtt_topic_configured" };
  const topic = fillTemplate(topicTpl, airportSN, deviceSN);
  const payloadTpl = envByAction(action, "MQTT_PAYLOAD").trim();

  if (action === "emergency") {
    if (!payloadTpl || payloadTpl === "{}") {
      return { topic, payload: JSON.stringify({ method: "drone_emergency_stop", data: {} }) };
    }
    return { topic, payload: fillTemplate(payloadTpl, airportSN, deviceSN) };
  }

  if (action === "takeoff") {
    if (payloadTpl && payloadTpl !== "{}") {
      return { topic, payload: fillTemplate(payloadTpl, airportSN, deviceSN) };
    }
    const c = parseTakeoffCoords(body);
    if (!c) {
      return {
        skip:
          "takeoff_needs_takeoffTarget_or_NEXUS_UAV_CTRL_AIRPORT_DEFAULT_LAT/LON_and_TAKEOFF_DEFAULT_HEIGHT_M",
      };
    }
    return { topic, payload: buildTakeoffToPointPayload(c.lat, c.lon, c.heightM) };
  }

  if (action === "hotback") {
    if (payloadTpl && payloadTpl !== "{}") {
      return { topic, payload: fillTemplate(payloadTpl, airportSN, deviceSN) };
    }
    return { topic, payload: buildDebugModeMqttPayload("debug_mode_open") };
  }

  if (!payloadTpl) return { skip: "no_mqtt_payload_configured" };
  return { topic, payload: fillTemplate(payloadTpl, airportSN, deviceSN) };
}

/**
 * 与 WatchSys uavctrlboard.cpp 一致：JSON 字段名为 device_sn，取值用机场 gateway SN（airportSN）。
 * 参见 onBackFlightSlot / finishFlight 等：`backFlightObject["device_sn"] = this->airportSN`
 */
function defaultHttpPayload(action: UavAction, airportSN: string): Record<string, unknown> {
  switch (action) {
    case "hotback":
      return { device_sn: airportSN, method: "debug_mode_open" };
    default:
      return { device_sn: airportSN };
  }
}

/** 私有云 api4third 常 HTTP 200 但 JSON 内含 code≠0（如 MQTT 链路失败）；顶层 ok 不能与 fetch 完全一致 */
function bizOkFromDronePlatformBody(txt: string, httpOk: boolean): boolean {
  if (!httpOk) return false;
  try {
    const j = txt ? (JSON.parse(txt) as Record<string, unknown>) : {};
    if (typeof j.code === "number" && j.code !== 0) return false;
  } catch {
    // 非 JSON 时沿用 HTTP 状态
  }
  return httpOk;
}

async function callHttpControl(
  action: UavAction,
  base: string,
  token: string,
  airportSN: string,
  deviceSN: string,
): Promise<{ ok: boolean; status: number; body: string; url: string }> {
  const urlFromEnv = envByAction(action, "URL");
  if (!urlFromEnv) {
    /** WatchSys：大疆起飞/急停走 MQTT（thing/product/...），Qt 侧无对应 api4third HTTP 时勿判失败 */
    if (action === "takeoff" || action === "emergency") {
      return { ok: true, status: 0, body: "skip_http_watchsys_uses_mqtt", url: "" };
    }
    return { ok: false, status: 0, body: "missing_action_url_env", url: "" };
  }
  const method = (envByAction(action, "METHOD") || "POST").toUpperCase();
  const fullUrl = /^https?:\/\//i.test(urlFromEnv) ? fillTemplate(urlFromEnv, airportSN, deviceSN) : `${base}${fillTemplate(urlFromEnv, airportSN, deviceSN)}`;
  const payload = defaultHttpPayload(action, airportSN);
  const res = await fetchWithTimeout(
    fullUrl,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-auth-token": token,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    },
    TIMEOUT_MS,
    `uav_${action}_http`,
  );
  const txt = await res.text().catch(() => "");
  const ok = bizOkFromDronePlatformBody(txt, res.ok);
  return { ok, status: res.status, body: txt.slice(0, 800), url: fullUrl };
}

async function publishMqttControl(
  action: UavAction,
  airportSN: string,
  deviceSN: string,
  body: ControlBody,
  loginMqtt: Pick<LoginSession, "mqttBrokerUrl" | "mqttUsername" | "mqttPassword">,
): Promise<{ ok: boolean; detail: string }> {
  const brokerUrl =
    process.env.NEXUS_UAV_MQTT_BROKER_URL?.trim() || loginMqtt.mqttBrokerUrl?.trim() || "";
  if (!brokerUrl) {
    return {
      ok: false,
      detail: "missing_mqtt_broker_set_NEXUS_UAV_MQTT_BROKER_URL_or_ensure_login_returns_mqtt_addr",
    };
  }
  const resolved = resolveMqttTopicAndPayload(action, airportSN, deviceSN, body);
  if ("skip" in resolved) {
    return { ok: false, detail: resolved.skip };
  }
  const { topic, payload } = resolved;
  const connect = resolveMqttConnect();
  const username =
    process.env.NEXUS_UAV_MQTT_USERNAME?.trim() || loginMqtt.mqttUsername?.trim() || undefined;
  const password =
    process.env.NEXUS_UAV_MQTT_PASSWORD?.trim() || loginMqtt.mqttPassword?.trim() || undefined;
  const client = connect(brokerUrl, { username, password, reconnectPeriod: 0, connectTimeout: 10000 });
  await new Promise<void>((resolve, reject) => {
    const done = (err?: Error) => {
      try {
        client.end(true);
      } catch {
        // ignore
      }
      if (err) reject(err);
      else resolve();
    };
    client.once("error", (e) => done(e instanceof Error ? e : new Error(String(e))));
    client.once("connect", () => {
      client.publish(topic, payload, { qos: 1 }, (err) => {
        if (err) done(err);
        else done();
      });
    });
  });
  return { ok: true, detail: `published:${topic}` };
}

export async function POST(req: NextRequest) {
  let body: ControlBody;
  try {
    body = (await req.json()) as ControlBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? (body.action.trim() as UavAction) : ("" as UavAction);
  const airportSN = typeof body.airportSN === "string" ? body.airportSN.trim() : "";
  const deviceSN = typeof body.deviceSN === "string" ? body.deviceSN.trim() : "";
  if (!action || !["takeoff", "stop", "back", "hotback", "reconnect", "emergency"].includes(action)) {
    return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
  }
  if (!airportSN) {
    return NextResponse.json({ ok: false, error: "airportSN_required" }, { status: 400 });
  }

  const base = getDronePlatformBaseUrl();
  try {
    /** WatchSys uavctrlboard::onUavReconnect 仅 emit sig_onUavConnect，无远端 HTTP/MQTT；Web 端由画面逻辑处理流 */
    if (action === "reconnect") {
      return NextResponse.json(
        {
          ok: true,
          action,
          airportSN,
          deviceSN: deviceSN || undefined,
          viaHttp: {
            ok: true,
            status: 0,
            body: "watchsys_compat_no_remote_reconnect",
            url: "",
          },
          viaMqtt: { ok: false, detail: "skipped_reconnect_is_local_stream_hint" },
        },
        { status: 200 },
      );
    }

    const session = await loginAndGetSession(base);
    /** WatchSys uavctrlboard::onStopFlightSlot / onBackFlightSlot：先发 sendCancelAllTasksRequest，再发 api4third */
    let viaTaskCancel: { ok: boolean; status: number; body: string; url: string } | undefined;
    if (action === "stop" || action === "back") {
      viaTaskCancel = await postCancelAllMetaTasks(session.token, airportSN);
    }

    const httpRes = await callHttpControl(action, base, session.token, airportSN, deviceSN);
    const mqttRes = await publishMqttControl(action, airportSN, deviceSN, body, session).catch((e) => ({
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    }));

    const ok = httpRes.ok || mqttRes.ok;
    const status = ok ? 200 : 502;
    return NextResponse.json(
      {
        ok,
        action,
        airportSN,
        deviceSN: deviceSN || undefined,
        ...(viaTaskCancel ? { viaTaskCancel } : {}),
        viaHttp: httpRes,
        viaMqtt: mqttRes,
      },
      { status },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ok: false,
        error: "uav_control_exception",
        detail: msg,
        action,
        airportSN,
      },
      { status: 500 },
    );
  }
}

