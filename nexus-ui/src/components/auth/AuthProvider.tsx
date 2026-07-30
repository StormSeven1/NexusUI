"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchAuthConfig,
  resolveBackendBaseForAuth,
  type AuthPublicConfig,
} from "@/lib/auth/auth-config";
import {
  getAuthUser,
  initKeycloakAuth,
  logout as keycloakLogout,
  type AuthUserInfo,
} from "@/lib/auth/keycloak-client";
import { installAuthFetch, setAuthFetchBackendBase } from "@/lib/auth/auth-fetch";

type AuthContextValue = {
  ready: boolean;
  enabled: boolean;
  user: AuthUserInfo | null;
  config: AuthPublicConfig | null;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  ready: false,
  enabled: false,
  user: null,
  config: null,
  logout: async () => undefined,
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [user, setUser] = useState<AuthUserInfo | null>(null);
  const [config, setConfig] = useState<AuthPublicConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const base = await resolveBackendBaseForAuth();
        setAuthFetchBackendBase(base);
        const cfg = await fetchAuthConfig();
        if (cancelled) return;
        setConfig(cfg);
        setEnabled(cfg.enabled);

        const ok = await initKeycloakAuth(cfg);
        if (cancelled) return;
        if (!ok && cfg.enabled) {
          setError("登录失败，请刷新重试");
          setReady(true);
          return;
        }
        installAuthFetch();
        setUser(getAuthUser());
        setReady(true);
      } catch (e) {
        if (cancelled) return;
        console.error("[auth] bootstrap failed:", e);
        setError(e instanceof Error ? e.message : "鉴权初始化失败");
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    await keycloakLogout();
  }, []);

  const value = useMemo(
    () => ({ ready, enabled, user, config, logout }),
    [ready, enabled, user, config, logout],
  );

  if (!ready) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-nexus-bg-base text-nexus-text-secondary">
        <p className="text-sm tracking-wide">正在加载认证配置…</p>
      </div>
    );
  }

  if (error && enabled) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-nexus-bg-base text-nexus-text-primary">
        <p className="text-sm text-red-400">{error}</p>
        <button
          type="button"
          className="rounded border border-nexus-border px-3 py-1.5 text-xs hover:bg-white/10"
          onClick={() => window.location.reload()}
        >
          刷新
        </button>
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
