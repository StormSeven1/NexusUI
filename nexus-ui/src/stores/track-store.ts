/**
 * track-store — 航迹「两层互斥缓存 + 告警匹配渲染」
 *
 * 【两层互斥缓存】
 * - `_renderCache`（渲染层）：模块级 Map，只存匹配告警的航迹（含 historyTrail）
 * - `shadowTracks`（影子层）：Map<showID, Track>，存不匹配告警的航迹（含 historyTrail）
 * - 一条航迹只存在于其中一层，提升时从影子删除，降级时写入影子
 *
 * 【告警匹配】
 * - WS 航迹到达后直接判断是否匹配告警
 * - 在渲染层 → 就地更新坐标，就地累积 historyTrail，不动影子
 * - 不在渲染层且匹配 → 提升到渲染层，从影子移除
 * - 不匹配 → 只存影子（并持续累积 historyTrail，供地图画尾迹）
 *
 * 【处置过滤】
 * - setTracks 入口检查 disposedStore，已处置航迹直接跳过
 *
 * 【性能】
 * - 影子层就地更新（不被 React 订阅，无需 immutable）
 * - 渲染缓存用模块级 Map（避免每次 new Map 从数组重建）
 * - historyTrail 累积直接基于 _renderCache，省掉外部 getState().tracks + new Map
 * - 对外 `tracks` = 渲染层 + 影子层合并（地图/列表显示全部航迹）
 * - 仅「当前图层面板不可见」的影子层更新时不重建 `tracks`、不通知订阅（避免雷达等洪峰刷对海融合）
 * - 图层显隐变更时调用 `rebuildDisplayTracksFromCaches` 把影子补回列表
 */

import { create } from "zustand";
import type { Track } from "@/lib/map-entity-model";
import type { ForceDisposition } from "@/lib/theme-colors";
import { refreshAlarmTrackMapDebugSnapshot } from "@/lib/alarm-track-map-debug";
import { isTrackMatchedByAlarmKeys } from "@/lib/alarm-track-match";
import { maxStoredTrailPointsPerTrack, mergeIncomingTrackWithStickyAirClassification } from "@/lib/ws-track-normalize";
import { getTrackRenderingConfig, getTrackStaleTimeoutMs } from "@/lib/map-app-config";
import { shouldResetHistoryTrailOnStep } from "@/lib/track-display-trail";
import { isTrackVisibleBySubtype } from "@/lib/track-layer-visibility";
import { markTrackPhase } from "@/lib/track-perf";
import { useDisposedStore } from "@/stores/disposed-store";
import { useTrackDisplayStore } from "@/stores/track-display-store";

/** 地图右键设置的演练方 / 判定：用于覆盖默认敌我着色逻辑 */
export type ManualTrackAffiliation = "unknown" | "red" | "blue" | "white";

/**
 * 【模式配置】
 * - trackIdMode.distinguishSeaAir 从 app-config.json 读
 *   - false = 18.141 模式：告警 trackId 匹配航迹 trackId
 *   - true  = 28.9 模式：对海用 uniqueID（=showID），对空用 trackId
 */

/** 模块级渲染缓存 — 避免每次调用从 tracks 数组重建 Map */
const _renderCache = new Map<string, Track>();

/** 仅不可见影子层有更新时置位；图层显隐变化时需重建 `tracks` */
let _shadowOnlyDirty = false;

/**
 * 每条航迹最近一次被 WS 摄入（`setTracks`）的墙上时钟，用于超时剔除。
 * 与 `Track.lastUpdate`（常为观测时刻）解耦，避免 DDS 时间戳与前端时钟不一致时误判；
 * 亦避免将来 `lastUpdate` 改为纯观测时间后，剔除逻辑误用旧观测时刻。
 */
const _lastIngestMsByShowId = new Map<string, number>();

/**
 * HIGH 告警态势蓝粘滞（与 alert-store `ALARM_STALE_MS` 同量级）。
 * 分片空窗 / 渲染层短暂降级时仍保持蓝，避免约 1s 蓝↔白闪。
 */
const ALARM_BLUE_STICKY_MS = 60_000;
const _alarmBlueUntilByShowId = new Map<string, number>();

