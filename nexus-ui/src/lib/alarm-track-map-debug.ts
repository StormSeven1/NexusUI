/**
 * GIS 告警航迹调试：记录地图上告警关联目标的 uniqueID，并输出双蓝 / 同号排查信息。
 *
 * 开关（优先级从高到低）：
 * - `NEXT_PUBLIC_DEBUG_ALARM_TRACK_MAP=false` → 关闭
 * - `NEXT_PUBLIC_DEBUG_ALARM_TRACK_MAP=true`  → 强制开启
 * - 默认：development 开启，production 关闭
 *
 * 浏览器控制台：`window.__NEXUS_ALARM_TRACK_DEBUG__` 查看最新快照。
 */

import type { Track } from "@/lib/map-entity-model";
import { fuseTypeFromTrack } from "@/lib/alarm-track-match";
import { getTrackIdModeConfig } from "@/lib/map-app-config";
import { resolveTrackLayerKey } from "@/lib/track-layer-visibility";

export function isAlarmTrackMapDebugEnabled(): boolean {
  if (typeof process !== "undefined") {
    const raw = process.env.NEXT_PUBLIC_DEBUG_ALARM_TRACK_MAP;
    if (raw != null) {
      const v = String(raw).trim().toLowerCase();
      if (v === "false" || v === "0" || v === "no" || v === "off") return false;
      if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
    }
    return process.env.NODE_ENV === "development";
  }
  return false;
}

export type AlarmTrackDebugEntry = {
  showID: string;
  uniqueID: string;
  trackId: string | null;
  isAirTrack: boolean;
  fuseType: 0 | 1;
  type: string;
  trackLayerKey: string;
  ddsSourceId: string | null;
  lat: number;
  lng: number;
  mapLabelText: string;
};

export type AlarmTrackMapDebugSnapshot = {
  updatedAt: string;
  reason: string;
  distinguishSeaAir: boolean;
  alarmMatchKeys: string[];
  /** 当前地图上告警关联（渲染层）目标的 uniqueID 列表 */
  alarmLinkedUniqueIds: string[];
  alarmLinked: AlarmTrackDebugEntry[];
  /** 同一 trackId 对应多条告警关联航迹 → 潜在「双蓝 / 双 1313」 */
  duplicateTrackIds: Record<string, AlarmTrackDebugEntry[]>;
  alertsSummary: Array<{
    id: string;
    trackId: string | null;
    uniqueID: string | null;
    fuseType: number | null;
    alarmType: string | null;
    title: string | null;
  }>;
};

declare global {
  interface Window {
    __NEXUS_ALARM_TRACK_DEBUG__?: AlarmTrackMapDebugSnapshot;
  }
}

function mapLabelText(track: Track): string {
  const mode = getTrackIdModeConfig();
  if (mode.distinguishSeaAir) {
    return track.type === "air" ? track.showID : (track.trackId ?? track.showID);
  }
  return track.trackId ?? track.showID;
}

function toDebugEntry(track: Track): AlarmTrackDebugEntry {
  return {
    showID: track.showID,
    uniqueID: track.uniqueID ?? track.showID,
    trackId: track.trackId ?? null,
    isAirTrack: track.isAirTrack === true,
    fuseType: fuseTypeFromTrack(track),
    type: track.type,
    trackLayerKey: resolveTrackLayerKey(track),
    ddsSourceId: track.ddsSourceId ?? null,
    lat: track.lat,
    lng: track.lng,
    mapLabelText: mapLabelText(track),
  };
}

function readAlertsSummary(): AlarmTrackMapDebugSnapshot["alertsSummary"] {
  try {
    const mod = require("@/stores/alert-store") as {
      useAlertStore: {
        getState: () => {
          alerts: Array<{
            id: string;
            trackId?: string;
            uniqueID?: string;
            fuseType?: number;
            alarmType?: string;
            title?: string;
          }>;
          alarmTrackIds: Set<string>;
        };
      };
    };
    const { alerts } = mod.useAlertStore.getState();
    return alerts.map((a) => ({
      id: a.id,
      trackId: a.trackId?.trim() || null,
      uniqueID: a.uniqueID?.trim() || null,
      fuseType: a.fuseType === 0 || a.fuseType === 1 ? a.fuseType : null,
      alarmType: a.alarmType ?? null,
      title: a.title?.trim() || null,
    }));
  } catch {
    return [];
  }
}

