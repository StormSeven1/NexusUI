import { create } from "zustand";
import type { Track } from "@/lib/map-entity-model";
import { resolveTrackLayerKey } from "@/lib/track-layer-visibility";
import { resolveUniqueIdFromTrack } from "@/lib/alarm-confirm-api";

export type TrackHistoryDomain = "sea" | "air";

export type TrackHistoryPoint = { lng: number; lat: number };

export const TRACK_HISTORY_MAX_MINUTES = 120;
const DEFAULT_MINUTES = 30;

export type TrackHistoryEntry = {
  uniqueId: string;
  /** 对应 Track.id / showID，用于航迹消失时清理 */
  trackShowId: string;
  domain: TrackHistoryDomain;
  /** 显示时长（分钟） */
  minutes: number;
  maxMinutes: number;
  points: TrackHistoryPoint[];
  alwaysShow: boolean;
  panelOpen: boolean;
  loading: boolean;
  error: string | null;
  /** 面板锚点（右键客户端坐标） */
  anchorX: number;
  anchorY: number;
  /** 上次成功拉取时间戳 */
  fetchedAtMs: number;
};

type OpenArgs = {
  track: Track;
  clientX: number;
  clientY: number;
};

interface TrackHistoryState {
  /** 当前打开的面板 uniqueId；关闭面板时可为 null，常显条目仍留在 byUniqueId */
  activeUniqueId: string | null;
  byUniqueId: Record<string, TrackHistoryEntry>;
  /** 地图图层刷新计数 */
  mapRev: number;
  openForTrack: (args: OpenArgs) => void;
  closePanel: () => void;
  setAlwaysShow: (uniqueId: string, alwaysShow: boolean) => void;
  setMinutes: (uniqueId: string, minutes: number) => void;
  /** 左键点到常显航迹 / 定时器 → 热更新点位 */
  refreshEntry: (uniqueId: string, opts?: { silent?: boolean }) => void;
  /** 刷新所有常显条目 */
  refreshAlwaysShowEntries: () => void;
  /** 航迹从 store 消失时移除对应历史叠加（含常显） */
  pruneMissingTracks: (aliveShowIds: ReadonlySet<string>) => void;
  removeEntry: (uniqueId: string) => void;
}

const minutesDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** 进行中的请求，避免常显轮询叠请求 */
const inflightByUid = new Map<string, Promise<void>>();

/** 常显热更新间隔 */
export const TRACK_HISTORY_ALWAYS_SHOW_POLL_MS = 15_000;

function apiBase(): string {
  return process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
}

export function resolveHistoryDomain(track: Track): TrackHistoryDomain | null {
  const lk = resolveTrackLayerKey(track);
  if (lk === "fuse_air") return "air";
  if (lk === "fuse_sea") return "sea";
  if (track.isAirTrack === true || track.type === "air") return "air";
  if (track.type === "sea") return "sea";
  return null;
}

export function isTrackEligibleForHistory(track: Track): boolean {
  const lk = resolveTrackLayerKey(track);
  return lk === "fuse_sea" || lk === "fuse_air";
}