/** 刷新某航迹的告警蓝粘滞截止时间 */
export function touchAlarmBlueSticky(showID: string, now = Date.now()): void {
  const id = String(showID ?? "").trim();
  if (!id) return;
  _alarmBlueUntilByShowId.set(id, now + ALARM_BLUE_STICKY_MS);
}

/** 清除粘滞（全部或指定 showID） */
export function clearAlarmBlueSticky(showID?: string): void {
  if (showID == null || String(showID).trim() === "") {
    _alarmBlueUntilByShowId.clear();
    return;
  }
  _alarmBlueUntilByShowId.delete(String(showID).trim());
}

/** 粘滞期内视为仍应染告警蓝 */
export function isAlarmBlueSticky(showID: string, now = Date.now()): boolean {
  const id = String(showID ?? "").trim();
  if (!id) return false;
  const until = _alarmBlueUntilByShowId.get(id);
  if (until == null) return false;
  if (until <= now) {
    _alarmBlueUntilByShowId.delete(id);
    return false;
  }
  return true;
}

/** 导出 renderCache 只读访问（供 image polling 等外部模块用） */
export function getRenderCache(): ReadonlyMap<string, Track> {
  return _renderCache;
}

/**
 * 是否与当前有效告警关联并在渲染层（`_renderCache`）。
 * 与影子层互斥：在本层表示当前 HIGH 告警集合匹配，业务上与「告警目标」一致。
 */
export function isTrackAlarmLinked(track: Track): boolean {
  return _renderCache.has(track.showID);
}

/**
 * 地图 / 列表 / 标牌用敌我：告警渲染层或 HIGH 蓝粘滞期内显示为敌方；其余中立。
 * 纯可疑标记会被告警入口过滤，不进入渲染层；地图黄标见 resolveTrackMapHighlightFill。
 */
export function getEffectiveTrackDisposition(track: Track): ForceDisposition {
  if (isTrackAlarmLinked(track) || isAlarmBlueSticky(track.showID)) return "hostile";
  return "neutral";
}

/**
 * 地图符号 / 列表展示用敌我：优先用户右键「设置敌我属性」，否则同 {@link getEffectiveTrackDisposition}。
 * - 红方 → 友方配色；蓝方 → 敌方配色；不明 / 白方 → 中立配色。
 */
export function getTrackDispositionForRendering(track: Track): ForceDisposition {
  const manual = useTrackStore.getState().manualAffiliationByShowId[track.showID];
  if (manual === "red") return "friendly";
  if (manual === "blue") return "hostile";
  if (manual === "unknown" || manual === "white") return "neutral";
  return getEffectiveTrackDisposition(track);
}

/** 地图/订阅用：告警匹配航迹（含 historyTrail）+ 影子层单点，互斥无重复 */
function buildDisplayTracks(shadow: Map<string, Track>): Track[] {
  return [..._renderCache.values(), ...shadow.values()];
}

interface TrackState {
  /** 全部航迹（渲染层 ∪ 影子层），供地图与 UI 订阅 */
  tracks: Track[];
  connected: boolean;
  lastUpdate: string | null;

  /** 影子缓存：不匹配告警的航迹（Map<showID, Track>，含 historyTrail） */
  shadowTracks: Map<string, Track>;

  /**
   * 接收 WS 归一化后的航迹列表，就地更新两层缓存。
   * `historyTrail` 由本方法按位移追加（不经 `ws-track-normalize` 预合并）。
   * @param options.lastUpdate 若给出，与 tracks 同一 `set`，避免 `setTracks`+`setLastUpdate` 触发两次订阅。
   */
  setTracks: (incoming: Track[], options?: { lastUpdate?: string | null }) => void;
  setConnected: (v: boolean) => void;
  setLastUpdate: (ts: string) => void;
  /**
   * 告警集合变化后调用：重算 tracks（提升/降级）。
   * @param alarmTrackIds 当前告警 trackId 集合
   * @returns true 表示 tracks 发生变化
   */
  syncWithAlarms: (alarmTrackIds: Set<string>) => boolean;
  /**
   * 超时清理：移除渲染层与影子层中「超过 trackTimeout 未再收到 WS 更新」的航迹
   * （以 `lastIngest` 为准；无记录时回退 `Track.lastUpdate`）。
   */
  pruneStaleTracks: () => boolean;
  /**
   * 更新指定航迹的查证图片（供 image polling 调用）。
   * @returns true 表示图片有变化并已触发渲染更新
   */
  updateTrackImage: (showID: string, imageUrl: string | null) => boolean;
  /**
   * 右键手动设置对海目标类型：写入手动字段 + classifiedType/targetType，并刷新军标。
   */
  applyManualSeaTargetType: (
    showID: string,
    targetType: "ship" | "buoy" | "other",
    classifiedType: number,
  ) => boolean;
  clearAllTracks: () => void;
  /**
   * 图层显隐变化时：若此前跳过了不可见影子层的 `tracks` 重建，则补建一次。
   */
  rebuildDisplayTracksFromCaches: () => void;