function readAlarmMatchKeys(): string[] {
  try {
    const mod = require("@/stores/alert-store") as {
      useAlertStore: { getState: () => { alarmTrackIds: Set<string> } };
    };
    return [...mod.useAlertStore.getState().alarmTrackIds].sort();
  } catch {
    return [];
  }
}

function readRenderCacheTracks(): Track[] {
  try {
    const mod = require("@/stores/track-store") as {
      getRenderCache: () => ReadonlyMap<string, Track>;
    };
    return [...mod.getRenderCache().values()];
  } catch {
    return [];
  }
}

function buildSnapshot(reason: string): AlarmTrackMapDebugSnapshot {
  const alarmLinked = readRenderCacheTracks().map(toDebugEntry);
  const duplicateTrackIds: Record<string, AlarmTrackDebugEntry[]> = {};
  for (const entry of alarmLinked) {
    const tid = entry.trackId?.trim();
    if (!tid) continue;
    if (!duplicateTrackIds[tid]) duplicateTrackIds[tid] = [];
    duplicateTrackIds[tid].push(entry);
  }
  for (const tid of Object.keys(duplicateTrackIds)) {
    if (duplicateTrackIds[tid]!.length < 2) delete duplicateTrackIds[tid];
  }

  return {
    updatedAt: new Date().toISOString(),
    reason,
    distinguishSeaAir: getTrackIdModeConfig().distinguishSeaAir,
    alarmMatchKeys: readAlarmMatchKeys(),
    alarmLinkedUniqueIds: alarmLinked.map((e) => e.uniqueID),
    alarmLinked,
    duplicateTrackIds,
    alertsSummary: readAlertsSummary(),
  };
}

function snapshotFingerprint(s: AlarmTrackMapDebugSnapshot): string {
  const dup = Object.entries(s.duplicateTrackIds)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tid, rows]) => `${tid}:${rows.map((r) => r.showID).sort().join(",")}`)
    .join("|");
  return [
    s.alarmLinkedUniqueIds.slice().sort().join(","),
    s.alarmMatchKeys.join(","),
    dup,
    String(s.alertsSummary.length),
  ].join(";");
}

let lastFingerprint = "";
let lastLogAt = 0;
const LOG_THROTTLE_MS = 1200;

/**
 * 刷新告警航迹调试快照；告警关联集合或同号冲突变化时打日志。
 */
export function refreshAlarmTrackMapDebugSnapshot(reason: string): void {
  if (!isAlarmTrackMapDebugEnabled()) return;

  const snapshot = buildSnapshot(reason);
  if (typeof window !== "undefined") {
    window.__NEXUS_ALARM_TRACK_DEBUG__ = snapshot;
  }

  const fp = snapshotFingerprint(snapshot);
  const now = Date.now();
  const changed = fp !== lastFingerprint;
  const throttled = now - lastLogAt < LOG_THROTTLE_MS;
  if (!changed && throttled) return;

  lastFingerprint = fp;
  lastLogAt = now;

  const dupKeys = Object.keys(snapshot.duplicateTrackIds);
  if (changed) {
    console.groupCollapsed(
      `[alarm-track-map] ${reason} · 告警关联 ${snapshot.alarmLinked.length} 条 · uniqueIDs=[${snapshot.alarmLinkedUniqueIds.join(", ")}]`,
    );
    console.log("distinguishSeaAir", snapshot.distinguishSeaAir);
    console.log("alarmMatchKeys", snapshot.alarmMatchKeys);
    console.table(snapshot.alarmLinked);
    if (snapshot.alertsSummary.length > 0) {
      console.log("alertsSummary", snapshot.alertsSummary);
    }
    console.log("window.__NEXUS_ALARM_TRACK_DEBUG__", snapshot);
    console.groupEnd();
  }

  if (dupKeys.length > 0) {
    console.warn(
      `[alarm-track-map] 同 trackId 多条告警关联航迹（可能双蓝/双编号）:`,
      dupKeys.map((tid) => ({
        trackId: tid,
        mapLabel: snapshot.duplicateTrackIds[tid]!.map((e) => e.mapLabelText),
        uniqueIDs: snapshot.duplicateTrackIds[tid]!.map((e) => e.uniqueID),
        showIDs: snapshot.duplicateTrackIds[tid]!.map((e) => e.showID),
        fuseTypes: snapshot.duplicateTrackIds[tid]!.map((e) => e.fuseType),
      })),
    );
  }
}
