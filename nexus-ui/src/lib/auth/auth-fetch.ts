"use client";

/**
 * Patch `window.fetch` to attach `Authorization: Bearer <access_token>`
 * for same-origin `/api` and Custombackend `http.backendUrl` requests.
 * Skips Keycloak IdP calls and when AUTH_ENABLED=false.
 */

import { getCachedAuthConfig, isAuthEnabled } from "@/lib/auth/auth-config";
import { ensureFreshToken, getAccessToken } from "@/lib/auth/keycloak-client";

let installed = false;
let backendBase = "";

export function setAuthFetchBackendBase(url: string): void {
  backendBase = (url || "").replace(/\/$/, "");
}

function shouldAttachAuth(url: string): boolean {
  if (!isAuthEnabled()) return false;
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.origin : undefined);
    const cfg = getCachedAuthConfig();
    if (cfg?.url) {
      const idp = new URL(cfg.url);
      if (u.origin === idp.origin) return false;
    }
    if (typeof window !== "undefined" && u.origin === window.location.origin) {
      return u.pathname.startsWith("/api");
    }
    if (backendBase) {
      const b = new URL(backendBase);
      if (u.origin === b.origin) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function installAuthFetch(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (!shouldAttachAuth(url)) {
      return original(input, init);
    }

    await ensureFreshToken(30);
    const token = getAccessToken();
    if (!token) {
      return original(input, init);
    }

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    if (input instanceof Request) {
      const req = new Request(input, { headers, ...init });
      return original(req);
    }
    return original(input, { ...init, headers });
  };
}

/** Append `?token=` for WebSocket / EventSource (cannot set Authorization header). */
export function appendAccessTokenToUrl(url: string): string {
  if (!isAuthEnabled()) return url;
  const token = getAccessToken();
  if (!token) return url;
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.href : undefined);
    if (!u.searchParams.has("token") && !u.searchParams.has("access_token")) {
      u.searchParams.set("token", token);
    }
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}token=${encodeURIComponent(token)}`;
  }
}
