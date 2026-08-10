/**
 * 服务端拉取 8090 实体列表（与 Custombackend `NEXUS_ENTITIES_*` 同键）。
 * 18.36 等现场 entity_mgr 开 Keycloak 时，BFF 必须带 Bearer，否则图层面板/快照会 401 空转。
 */

const DEFAULT_LIST_URL = "http://192.168.18.141:8090/api/v1/entities?page=1&size=100";

type TokenCache = {
  token: string;
  expiresAtMs: number;
};

let tokenCache: TokenCache | null = null;

function envTruthy(name: string, fallback = "false"): boolean {
  const v = (process.env[name] ?? fallback).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function resolveNexusEntitiesListUrl(override?: string | null): string {
  const raw = (override?.trim() || process.env.NEXUS_ENTITIES_LIST_URL?.trim() || DEFAULT_LIST_URL).trim();
  return raw;
}

/** 8090 实体服务鉴权：静态 token 或 Keycloak password grant（与列表轮询同键）。 */
export async function fetchNexusEntitiesAccessToken(): Promise<string | null> {
  const staticTok = (process.env.NEXUS_ENTITIES_BEARER_TOKEN ?? "").trim();
  if (staticTok) return staticTok;

  if (!envTruthy("NEXUS_ENTITIES_AUTH_ENABLED")) return null;

  const now = Date.now();
  if (tokenCache && now < tokenCache.expiresAtMs - 30_000) {
    return tokenCache.token;
  }

  const kcUrl = (
    process.env.NEXUS_ENTITIES_KEYCLOAK_URL?.trim() ||
    process.env.KEYCLOAK_URL?.trim() ||
    ""
  ).replace(/\/$/, "");
  const realm = (
    process.env.NEXUS_ENTITIES_KEYCLOAK_REALM?.trim() ||
    process.env.KEYCLOAK_REALM?.trim() ||
    "airia"
  ).trim();
  const clientId = (
    process.env.NEXUS_ENTITIES_KEYCLOAK_CLIENT_ID?.trim() ||
    "entity_management"
  ).trim();
  const username = (process.env.NEXUS_ENTITIES_KEYCLOAK_USERNAME ?? "").trim();
  const password = process.env.NEXUS_ENTITIES_KEYCLOAK_PASSWORD ?? "";
  if (!kcUrl || !username || !password) return null;

  const body = new URLSearchParams({
    grant_type: "password",
    client_id: clientId,
    username,
    password,
  });
  const res = await fetch(`${kcUrl}/realms/${realm}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    tokenCache = null;
    return null;
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  const token = (json.access_token ?? "").trim();
  if (!token) {
    tokenCache = null;
    return null;
  }
  const expiresInSec = Number(json.expires_in) || 300;
  tokenCache = { token, expiresAtMs: now + Math.max(60, expiresInSec) * 1000 };
  return token;
}

export type NexusEntitiesFetchResult = {
  listUrl: string;
  ok: boolean;
  status: number;
  text: string;
  payload: unknown | null;
};

async function requestEntitiesUrl(
  listUrl: string,
  timeoutMs: number,
): Promise<{ res: Response; bearer: string | null }> {
  const doFetch = async (bearer: string | null) => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    return fetch(listUrl, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  };

  let bearer = await fetchNexusEntitiesAccessToken();
  let res = await doFetch(bearer);
  if (res.status === 401 && envTruthy("NEXUS_ENTITIES_AUTH_ENABLED")) {
    tokenCache = null;
    bearer = await fetchNexusEntitiesAccessToken();
    if (bearer) res = await doFetch(bearer);
  }
  return { res, bearer };
}

/** 供 publishEntity / DELETE entities 等写接口附加 `Authorization`。 */
export async function nexusEntitiesAuthHeaders(
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const bearer = await fetchNexusEntitiesAccessToken();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return headers;
}

export function invalidateNexusEntitiesAccessToken(): void {
  tokenCache = null;
}

/** GET 实体列表；按需附加 Bearer；401 时刷新 token 再试一次。 */
export async function fetchNexusEntitiesList(options?: {
  listUrl?: string | null;
  timeoutMs?: number;
}): Promise<NexusEntitiesFetchResult> {
  const listUrl = resolveNexusEntitiesListUrl(options?.listUrl);
  const timeoutMs = options?.timeoutMs ?? 8_000;
  const { res } = await requestEntitiesUrl(listUrl, timeoutMs);
  const text = await res.text();
  let payload: unknown | null = null;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    payload = null;
  }
  return { listUrl, ok: res.ok, status: res.status, text, payload };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 分页拉全量 records（合并 `data.records`）。
 * 返回与单页 API 同形的 payload（`data.pages=1`, `records=merged`）。
 */
export async function fetchNexusEntitiesListAllPages(options?: {
  listUrl?: string | null;
  timeoutMs?: number;
}): Promise<NexusEntitiesFetchResult> {
  const first = await fetchNexusEntitiesList(options);
  if (!first.ok || first.payload == null) return first;

  const data = isRecord(first.payload) ? first.payload.data : null;
  const pages = isRecord(data) && typeof data.pages === "number" ? data.pages : 1;
  const records0 = isRecord(data) && Array.isArray(data.records) ? data.records : [];
  if (pages <= 1) return first;

  const merged = [...records0];
  const base = new URL(first.listUrl);
  for (let page = 2; page <= pages; page += 1) {
    base.searchParams.set("page", String(page));
    const next = await fetchNexusEntitiesList({
      listUrl: base.toString(),
      timeoutMs: options?.timeoutMs,
    });
    if (!next.ok || next.payload == null) continue;
    const section = isRecord(next.payload) ? next.payload.data : null;
    const recs = isRecord(section) && Array.isArray(section.records) ? section.records : [];
    merged.push(...recs);
  }

  const payload = {
    ...(isRecord(first.payload) ? first.payload : {}),
    data: {
      ...(isRecord(data) ? data : {}),
      records: merged,
      total: merged.length,
      current: 1,
      pages: 1,
    },
  };
  return {
    listUrl: first.listUrl,
    ok: true,
    status: 200,
    text: JSON.stringify(payload),
    payload,
  };
}