async function fetchHistoryPoints(
  uniqueId: string,
  domain: TrackHistoryDomain,
  minutes: number,
): Promise<{ points: TrackHistoryPoint[]; maxMinutes: number }> {
  const url =
    `${apiBase()}/api/track-history` +
    `?uniqueId=${encodeURIComponent(uniqueId)}` +
    `&domain=${encodeURIComponent(domain)}` +
    `&minutes=${encodeURIComponent(String(minutes))}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = (await res.json()) as {
    ok?: boolean;
    message?: string;
    points?: TrackHistoryPoint[];
    maxMinutes?: number;
  };
  if (!res.ok || data.ok === false) {
    throw new Error(data.message || `历史航迹查询失败 (${res.status})`);
  }
  return {
    points: Array.isArray(data.points) ? data.points : [],
    maxMinutes:
      typeof data.maxMinutes === "number" && data.maxMinutes >= 1
        ? Math.min(TRACK_HISTORY_MAX_MINUTES, data.maxMinutes)
        : TRACK_HISTORY_MAX_MINUTES,
  };
}

let fetchSeq = 0;

function runFetch(
  uniqueId: string,
  domain: TrackHistoryDomain,
  minutes: number,
  opts: { silent?: boolean; expectMinutes?: number },
  get: () => TrackHistoryState,
  set: (
    partial:
      | Partial<TrackHistoryState>
      | ((s: TrackHistoryState) => Partial<TrackHistoryState>),
  ) => void,
): Promise<void> {
  const existing = inflightByUid.get(uniqueId);
  if (existing) return existing;

  const seq = ++fetchSeq;
  const p = fetchHistoryPoints(uniqueId, domain, minutes)
    .then(({ points, maxMinutes }) => {
      const latest = get().byUniqueId[uniqueId];
      if (!latest) return;
      if (opts.expectMinutes != null && latest.minutes !== opts.expectMinutes) return;
      if (seq !== fetchSeq && opts.expectMinutes != null && latest.minutes !== opts.expectMinutes) {
        return;
      }
      set({
        byUniqueId: {
          ...get().byUniqueId,
          [uniqueId]: {
            ...latest,
            points,
            maxMinutes,
            minutes: Math.min(latest.minutes, maxMinutes),
            loading: false,
            error: null,
            fetchedAtMs: Date.now(),
          },
        },
        mapRev: get().mapRev + 1,
      });
    })
    .catch((e: unknown) => {
      if (opts.silent) return;
      const latest = get().byUniqueId[uniqueId];
      if (!latest) return;
      set({
        byUniqueId: {
          ...get().byUniqueId,
          [uniqueId]: {
            ...latest,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          },
        },
        mapRev: get().mapRev + 1,
      });
    })
    .finally(() => {
      inflightByUid.delete(uniqueId);
    });

  inflightByUid.set(uniqueId, p);
  return p;
}

export const useTrackHistoryStore = create<TrackHistoryState>((set, get) => ({
  activeUniqueId: null,
  byUniqueId: {},
  mapRev: 0,

  openForTrack: ({ track, clientX, clientY }) => {
    const uidNum = resolveUniqueIdFromTrack(track);
    if (uidNum == null) return;
    const uniqueId = String(uidNum);
    const domain = resolveHistoryDomain(track);
    if (!domain) return;

    const prev = get().byUniqueId[uniqueId];
    const minutes = prev?.minutes ?? Math.min(DEFAULT_MINUTES, prev?.maxMinutes ?? DEFAULT_MINUTES);
    const entry: TrackHistoryEntry = {
      uniqueId,
      trackShowId: String(track.id || track.showID || uniqueId),
      domain,
      minutes,
      maxMinutes: prev?.maxMinutes ?? TRACK_HISTORY_MAX_MINUTES,
      points: prev?.points ?? [],
      alwaysShow: prev?.alwaysShow ?? false,
      panelOpen: true,
      loading: true,
      error: null,
      anchorX: clientX,
      anchorY: clientY,
      fetchedAtMs: prev?.fetchedAtMs ?? 0,
    };

    set({
      activeUniqueId: uniqueId,
      byUniqueId: { ...get().byUniqueId, [uniqueId]: entry },
      mapRev: get().mapRev + 1,
    });

    void runFetch(uniqueId, domain, minutes, { expectMinutes: minutes }, get, set);
  },

  closePanel: () => {
    const id = get().activeUniqueId;
    if (!id) return;
    const cur = get().byUniqueId[id];
    if (!cur) {
      set({ activeUniqueId: null });
      return;
    }
    if (cur.alwaysShow) {
      set({
        activeUniqueId: null,
        byUniqueId: {
          ...get().byUniqueId,
          [id]: { ...cur, panelOpen: false },
        },
      });
      return;
    }
    const next = { ...get().byUniqueId };
    delete next[id];
    set({ activeUniqueId: null, byUniqueId: next, mapRev: get().mapRev + 1 });
  },

  setAlwaysShow: (uniqueId, alwaysShow) => {
    const cur = get().byUniqueId[uniqueId];
    if (!cur) return;
    set({
      byUniqueId: {
        ...get().byUniqueId,
        [uniqueId]: { ...cur, alwaysShow },
      },
    });
    if (alwaysShow) {
      void runFetch(uniqueId, cur.domain, cur.minutes, { silent: false }, get, set);
    }
  },

  setMinutes: (uniqueId, minutes) => {
    const cur = get().byUniqueId[uniqueId];
    if (!cur) return;
    const clamped = Math.min(cur.maxMinutes, Math.max(1, Math.floor(minutes)));
    if (clamped === cur.minutes && !cur.loading) return;

    set({
      byUniqueId: {
        ...get().byUniqueId,
        [uniqueId]: { ...cur, minutes: clamped, loading: true, error: null },
      },
    });

    const prevTimer = minutesDebounceTimers.get(uniqueId);
    if (prevTimer) clearTimeout(prevTimer);

    const { domain } = cur;
    minutesDebounceTimers.set(
      uniqueId,
      setTimeout(() => {
        minutesDebounceTimers.delete(uniqueId);
        void runFetch(uniqueId, domain, clamped, { expectMinutes: clamped }, get, set);
      }, 280),
    );
  },

  refreshEntry: (uniqueId, opts) => {
    const cur = get().byUniqueId[uniqueId];
    if (!cur) return;
    if (!opts?.silent) {
      set({
        byUniqueId: {
          ...get().byUniqueId,
          [uniqueId]: { ...cur, loading: true, error: null },
        },
      });
    }
    void runFetch(uniqueId, cur.domain, cur.minutes, { silent: opts?.silent === true }, get, set);
  },

  refreshAlwaysShowEntries: () => {
    const all = Object.values(get().byUniqueId);
    for (const e of all) {
      if (!e.alwaysShow) continue;
      void runFetch(e.uniqueId, e.domain, e.minutes, { silent: true }, get, set);
    }
  },

  pruneMissingTracks: (aliveShowIds) => {
    const prev = get().byUniqueId;
    const keys = Object.keys(prev);
    if (!keys.length) return;
    let changed = false;
    const next: Record<string, TrackHistoryEntry> = {};
    for (const k of keys) {
      const e = prev[k];
      if (aliveShowIds.has(e.trackShowId) || aliveShowIds.has(e.uniqueId)) {
        next[k] = e;
      } else {
        changed = true;
      }
    }
    if (!changed) return;
    const active = get().activeUniqueId;
    set({
      byUniqueId: next,
      activeUniqueId: active && next[active] ? active : null,
      mapRev: get().mapRev + 1,
    });
  },

  removeEntry: (uniqueId) => {
    const next = { ...get().byUniqueId };
    if (!(uniqueId in next)) return;
    delete next[uniqueId];
    const active = get().activeUniqueId;
    set({
      byUniqueId: next,
      activeUniqueId: active === uniqueId ? null : active,
      mapRev: get().mapRev + 1,
    });
  },
}));
