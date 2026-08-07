/**
 * Next.js BFF → Custombackend：解析基址，并转发浏览器带来的 Authorization。
 * AUTH_ENABLED 时 Custombackend 校验 Bearer；浏览器 auth-fetch 已挂到 /api，
 * 但 Route Handler 若不显式转发，上游会 401「Missing or invalid Authorization Bearer token」。
 */

import type { NextRequest } from "next/server";

export function resolveCustombackendBase(): string {
  const fromEnv = process.env.BACKEND_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const port = process.env.BACKEND_PORT?.trim() || "27003";
  const host =
    process.env.NEXUS_BACKEND_HOST?.trim() ||
    process.env.APP_CONFIG_LAN_HOST?.trim() ||
    "192.168.18.141";
  return `http://${host}:${port}`;
}

/** 合并额外头，并透传客户端 `Authorization`（若有）。 */
export function custombackendProxyHeaders(
  req: NextRequest | Request,
  extra?: HeadersInit,
): Headers {
  const headers = new Headers(extra);
  const auth = req.headers.get("authorization");
  if (auth && !headers.has("Authorization")) {
    headers.set("Authorization", auth);
  }
  return headers;
}
