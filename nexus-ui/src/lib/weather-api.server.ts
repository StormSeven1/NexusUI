/**
 * 气象 HTTP / MQTT 上游（地址须从环境变量读取，无内置默认 URL）：
 * - Vaisala：`NEXUS_WEATHER_API_URL` 或 HOST+PORT+PATH
 * - 浮标：`NEXUS_BUOY_WEATHER_*`
 * - 无人机场降雨：MQTT `thing/product/{SN}/osd|state` 的 `data.rainfall`（0–3）
 *
 * 降雨优先级：Vaisala → 浮标 → 无人机场（前两者无降雨字段时才回退）。
 */

import type { MqttClient } from "mqtt";

export interface WeatherApiData {
  wind_speed_ms?: number;
  air_temp_c?: number;
  rainfall?: string | number;
  weather?: string;
}

export interface WeatherApiPayload {
  code: number;
  data?: WeatherApiData;
  message?: string;
}

export type RainfallSource = "vaisala" | "buoy" | "airport" | "none";

/** 与 Qt `rainfallCode` 一致 */
export const AIRPORT_RAINFALL_CODE = ["无降水", "小雨", "中雨", "大雨"] as const;

function trimEnv(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

function assembleHttpUrl(
  host: string | undefined,
  port: string | undefined,
  path: string | undefined,
  missingMsg: string,
): string {
  if (!host || !port || !path) {
    throw new Error(missingMsg);
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `http://${host}:${port}${normalizedPath}`;
}

/** 解析 Vaisala 顶栏气象上游 URL（仅服务端）；未配置时抛错 */
export function resolveWeatherUpstreamUrl(): string {
  const explicit = trimEnv("NEXUS_WEATHER_API_URL");
  if (explicit) return explicit;

  return assembleHttpUrl(
    trimEnv("NEXUS_TASK_SERVER_HOST") || trimEnv("TaskServerIP"),
    trimEnv("NEXUS_WEATHER_PORT") || trimEnv("VaisalaWeatherPort"),
    trimEnv("NEXUS_WEATHER_PATH"),
    "气象上游未配置：请设置 NEXUS_WEATHER_API_URL，或同时设置 NEXUS_TASK_SERVER_HOST、NEXUS_WEATHER_PORT、NEXUS_WEATHER_PATH",
  );
}

/** 解析浮标气象上游 URL（仅服务端）；未配置时抛错 */
export function resolveBuoyWeatherUpstreamUrl(): string {
  const explicit = trimEnv("NEXUS_BUOY_WEATHER_API_URL");
  if (explicit) return explicit;

  return assembleHttpUrl(
    trimEnv("NEXUS_BUOY_WEATHER_HOST") ||
      trimEnv("NEXUS_TASK_SERVER_HOST") ||
      trimEnv("TaskServerIP"),
    trimEnv("NEXUS_BUOY_WEATHER_PORT"),
    trimEnv("NEXUS_BUOY_WEATHER_PATH"),
    "浮标气象上游未配置：请设置 NEXUS_BUOY_WEATHER_API_URL，或同时设置 NEXUS_BUOY_WEATHER_HOST、NEXUS_BUOY_WEATHER_PORT、NEXUS_BUOY_WEATHER_PATH",
  );
}

/** 顶栏用机场 SN：逗号分隔；空则 MQTT 通配取首个带 rainfall 的机场 */
export function resolveWeatherAirportSns(): string[] {
  const raw = trimEnv("NEXUS_WEATHER_AIRPORT_SN") || "";
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Vaisala / 字符串降雨字段 → 展示文案；无字段返回 null（表示「没有」） */
export function pickVaisalaRainfallText(data: WeatherApiData | undefined): string | null {
  if (!data || data.rainfall === undefined || data.rainfall === null) return null;
  if (typeof data.rainfall === "number") {
    if (!Number.isFinite(data.rainfall)) return null;
    return data.rainfall <= 0 ? "无降水" : `${data.rainfall}`;
  }
  const s = String(data.rainfall).trim();
  return s || null;
}

/** 浮标 `meteorology.rainfall`（mm）；无字段返回 null */
export function pickBuoyRainfallText(root: unknown): string | null {
  if (root == null || typeof root !== "object" || Array.isArray(root)) return null;
  const data = (root as { data?: unknown }).data;
  if (data == null || typeof data !== "object" || Array.isArray(data)) return null;
  const met = (data as { meteorology?: unknown }).meteorology;
  if (met == null || typeof met !== "object" || Array.isArray(met)) return null;
  if (!("rainfall" in (met as object))) return null;
  const mm = asFiniteNumber((met as { rainfall?: unknown }).rainfall);
  if (mm === null) return null;
  return mm <= 0 ? "无降水" : `${mm}mm`;
}

export function formatAirportRainfallCode(code: number): string | null {
  if (!Number.isInteger(code) || code < 0 || code > 3) return null;
  return AIRPORT_RAINFALL_CODE[code];
}

export type AirportWeatherMqttSample = {
  topic: string;
  sn: string;
  rainfallCode: number;
  windSpeedMps: number | null;
  environmentTempC: number | null;
};

function parseAirportMqttData(buf: Buffer): {
  rainfallCode: number | null;
  windSpeedMps: number | null;
  environmentTempC: number | null;
} {
  try {
    const j = JSON.parse(buf.toString("utf8")) as unknown;
    if (j == null || typeof j !== "object" || Array.isArray(j)) {
      return { rainfallCode: null, windSpeedMps: null, environmentTempC: null };
    }
    const o = j as Record<string, unknown>;
    const data =
      o.data != null && typeof o.data === "object" && !Array.isArray(o.data)
        ? (o.data as Record<string, unknown>)
        : o;
    const rawCode = asFiniteNumber(data.rainfall);
    let rainfallCode: number | null = null;
    if (rawCode !== null) {
      const trunc = Math.trunc(rawCode);
      if (trunc >= 0 && trunc <= 3) rainfallCode = trunc;
    }
    return {
      rainfallCode,
      windSpeedMps: asFiniteNumber(data.wind_speed),
      environmentTempC: asFiniteNumber(data.environment_temperature),
    };
  } catch {
    return { rainfallCode: null, windSpeedMps: null, environmentTempC: null };
  }
}

function snFromProductTopic(topic: string): string {
  const m = topic.match(/thing\/product\/([^/]+)\//i);
  return m?.[1] ?? "";
}

/**
 * 短连接 MQTT，取一帧机场气象（含 rainfall 0–3）。
 * `NEXUS_WEATHER_AIRPORT_SN` 未配时订阅 `thing/product/+/osd`。
 */
export async function fetchAirportWeatherSample(opts?: {
  timeoutMs?: number;
}): Promise<AirportWeatherMqttSample | null> {
  const brokerUrl = trimEnv("NEXUS_UAV_MQTT_BROKER_URL");
  if (!brokerUrl) return null;

  const timeoutMs = opts?.timeoutMs ?? 5000;
  const sns = resolveWeatherAirportSns();
  const topics =
    sns.length > 0
      ? sns.flatMap((sn) => [
          `thing/product/${sn}/osd`,
          `thing/product/${sn}/state`,
        ])
      : ["thing/product/+/osd"];

  let client: MqttClient | null = null;
  try {
    const mqtt = await import("mqtt");
    client = mqtt.connect(brokerUrl, {
      protocolVersion: 4,
      reconnectPeriod: 0,
      connectTimeout: Math.min(timeoutMs, 8000),
      clean: true,
      clientId: `nexus-weather-rain-${Math.random().toString(16).slice(2, 10)}`,
      username: trimEnv("NEXUS_UAV_MQTT_USERNAME"),
      password: trimEnv("NEXUS_UAV_MQTT_PASSWORD"),
    });

    return await new Promise<AirportWeatherMqttSample | null>((resolve) => {
      let settled = false;
      const finish = (v: AirportWeatherMqttSample | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          client?.end(true);
        } catch {
          /* ignore */
        }
        resolve(v);
      };

      const timer = setTimeout(() => finish(null), timeoutMs);

      client!.on("connect", () => {
        for (const topic of topics) {
          client!.subscribe(topic, { qos: 0 });
        }
      });

      client!.on("message", (topic, buf) => {
        const parsed = parseAirportMqttData(buf);
        if (parsed.rainfallCode === null) return;
        // 通配时优先机巢 SN（7CT…），跳过机体无降雨枚举的报文
        if (sns.length === 0 && !/\/product\/7CT[^/]+\//i.test(topic)) return;
        finish({
          topic,
          sn: snFromProductTopic(topic),
          rainfallCode: parsed.rainfallCode,
          windSpeedMps: parsed.windSpeedMps,
          environmentTempC: parsed.environmentTempC,
        });
      });

      client!.on("error", () => finish(null));
    });
  } catch {
    try {
      client?.end(true);
    } catch {
      /* ignore */
    }
    return null;
  }
}

/** @deprecated 用 fetchAirportWeatherSample */
export async function fetchAirportRainfallCode(opts?: {
  timeoutMs?: number;
}): Promise<{ code: number; topic: string } | null> {
  const s = await fetchAirportWeatherSample(opts);
  if (!s) return null;
  return { code: s.rainfallCode, topic: s.topic };
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * 降雨文案：Vaisala → 浮标 → 无人机场 MQTT。
 * 「没有」指字段缺失/拉取失败；数值 0（无雨）算有数据，不再回退。
 */
export async function resolveRainfallWithFallback(vaisalaData: WeatherApiData | undefined): Promise<{
  rainfall: string;
  rainfallSource: RainfallSource;
  airportTopic?: string;
}> {
  const fromVaisala = pickVaisalaRainfallText(vaisalaData);
  if (fromVaisala != null) {
    return { rainfall: fromVaisala, rainfallSource: "vaisala" };
  }

  try {
    const buoyUrl = resolveBuoyWeatherUpstreamUrl();
    const buoyJson = await fetchJson(buoyUrl);
    const fromBuoy = pickBuoyRainfallText(buoyJson);
    if (fromBuoy != null) {
      return { rainfall: fromBuoy, rainfallSource: "buoy" };
    }
  } catch {
    /* 浮标未配置或失败 → 机场 */
  }

  const airport = await fetchAirportWeatherSample();
  if (airport) {
    const text = formatAirportRainfallCode(airport.rainfallCode);
    if (text) {
      return {
        rainfall: text,
        rainfallSource: "airport",
        airportTopic: airport.topic,
      };
    }
  }

  return { rainfall: "无降水", rainfallSource: "none" };
}

export type WeatherSourceId = "vaisala" | "buoy" | "airport";

export type WeatherSourceField = { label: string; value: string };

export type WeatherSourceCard = {
  id: WeatherSourceId;
  title: string;
  ok: boolean;
  error?: string;
  hint?: string;
  fields: WeatherSourceField[];
};

function fmtNum(n: number | null | undefined, digits = 1, unit = ""): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}${unit}`;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v != null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function summarizeVaisala(
  payload: WeatherApiPayload | null,
  url: string,
  err?: string,
): WeatherSourceCard {
  if (err || !payload || payload.code !== 0 || !payload.data) {
    return {
      id: "vaisala",
      title: "气象站 · Vaisala",
      ok: false,
      error: err || payload?.message || "无数据",
      hint: url,
      fields: [],
    };
  }
  const d = payload.data;
  const rain = pickVaisalaRainfallText(d);
  const fields: WeatherSourceField[] = [
    { label: "气温", value: fmtNum(asFiniteNumber(d.air_temp_c), 1, " ℃") },
    { label: "风速", value: fmtNum(asFiniteNumber(d.wind_speed_ms), 1, " m/s") },
  ];
  const dir = asFiniteNumber((d as { wind_dir_deg?: unknown }).wind_dir_deg);
  if (dir != null) fields.push({ label: "风向", value: fmtNum(dir, 0, "°") });
  const p = asFiniteNumber((d as { pressure_hpa?: unknown }).pressure_hpa);
  if (p != null) fields.push({ label: "气压", value: fmtNum(p, 1, " hPa") });
  const rh = asFiniteNumber((d as { rel_humidity_pct?: unknown }).rel_humidity_pct);
  if (rh != null) fields.push({ label: "湿度", value: fmtNum(rh, 0, "%") });
  fields.push({ label: "降雨", value: rain ?? "—" });
  return {
    id: "vaisala",
    title: "气象站 · Vaisala",
    ok: true,
    hint: url,
    fields,
  };
}

function summarizeBuoy(raw: unknown, url: string, err?: string): WeatherSourceCard {
  if (err) {
    return {
      id: "buoy",
      title: "浮标气象",
      ok: false,
      error: err,
      hint: url,
      fields: [],
    };
  }
  const root = asRecord(raw);
  const data = asRecord(root?.data);
  if (!root || root.code !== 0 || !data) {
    return {
      id: "buoy",
      title: "浮标气象",
      ok: false,
      error: typeof root?.message === "string" ? root.message : "无数据",
      hint: url,
      fields: [],
    };
  }
  const wind = asRecord(data.wind);
  const met = asRecord(data.meteorology);
  const hydro = asRecord(data.hydrology);
  const wave = asRecord(data.wave);
  const rainTxt = pickBuoyRainfallText(raw);
  const fields: WeatherSourceField[] = [
    {
      label: "站名",
      value: typeof data.stationName === "string" ? data.stationName : "—",
    },
    { label: "风速(均)", value: fmtNum(asFiniteNumber(wind?.avgSpeed), 1, " m/s") },
    { label: "风速(最大)", value: fmtNum(asFiniteNumber(wind?.maxSpeed), 1, " m/s") },
    { label: "气压", value: fmtNum(asFiniteNumber(met?.pressure), 1, " hPa") },
    { label: "相对湿度", value: fmtNum(asFiniteNumber(met?.relativeHumidity), 0, "%") },
    { label: "降雨", value: rainTxt ?? "—" },
    { label: "水温", value: fmtNum(asFiniteNumber(hydro?.waterTemperature), 1, " ℃") },
    { label: "波高(均)", value: fmtNum(asFiniteNumber(wave?.averageHeight), 2, " m") },
  ];
  const updated =
    typeof data.updateTime === "string"
      ? data.updateTime
      : typeof root.updated_at === "string"
        ? root.updated_at
        : undefined;
  return {
    id: "buoy",
    title: "浮标气象",
    ok: true,
    hint: updated ? `更新 ${updated}` : url,
    fields,
  };
}

function summarizeAirport(
  sample: AirportWeatherMqttSample | null,
  err?: string,
): WeatherSourceCard {
  if (err || !sample) {
    return {
      id: "airport",
      title: "无人机场",
      ok: false,
      error: err || "MQTT 暂无降雨数据",
      hint: "thing/product/{SN}/osd",
      fields: [],
    };
  }
  const rain = formatAirportRainfallCode(sample.rainfallCode) ?? "—";
  return {
    id: "airport",
    title: "无人机场",
    ok: true,
    hint: sample.sn || sample.topic,
    fields: [
      { label: "降雨", value: rain },
      { label: "风速", value: fmtNum(sample.windSpeedMps, 1, " m/s") },
      { label: "环境温度", value: fmtNum(sample.environmentTempC, 1, " ℃") },
      { label: "机场 SN", value: sample.sn || "—" },
    ],
  };
}

/** 一次拉取三路气象摘要 + 顶栏展示字段（避免重复请求） */
export async function collectWeatherBundle(): Promise<{
  ok: boolean;
  error?: string;
  upstreamUrl?: string;
  weather: string;
  temperature: string;
  windSpeed: string;
  rainfall: string;
  rainfallSource: RainfallSource;
  airportTopic?: string;
  sources: WeatherSourceCard[];
  fetchedAt: string;
}> {
  const fetchedAt = new Date().toISOString();
  let vaisalaUrl = "";
  try {
    vaisalaUrl = resolveWeatherUpstreamUrl();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: msg,
      weather: "—",
      temperature: "—",
      windSpeed: "—",
      rainfall: "无降水",
      rainfallSource: "none",
      sources: [
        summarizeVaisala(null, "", msg),
        summarizeBuoy(null, "", "未请求"),
        summarizeAirport(null, "未请求"),
      ],
      fetchedAt,
    };
  }

  const [vaisalaRaw, buoySettled, airportSettled] = await Promise.all([
    fetchJson(vaisalaUrl),
    (async (): Promise<{ url: string; raw: unknown | null; err?: string }> => {
      try {
        const url = resolveBuoyWeatherUpstreamUrl();
        const raw = await fetchJson(url);
        return { url, raw, err: raw == null ? "请求失败" : undefined };
      } catch (e) {
        return {
          url: "",
          raw: null,
          err: e instanceof Error ? e.message : String(e),
        };
      }
    })(),
    fetchAirportWeatherSample({ timeoutMs: 5000 }).then(
      (sample) => ({ sample, err: sample ? undefined : "超时或无报文" }),
      (e: unknown) => ({
        sample: null as AirportWeatherMqttSample | null,
        err: e instanceof Error ? e.message : String(e),
      }),
    ),
  ]);

  const vaisalaPayload =
    vaisalaRaw != null && typeof vaisalaRaw === "object"
      ? (vaisalaRaw as WeatherApiPayload)
      : null;
  const vaisalaOk = Boolean(vaisalaPayload && vaisalaPayload.code === 0 && vaisalaPayload.data);

  let rainfall = "无降水";
  let rainfallSource: RainfallSource = "none";
  let airportTopic: string | undefined;

  const vRain = pickVaisalaRainfallText(vaisalaPayload?.data);
  if (vRain != null) {
    rainfall = vRain;
    rainfallSource = "vaisala";
  } else {
    const bRain = pickBuoyRainfallText(buoySettled.raw);
    if (bRain != null) {
      rainfall = bRain;
      rainfallSource = "buoy";
    } else if (airportSettled.sample) {
      const t = formatAirportRainfallCode(airportSettled.sample.rainfallCode);
      if (t) {
        rainfall = t;
        rainfallSource = "airport";
        airportTopic = airportSettled.sample.topic;
      }
    }
  }

  const display = normalizeWeatherDisplay(
    vaisalaOk ? vaisalaPayload!.data : undefined,
    rainfall,
  );

  return {
    ok: vaisalaOk,
    error: vaisalaOk ? undefined : "Vaisala 上游不可用",
    upstreamUrl: vaisalaUrl,
    ...display,
    rainfallSource,
    airportTopic,
    sources: [
      summarizeVaisala(
        vaisalaPayload,
        vaisalaUrl,
        vaisalaOk ? undefined : vaisalaPayload?.message || "请求失败",
      ),
      summarizeBuoy(buoySettled.raw, buoySettled.url, buoySettled.err),
      summarizeAirport(airportSettled.sample, airportSettled.err),
    ],
    fetchedAt,
  };
}

export function normalizeWeatherDisplay(
  data: WeatherApiData | undefined,
  rainfallOverride?: string,
): {
  weather: string;
  temperature: string;
  windSpeed: string;
  rainfall: string;
} {
  const windSpeedMs = data?.wind_speed_ms ?? 0;
  const airTempC = data?.air_temp_c ?? 0;
  const windSpeed = windSpeedMs.toFixed(1);
  const temperature = airTempC.toFixed(1);

  let rainfall =
    rainfallOverride?.trim() ||
    pickVaisalaRainfallText(data) ||
    "无降水";

  let weather = data?.weather?.trim() ?? rainfall;
  if (!weather || weather === "无降水" || weather === "未知") {
    weather = "晴";
  } else if (
    rainfall !== "无降水" &&
    rainfall !== "未知" &&
    (!data?.weather?.trim() || data.weather.trim() === "无降水")
  ) {
    weather = rainfall;
  }

  return { weather, temperature, windSpeed, rainfall };
}
