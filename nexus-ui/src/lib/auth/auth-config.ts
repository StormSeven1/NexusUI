/** Public auth config from Custombackend `GET /api/v1/auth/config`. */

export type AuthPublicConfig = {
  enabled: boolean;
  url: string;
  realm: string;
  clientId: string;
};

const DISABLED: AuthPublicConfig = {
  enabled: false,
  url: "",
  realm: "",
  clientId: "",
};

let cached: AuthPublicConfig | null = null;

export function getCachedAuthConfig(): AuthPublicConfig | null {
  return cached;
}

export function isAuthEnabled(): boolean {
  return Boolean(cached?.enabled);
}

/**
 * Resolve backend base for auth config.
 * Prefers app-config `http.backendUrl`; falls back to same-origin.
 */
export async function resolveBackendBaseForAuth(): Promise<string> {
  try {
    const { loadResolvedAppConfig, getHttpConfig } = await import("@/lib/map-app-config");
    await loadResolvedAppConfig();
    const base = getHttpConfig().backendUrl?.replace(/\/$/, "") ?? "";
    if (base) return base;
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export async function fetchAuthConfig(force = false): Promise<AuthPublicConfig> {
  if (!force && cached) return cached;

  const base = await resolveBackendBaseForAuth();
  if (!base) {
    cached = DISABLED;
    return cached;
  }

  try {
    const res = await fetch(`${base}/api/v1/auth/config`, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn("[auth] config HTTP", res.status);
      cached = DISABLED;
      return cached;
    }
    const data = (await res.json()) as Partial<AuthPublicConfig>;
    cached = {
      enabled: Boolean(data.enabled),
      url: String(data.url ?? "").replace(/\/$/, ""),
      realm: String(data.realm ?? ""),
      clientId: String(data.clientId ?? ""),
    };
    return cached;
  } catch (e) {
    console.warn("[auth] config fetch failed, treating as disabled:", e);
    cached = DISABLED;
    return cached;
  }
}
