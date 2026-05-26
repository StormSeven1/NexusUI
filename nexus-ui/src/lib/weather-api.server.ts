/**
 * 顶栏气象 HTTP 上游（与 Qt `TopInfoPanel::slot_updateWeatherInfo` 在 `m_nUseBasePoint==0` 时一致：
 * `WEATHER_FMT` → `http://TaskServerIP:VaisalaWeatherPort/api/v1/weather/vaisala`）。
 *
 * 可通过 `NEXUS_WEATHER_API_URL` 覆盖完整地址；或 `NEXUS_TASK_SERVER_HOST` + `NEXUS_WEATHER_PORT` 拼装。
 */

export interface WeatherApiData {
  wind_speed_ms?: number;
  air_temp_c?: number;
  rainfall?: string;
  weather?: string;
}

export interface WeatherApiPayload {
  code: number;
  data?: WeatherApiData;
  message?: string;
}

function trimEnv(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

/** 解析气象上游 URL（仅服务端） */
export function resolveWeatherUpstreamUrl(): string {
  const explicit = trimEnv("NEXUS_WEATHER_API_URL");
  if (explicit) return explicit;

  const host =
    trimEnv("NEXUS_TASK_SERVER_HOST") ||
    trimEnv("TaskServerIP") ||
    "192.168.18.141";
  const port =
    trimEnv("NEXUS_WEATHER_PORT") ||
    trimEnv("VaisalaWeatherPort") ||
    "8090";
  const path =
    trimEnv("NEXUS_WEATHER_PATH") || "/api/v1/weather/vaisala";

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `http://${host}:${port}${normalizedPath}`;
}

export function normalizeWeatherDisplay(data: WeatherApiData | undefined): {
  weather: string;
  temperature: string;
  windSpeed: string;
  rainfall: string;
} {
  const windSpeedMs = data?.wind_speed_ms ?? 0;
  const airTempC = data?.air_temp_c ?? 0;
  const windSpeed = windSpeedMs.toFixed(1);
  const temperature = airTempC.toFixed(1);

  let rainfall = data?.rainfall?.trim() ?? "";
  if (!rainfall) rainfall = "无降水";

  let weather = data?.weather?.trim() ?? rainfall;
  if (!weather || weather === "无降水" || weather === "未知") {
    weather = "晴";
  }

  return { weather, temperature, windSpeed, rainfall };
}
