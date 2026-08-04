"use client";

/**
 * Keycloak JS adapter (Authorization Code + PKCE).
 * Config comes from backend `/api/v1/auth/config` — never hardcode realm/url in FE env.
 */

import Keycloak from "keycloak-js";
import type { AuthPublicConfig } from "@/lib/auth/auth-config";
import { ensurePkceCryptoPolyfill } from "@/lib/auth/pkce-polyfill";

export type AuthUserInfo = {
  id?: string;
  username?: string;
  email?: string;
  name?: string;
};

let keycloak: Keycloak | null = null;
let initPromise: Promise<boolean> | null = null;
let authEnabled = false;

export function getKeycloak(): Keycloak | null {
  return keycloak;
}

export function getAccessToken(): string | undefined {
  if (!authEnabled || !keycloak?.authenticated) return undefined;
  return keycloak.token;
}

export function getAuthUser(): AuthUserInfo | null {
  if (!authEnabled || !keycloak?.authenticated) return null;
  const p = keycloak.tokenParsed as Record<string, unknown> | undefined;
  if (!p) return null;
  return {
    id: typeof p.sub === "string" ? p.sub : undefined,
    username:
      (typeof p.preferred_username === "string" && p.preferred_username) ||
      (typeof p.username === "string" ? p.username : undefined),
    email: typeof p.email === "string" ? p.email : undefined,
    name: typeof p.name === "string" ? p.name : undefined,
  };
}

export async function ensureFreshToken(minValiditySec = 30): Promise<string | undefined> {
  if (!authEnabled || !keycloak?.authenticated) return undefined;
  try {
    await keycloak.updateToken(minValiditySec);
  } catch {
    try {
      await keycloak.login();
    } catch {
      /* login redirect in progress */
    }
    return undefined;
  }
  return keycloak.token;
}

export async function logout(): Promise<void> {
  if (!keycloak) {
    window.location.reload();
    return;
  }
  await keycloak.logout({ redirectUri: window.location.origin + window.location.pathname });
}

/** Keycloak Account Console URL（修改密码 / 资料）。优先用 adapter，否则由公开配置拼接。 */
export function buildKeycloakAccountUrl(config?: AuthPublicConfig | null): string | undefined {
  try {
    const fromAdapter = keycloak?.createAccountUrl?.();
    if (fromAdapter) return fromAdapter;
  } catch {
    /* adapter may throw before init */
  }
  if (!config?.url || !config.realm) return undefined;
  return `${config.url.replace(/\/$/, "")}/realms/${encodeURIComponent(config.realm)}/account`;
}

/**
 * Initialize Keycloak when config.enabled.
 * Returns true if the user is authenticated (or auth is disabled).
 */
export async function initKeycloakAuth(config: AuthPublicConfig): Promise<boolean> {
  authEnabled = Boolean(config.enabled);
  if (!config.enabled) {
    return true;
  }
  if (!config.url || !config.realm || !config.clientId) {
    console.error("[auth] enabled but url/realm/clientId incomplete");
    return false;
  }

  if (initPromise) return initPromise;

  ensurePkceCryptoPolyfill();

  keycloak = new Keycloak({
    url: config.url,
    realm: config.realm,
    clientId: config.clientId,
  });

  initPromise = (async () => {
    try {
      const ok = await keycloak!.init({
        onLoad: "login-required",
        pkceMethod: "S256",
        checkLoginIframe: false,
        enableLogging: process.env.NODE_ENV === "development",
      });
      if (ok && keycloak) {
        keycloak.onTokenExpired = () => {
          void keycloak?.updateToken(30).catch(() => {
            void keycloak?.login();
          });
        };
      }
      return Boolean(ok);
    } catch (e) {
      console.error("[auth] Keycloak init failed:", e);
      return false;
    }
  })();

  return initPromise;
}
