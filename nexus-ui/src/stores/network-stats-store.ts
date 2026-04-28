/**
 * network-stats-store — 网络数据接收统计单例
 *
 * 【用途】记录各类型 WS 数据最后接收时间，供 UI 展示接收间隔和超时状态。
 *
 * 【数据分类】
 *   - 航迹（对空 / 对海）
 *   - 无人机（按 deviceSn）
 *   - 实体（按 entity ID）
 *   - 告警
 *   - 区域
 *   - 相机/光电
 *   - 机场
 *   - 无人机航线
 *
 * 【超时判定】
 *   - 超时阈值: 8 秒（TIMEOUT_MS）
 *   - 超时后最多显示 60 秒（MAX_DISPLAY_MS），之后显示 "-"
 *   - 未超时: 绿色，超时: 红色
 *
 * 【性能设计】
 *   recordXxx() 只递增轻量计数器（writeBuffer），不创建对象、不调 Date.now()；
 *   flushBuffer() 在 getNetworkStatsSnapshot() 中调用（UI 1 秒轮询触发），
 *   将缓冲计数合并到 entries Map，此时才更新 lastReceivedAt。
 *   高频 WS 消息下：100 条/秒 → 仅 1 次 Map 写入 + 1 次 Date.now()。
 */

import { useState, useEffect } from "react";

// ── 常量 ──

/** 超时阈值（毫秒）：超过此时间未收到数据视为超时 */
const TIMEOUT_MS = 8000;
/** 超时后最大显示时间（毫秒）：超过此时间后显示 "-" */
const MAX_DISPLAY_MS = 60000;

// ── 类型 ──

/** 单条数据源的接收统计 */
export interface NetworkStatEntry {
  /** 数据源标识（如 "对空航迹"、"uav-007"） */
  label: string;
  /** 所属分类 */
  category: string;
  /** 最后接收时间戳（ms） */
  lastReceivedAt: number | null;
  /** 累计接收条数 */
  count: number;
}

/** UI 展示用的计算结果 */
export interface NetworkStatDisplay {
  label: string;
  category: string;
  /** 显示文本：如 "1.2s"、"- " */
  displayText: string;
  /** 是否超时 */
  isTimeout: boolean;
  /** 累计条数 */
  count: number;
}

// ── 全局状态 ──

const entries = new Map<string, NetworkStatEntry>();

/** 写缓冲：key → 待合并的计数增量。recordXxx() 只做计数递增，极低开销。 */
const writeBuffer = new Map<string, number>();

/** 将缓冲中的计数增量合并到 entries Map，同时更新 lastReceivedAt */
function flushBuffer() {
  if (writeBuffer.size === 0) return;
  const now = Date.now();
  for (const [key, delta] of writeBuffer) {
    const existing = entries.get(key);
    if (existing) {
      existing.count += delta;
      existing.lastReceivedAt = now;
    }
  }
  writeBuffer.clear();
}

/** 确保 entries 中存在指定 key 的条目（首次出现时预创建，count=0） */
function ensureEntry(key: string, label: string, category: string) {
  if (!entries.has(key)) {
    entries.set(key, { label, category, lastReceivedAt: null, count: 0 });
  }
}

/** 递增缓冲计数 */
function bump(key: string) {
  writeBuffer.set(key, (writeBuffer.get(key) ?? 0) + 1);
}

// ── 记录方法（只递增计数器，不触发通知） ──

/** 记录航迹数据（区分对空/对海） */
export function recordTrackReceived(isAirTrack: boolean) {
  const key = isAirTrack ? "track:air" : "track:sea";
  const label = isAirTrack ? "对空航迹" : "对海航迹";
  ensureEntry(key, label, "航迹");
  bump(key);
}

/** 记录无人机数据（统一归入"无人机"分类，不按 SN 区分） */
export function recordDroneReceived() {
  ensureEntry("drone", "无人机", "无人机");
  bump("drone");
}

/** 将 asset_type（由 wsEntityTypeRaw 解析）映射为可读大类名 */
function entityCategoryFromAssetType(assetType?: string): string {
  if (!assetType) return "其他";
  switch (assetType) {
    case "radar": return "雷达";
    case "camera": return "相机";
    case "laser": return "激光";
    case "tdoa": return "TDOA";
    case "drone": return "无人机";
    case "airport": return "机场";
    case "tower": return "电侦";
    default: return "其他";
  }
}

/** 记录实体数据（按 asset_type 聚合：雷达/相机/激光/TDOA/无人机/机场/电侦/其他） */
export function recordEntityReceived(entityId: string, assetType?: string) {
  const typeName = entityCategoryFromAssetType(assetType);
  const key = `entity:${typeName}`;
  ensureEntry(key, typeName, "实体");
  bump(key);
}

/** 记录告警数据 */
export function recordAlertReceived() {
  ensureEntry("alert", "告警", "告警");
  bump("alert");
}

/** 记录区域数据 */
export function recordZoneReceived() {
  ensureEntry("zone", "区域", "区域");
  bump("zone");
}

/** 记录相机/光电数据 */
export function recordCameraReceived(entityId?: string) {
  const key = entityId ? `camera:${entityId}` : "camera";
  const label = entityId ? `光电 ${entityId}` : "光电";
  ensureEntry(key, label, "光电");
  bump(key);
}

/** 记录机场数据（统一归入"无人机"分类） */
export function recordDockReceived() {
  ensureEntry("dock", "机场", "无人机");
  bump("dock");
}

/** 记录无人机航线数据（统一归入"无人机"分类） */
export function recordDroneFlightPathReceived() {
  ensureEntry("flight_path", "航线", "无人机");
  bump("flight_path");
}

// ── 读取方法 ──

/** 计算单条 entry 的展示信息 */
function computeDisplay(entry: NetworkStatEntry, now: number): NetworkStatDisplay {
  if (!entry.lastReceivedAt) {
    return { label: entry.label, category: entry.category, displayText: "-", isTimeout: true, count: entry.count };
  }
  const elapsed = now - entry.lastReceivedAt;
  const isTimeout = elapsed > TIMEOUT_MS;
  if (elapsed > MAX_DISPLAY_MS) {
    return { label: entry.label, category: entry.category, displayText: "-", isTimeout: true, count: entry.count };
  }
  const seconds = elapsed / 1000;
  return {
    label: entry.label,
    category: entry.category,
    displayText: `${seconds.toFixed(1)}s`,
    isTimeout,
    count: entry.count,
  };
}

/** 获取所有统计项的展示数据（按分类分组排序）；先 flush 缓冲再计算 */
export function getNetworkStatsSnapshot(): NetworkStatDisplay[] {
  flushBuffer();
  const now = Date.now();
  const result: NetworkStatDisplay[] = [];
  for (const entry of entries.values()) {
    result.push(computeDisplay(entry, now));
  }
  // 按分类排序
  const categoryOrder = ["航迹", "无人机", "实体", "告警", "区域", "光电"];
  result.sort((a, b) => {
    const ci = categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
    if (ci !== 0) return ci;
    return a.label.localeCompare(b.label);
  });
  return result;
}

// ── React 订阅 hook ──

/**
 * useNetworkStats — React hook，1 秒轮询刷新展示数据。
 * recordXxx() 只递增缓冲计数，UI 1 秒轮询时 flush + 计算快照。
 */
export function useNetworkStats(): NetworkStatDisplay[] {
  const [snapshot, setSnapshot] = useState<NetworkStatDisplay[]>(() => getNetworkStatsSnapshot());

  useEffect(() => {
    const timer = setInterval(() => {
      setSnapshot(getNetworkStatsSnapshot());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return snapshot;
}
