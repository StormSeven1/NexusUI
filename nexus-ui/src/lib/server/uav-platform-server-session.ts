/**
 * 私有云登录与会话缓存：供 `/api/uav-control/*`、`/api/uav-task/*` 等 Node 路由共用。
 */

export type LoginSession = {
  token: string;
  at: number;
  mqttBrokerUrl?: string;
  mqttUsername?: string;
  mqttPassword?: string;
};

let cachedSession: LoginSession | null = null;

const DEFAULT_TIMEOUT_MS = 15000;

/** 与 Config.ini UAV_TRACE_TASK 同源：`NEXUS_UAV_TASK_API_BASE_URL`（无尾斜杠） */
export function getUavTaskApiBase(): string | null {
  const b = process.env.NEXUS_UAV_TASK_API_BASE_URL?.trim();
  return b ? b.replace(/\/$/, "") : null;
}

/** `POST …/api/v1/tasks` 出站超时（毫秒）；默认 45s，`fetch failed` 多为网关不可达或过短超时 */
export function getUavTaskServiceFetchTimeoutMs(): number {
  const v = process.env.NEXUS_UAV_TASK_FETCH_TIMEOUT_MS?.trim();
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 3000 ? Math.trunc(n) : 45000;
}

function formatFetchFailureDetail(e: unknown, timeoutMs: number): string {
  const base = e instanceof Error ? e.message : String(e);
  let extra = "";
  if (e instanceof Error) {
    const any = e as Error & { cause?: unknown; code?: string };
    if (typeof any.code === "string" && any.code) extra += ` code=${any.code}`;
    if (any.cause != null) {
      const c = any.cause;
      if (c instanceof Error) {
        extra += ` cause=${c.message}`;
        const c2 = c as Error & { code?: string };
        if (typeof c2.code === "string") extra += `(${c2.code})`;
      } else {
        extra += ` cause=${String(c)}`;
      }
    }
  }
  const isAbort =
    base === "timeout" ||
    base.includes("abort") ||
    (e instanceof Error && e.name === "AbortError");
  const hint =
    isAbort ?
      `（超过 ${timeoutMs}ms）`
    : "（常为 Next 服务端连不上任务网关：Docker/防火墙/网段或未配置 `NEXUS_UAV_TASK_API_BASE_URL`，见环境变量文档）";
  return `${base}${extra}${hint}`;
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  stage: string,
): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } catch (e) {
    const detail = formatFetchFailureDetail(e, timeoutMs);
    throw new Error(`${stage}_timeout_or_fetch_error: ${detail}`);
  } finally {
    clearTimeout(timer);
  }
}

function pickStr(r: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function deriveNodeMqttBrokerUrl(mqttAddr: string): string | null {
  const raw = mqttAddr.trim();
  if (!raw) return null;
  if (/^mqtts?:\/\//i.test(raw)) return raw;
  if (/^wss?:\/\//i.test(raw)) return raw;
  const m = raw.match(/^(tcp|ssl|tls):\/\/([^:/]+)(?::(\d+))?/i);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const host = m[2];
  if (!host) return null;
  const preferSsl = scheme === "ssl" || scheme === "tls";
  const port = m[3] || (preferSsl ? "8883" : "1883");
  const proto = preferSsl ? "mqtts" : "mqtt";
  return `${proto}://${host}:${port}`;
}

export async function loginAndGetSession(base: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<LoginSession> {
  const now = Date.now();
  if (cachedSession && now - cachedSession.at < 25 * 60 * 1000 && cachedSession.token) {
    return cachedSession;
  }
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
    timeoutMs,
    "login",
  );
  const text = await loginRes.text().catch(() => "");
  if (!loginRes.ok) throw new Error(`login_failed_${loginRes.status}: ${text.slice(0, 200)}`);
  const j = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  const data = (j.data ?? {}) as Record<string, unknown>;
  const tk = typeof data.access_token === "string" ? data.access_token.trim() : "";
  if (!tk) throw new Error("login_no_access_token");
  const mqttAddr = pickStr(data, ["mqtt_addr", "mqttAddr", "mqtt_address"]);
  const derivedBroker = deriveNodeMqttBrokerUrl(mqttAddr);
  const mqttUsername = pickStr(data, ["mqtt_username", "mqttUsername"]);
  const mqttPassword = pickStr(data, ["mqtt_password", "mqttPassword"]);
  cachedSession = {
    token: tk,
    at: now,
    mqttBrokerUrl: derivedBroker || undefined,
    mqttUsername: mqttUsername || undefined,
    mqttPassword: mqttPassword || undefined,
  };
  return cachedSession;
}
