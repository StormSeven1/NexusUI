import { create } from "zustand";
import { loadResolvedAppConfig, type ResolvedAppConfig } from "@/lib/map-app-config";

type AppConfigLoadStatus = "idle" | "loading" | "ready" | "error";

interface AppConfigState {
  status: AppConfigLoadStatus;
  config: ResolvedAppConfig | null;
  error: string | null;
  /** 全局配置加载 Promise（单飞），避免多处重复触发 fetch/parse */
  inflight: Promise<ResolvedAppConfig> | null;
  ensureLoaded: () => Promise<ResolvedAppConfig>;
}

/**
 * app-config 单一加载入口：
 * - 其它模块不再直接各自 await `loadResolvedAppConfig()`
 * - 统一经本 store 触发并缓存状态，便于后续订阅/监控
 */
export const useAppConfigStore = create<AppConfigState>((set, get) => ({
  status: "idle",
  config: null,
  error: null,
  inflight: null,
  ensureLoaded: async () => {
    const ready = get().config;
    if (ready) return ready;
    const running = get().inflight;
    if (running) return running;

    set({ status: "loading", error: null });
    const p = loadResolvedAppConfig()
      .then((cfg) => {
        set({ status: "ready", config: cfg, error: null, inflight: null });
        return cfg;
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : "loadResolvedAppConfig failed";
        set({ status: "error", error: message, inflight: null });
        throw e;
      });
    set({ inflight: p });
    return p;
  },
}));