  /** showID → 右键手动属性 */
  manualAffiliationByShowId: Record<string, ManualTrackAffiliation>;
  /** 递增以使航迹图层指纹失效并重绘 */
  mapManualAffiliationRev: number;
  setManualTrackAffiliation: (showID: string, v: ManualTrackAffiliation) => void;
  /** 删除告警等场景：清除右键手动敌我属性，恢复默认着色 */
  clearManualTrackAffiliation: (showID: string) => void;
}

export const useTrackStore = create<TrackState>((set, get) => ({
  tracks: [],
  connected: false,
  lastUpdate: null,
  shadowTracks: new Map<string, Track>(),
  manualAffiliationByShowId: {},
  mapManualAffiliationRev: 0,

  setManualTrackAffiliation: (showID, v) => {
    const id = String(showID ?? "").trim();
    if (!id) return;
    set((s) => ({
      manualAffiliationByShowId: { ...s.manualAffiliationByShowId, [id]: v },
      mapManualAffiliationRev: s.mapManualAffiliationRev + 1,
    }));
  },

  clearManualTrackAffiliation: (showID) => {
    const id = String(showID ?? "").trim();
    if (!id) return;
    set((s) => {
      if (!(id in s.manualAffiliationByShowId)) return s;
      const next = { ...s.manualAffiliationByShowId };
      delete next[id];
      return {
        manualAffiliationByShowId: next,
        mapManualAffiliationRev: s.mapManualAffiliationRev + 1,
      };
    });
  },

  setTracks: (incoming, options) => {
    markTrackPhase("store.setTracks", `in=${incoming.length},cache=${_renderCache.size},shadow=${get().shadowTracks.size}`);
    const alarmTrackIds = getCurrentAlarmTrackIds();
    const disposedStore = useDisposedStore.getState();
    // 影子不被 React 订阅，就地更新即可
    const shadow = get().shadowTracks;
    const trailCap = maxStoredTrailPointsPerTrack();
    let needsRenderUpdate = false;
    let shadowMutated = false;

    for (const raw of incoming) {
      const prev = _renderCache.get(raw.showID) ?? shadow.get(raw.showID);
      const t = mergeIncomingTrackWithStickyAirClassification(raw, prev);
      // 已处置航迹跳过
      if (disposedStore.isTrackDisposed(t.showID)) continue;

      const prevIngestMs = _lastIngestMsByShowId.get(t.showID);
      _lastIngestMsByShowId.set(t.showID, Date.now());

      const inRender = _renderCache.get(t.showID);
      const inShadow = shadow.get(t.showID);
      const holder = inRender ?? inShadow;
      /** 就地追加尾迹，避免每次 WS 点都 `[...trail]` 全量复制；同步维护 `historyTrailAtMs` 供按秒裁剪 */
      let historyTrail = holder?.historyTrail;
      let historyTrailAtMs = holder?.historyTrailAtMs;
      const moved = holder ? (holder.lat !== t.lat || holder.lng !== t.lng) : false;
      if (moved && holder) {
        if (shouldResetHistoryTrailOnStep(holder.lng, holder.lat, t.lng, t.lat, t.speed)) {
          historyTrail = [];
          historyTrailAtMs = [];
        } else {
          if (!historyTrail) historyTrail = [];
          if (!historyTrailAtMs || historyTrailAtMs.length !== historyTrail.length) {
            historyTrailAtMs = new Array(historyTrail.length).fill(prevIngestMs ?? Date.now());
          }
          historyTrail.push([holder.lng, holder.lat] as [number, number]);
          historyTrailAtMs.push(prevIngestMs ?? Date.now());
          if (historyTrail.length > trailCap) {
            const drop = historyTrail.length - trailCap;
            historyTrail.splice(0, drop);
            historyTrailAtMs.splice(0, drop);
          }
        }
      }
      const nextTrack =
        historyTrail?.length
          ? { ...t, historyTrail, historyTrailAtMs: historyTrailAtMs?.length ? historyTrailAtMs : undefined }
          : { ...t };

      const matched = isTrackMatchedByAlarm(t, alarmTrackIds, shadow);
      if (matched) touchAlarmBlueSticky(t.showID);
      const keepAlarmBlue = matched || isAlarmBlueSticky(t.showID);

      if (inRender) {
        // 已在渲染层 → 更新坐标并累积 historyTrail，不动影子
        if (keepAlarmBlue) touchAlarmBlueSticky(t.showID);
        _renderCache.set(t.showID, nextTrack);
        needsRenderUpdate = true;
      } else if (keepAlarmBlue) {
        // 匹配告警，或粘滞期内：留在/提升到渲染层，避免分片空窗蓝白闪
        touchAlarmBlueSticky(t.showID);
        _renderCache.set(t.showID, nextTrack);
        if (shadow.delete(t.showID)) shadowMutated = true;
        needsRenderUpdate = true;
      } else {
        // 不匹配 → 只存影子（保留 historyTrail，供尾迹显示）
        shadow.set(t.showID, nextTrack);
        shadowMutated = true;
      }
    }

    if (needsRenderUpdate || shadowMutated) {
      // 仅不可见图层的影子更新：影子 Map 已就地写好，跳过重建 tracks[]，避免雷达洪峰刷地图/列表
      if (!needsRenderUpdate && shadowMutated) {
        const td = useTrackDisplayStore.getState();
        const anyVisibleIncoming = incoming.some((t) =>
          isTrackVisibleBySubtype(t, td.trackSubtypeVisible, td.airFusionSubtypeVisible),
        );
        if (!anyVisibleIncoming) {
          _shadowOnlyDirty = true;
          if (options?.lastUpdate !== undefined) set({ lastUpdate: options.lastUpdate });
          return;
        }
      }
      _shadowOnlyDirty = false;
      const partial: Partial<TrackState> = { tracks: buildDisplayTracks(shadow) };
      if (options?.lastUpdate !== undefined) partial.lastUpdate = options.lastUpdate;
      set(partial);
      if (needsRenderUpdate) refreshAlarmTrackMapDebugSnapshot("setTracks");
    } else if (options?.lastUpdate !== undefined) {
      set({ lastUpdate: options.lastUpdate });
    }
  },

  setConnected: (v) => set({ connected: v }),
  setLastUpdate: (ts) => set({ lastUpdate: ts }),

  rebuildDisplayTracksFromCaches: () => {
    if (!_shadowOnlyDirty) return;
    _shadowOnlyDirty = false;
    set({ tracks: buildDisplayTracks(get().shadowTracks) });
  },

  syncWithAlarms: (alarmTrackIds) => {
    const shadow = get().shadowTracks;
    const disposedStore = useDisposedStore.getState();
    let changed = false;

    // 1. 渲染缓存优先：不匹配且粘滞已过期 → 降级到影子
    for (const [key, track] of _renderCache) {
      if (isTrackMatchedByAlarm(track, alarmTrackIds, shadow)) {
        touchAlarmBlueSticky(key);
        continue;
      }
      if (isAlarmBlueSticky(key)) continue;
      shadow.set(key, { ...track });
      _renderCache.delete(key);
      changed = true;
    }

    // 2. 影子补充：匹配告警或粘滞期内 → 提升到渲染
    for (const [key, shadowTrack] of shadow) {
      if (_renderCache.has(key)) continue;
      // 已处置的不提升
      if (disposedStore.isTrackDisposed(key)) continue;
      const matched = isTrackMatchedByAlarm(shadowTrack, alarmTrackIds, shadow);
      if (!matched && !isAlarmBlueSticky(key)) continue;
      if (matched) touchAlarmBlueSticky(key);
      _renderCache.set(key, { ...shadowTrack });
      shadow.delete(key);
      changed = true;
    }

    if (changed) {
      set({ tracks: buildDisplayTracks(shadow) });
      refreshAlarmTrackMapDebugSnapshot("syncWithAlarms");
    }
    return changed;
  },

  /** 超时清理：移除「超过 trackTimeout 未再被 WS 摄入」的航迹（优先看 _lastIngestMsByShowId） */
  pruneStaleTracks: () => {
    const cfg = getTrackRenderingConfig();
    if (!cfg.trackTimeout.enabled) return false;
    const now = Date.now();
    const isStale = (key: string, t: Track) => {
      const ing = _lastIngestMsByShowId.get(key);
      const limit = getTrackStaleTimeoutMs(t);
      if (ing != null) return now - ing > limit;
      const lu = Date.parse(t.lastUpdate);
      return Number.isFinite(lu) && now - lu > limit;
    };

    let changed = false;

    // 渲染层
    for (const [key, track] of _renderCache) {
      if (isStale(key, track)) {
        _renderCache.delete(key);
        _lastIngestMsByShowId.delete(key);
        changed = true;
      }
    }

    // 影子层
    const shadow = get().shadowTracks;
    for (const [key, track] of shadow) {
      if (isStale(key, track)) {
        shadow.delete(key);
        _lastIngestMsByShowId.delete(key);
        changed = true;
      }
    }

    if (changed) {
      set({ tracks: buildDisplayTracks(get().shadowTracks) });
      refreshAlarmTrackMapDebugSnapshot("pruneStaleTracks");
    }
    return changed;
  },

  /**
   * 更新指定航迹的查证图片。
   * 注意：勿刷新 `_lastIngestMsByShowId`（否则仅靠轮询图片会阻止超时 prune）。
   * 全局 image polling 已停用；保留 API 供显式调用。
   */
  updateTrackImage: (showID, imageUrl) => {
    const track = _renderCache.get(showID);
    if (!track) return false;
    if (track.verificationImage === imageUrl) return false;
    _renderCache.set(showID, { ...track, verificationImage: imageUrl ?? undefined });
    set({ tracks: buildDisplayTracks(get().shadowTracks) });
    return true;
  },

  applyManualSeaTargetType: (showID, targetType, classifiedType) => {
    const id = String(showID ?? "").trim();
    if (!id) return false;
    const patch = (t: Track): Track => ({
      ...t,
      manualTargetType: targetType,
      classifiedType,
      targetType,
    });
    let touched = false;
    const inRender = _renderCache.get(id);
    if (inRender) {
      _renderCache.set(id, patch(inRender));
      touched = true;
    }
    const shadow = get().shadowTracks;
    const inShadow = shadow.get(id);
    if (inShadow) {
      shadow.set(id, patch(inShadow));
      touched = true;
    }
    if (!touched) return false;
    set((s) => ({
      tracks: buildDisplayTracks(s.shadowTracks),
      mapManualAffiliationRev: s.mapManualAffiliationRev + 1,
    }));
    return true;
  },

  clearAllTracks: () => {
    _renderCache.clear();
    _lastIngestMsByShowId.clear();
    clearAlarmBlueSticky();
    _shadowOnlyDirty = false;
    get().shadowTracks.clear();
    set({ tracks: [], manualAffiliationByShowId: {}, mapManualAffiliationRev: 0 });
  },
}));

/** 获取当前 alert-store 的 alarmTrackIds（延迟 import 避免循环依赖） */
let _alertStoreGetter: (() => Set<string>) | null = null;
function getCurrentAlarmTrackIds(): Set<string> {
  if (!_alertStoreGetter) {
    try {
      const mod = require("@/stores/alert-store") as {
        useAlertStore: { getState: () => { alarmTrackIds: Set<string> } };
      };
      _alertStoreGetter = () => mod.useAlertStore.getState().alarmTrackIds;
    } catch {
      _alertStoreGetter = () => new Set<string>();
    }
  }
  return _alertStoreGetter();
}

/**
 * 告警匹配逻辑：见 `alarm-track-match.ts`（按 fuseType / uniqueID 区分海空同号 trackId）。
 */
export function isTrackMatchedByAlarm(
  track: Track,
  alarmTrackIds: Set<string>,
  shadowTracks?: Map<string, Track>,
): boolean {
  return isTrackMatchedByAlarmKeys(track, alarmTrackIds, shadowTracks);
}
