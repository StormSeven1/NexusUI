"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { canonicalEntityId } from "@/lib/camera-entity-id";
import {
  isEoVideoWebCodecsCanvasEnabled,
} from "@/lib/eo-video/eoVideoWebCodecsCanvas";
import type { EoWebCodecsPresentation } from "@/lib/eo-video/eoVideoWebCodecsCanvas";
import type {
  BufferedDetectionEntry,
  MatchState,
  UnifiedWsMatchState,
  WsDetectionSnapshot,
} from "@/lib/eo-video/eoDetectionTypes";
import type { EoEncodedSyncHub } from "@/lib/eo-video/eoWebrtcEncodedSync";
import { EO_RTP_MAX_NEAR_TICKS } from "@/lib/eo-video/eoWebrtcEncodedSync";
import {
  computeSyncHeaderCrossStats,
  eoDetectionBoxesEqual,
  headersMatch,
  detectionRectsToEoBoxes,
  resolveDetectionFrameSize,
  inferEoSurfaceShortFromRectTypeId,
} from "@/lib/eo-video/detectionSyncUtils";
import { getEoDetectionWebSocketManager } from "@/lib/eo-video/eoDetectionWebSocket";
import { ingestEntityDetectionPayload } from "@/lib/eo-video/entityDetectionIngest";
import {
  clearEoSingleTrackUserLatch,
  isEoSingleTrackUserLatchActive,
} from "@/lib/eo-video/eoSingleTrackUserLatch";
import {
  useEoCameraDdsHeldTrackUi,
} from "@/lib/eo-video/eoCameraDdsUiHold";
import { isCameraSingleTrackDetectionActive } from "@/lib/eo-video/formatEoDdsTaskOverlay";
import type { EoDetectionBox } from "@/lib/eo-video/types";
import { useTrackStore } from "@/stores/track-store";
import { useEoCameraDdsStatusStore } from "@/stores/eo-camera-dds-status-store";

const RENDER_MS = 40;
const DETECTION_ENTRY_STALE_MS = 2000;
/** 对齐 Qt `m_nNoneSingleTagTick`：连续 N 次 processAt 无新 singleRect 才清框 */
const SINGLE_NONE_RECT_MAX_TICKS = 5;
/** DDS 跟踪结束后禁止 WS 残留 singleRect 再次 latch 单目标层 */
const SINGLE_IGNORE_WS_AFTER_END_MS = 3000;
/** 跟踪结束后禁止 WS latch 单目标层 */
const SINGLE_DISENGAGE_COOLDOWN_MS = 3000;
/** DDS EXECUTING 帧间抖动：连续 N tick 未见 DDS 仍保持单目标层 */
const SINGLE_DDS_MISS_MAX_TICKS = 5;
/** WS 显式空框后，该窗口内忽略 syncHeader 命中的旧有框包（告警清除） */
const EXPLICIT_CLEAR_HONOR_MS = 400;
/** 多目标 sync 未命中沿用上一帧（Qt m_nNoneTagTick≈15，Web 取更宽） */
const MAX_HEADER_MISS = 15;
const WS_UNIFIED_MAX_FAILURES = 15;
/** hub 环滞后帧扫描：RTP 未命中时从最新帧起逐步回溯 */
const HEADER_MATCH_LAG_FRAMES = [0, 1, 2, 3, 4, 5, 6] as const;
const DIAG_EMIT_INTERVAL_MS = 260;
/**
 * WebRTC hub × WS header 从未 cross 命中时（与 sei_poc_test ws-latest 一致）：
 * 多目标直接用各层最新 WS 包，避免 lastSuccess/hold 只显示旧包里的少量框。
 */
const WS_LATEST_MULTI_AFTER_HEADER_NEVER_MATCHED = true;

function isExplicitEmptyEntry(entry: BufferedDetectionEntry | null | undefined): boolean {
  return entry != null && entry.videoRects.length === 0;
}

function latestBufferEntry(
  arr: BufferedDetectionEntry[],
  now: number,
  maxAgeMs: number,
): BufferedDetectionEntry | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr[i];
    if (!e) continue;
    if (now - e.receivedAt > maxAgeMs) break;
    return e;
  }
  return null;
}

function isLayerExplicitlyCleared(
  arr: BufferedDetectionEntry[],
  now: number,
  maxAgeMs = EXPLICIT_CLEAR_HONOR_MS,
): boolean {
  const latest = latestBufferEntry(arr, now, maxAgeMs);
  if (!isExplicitEmptyEntry(latest)) return false;
  /** 空包之后若已有更新的可绘制包，视为多目标已恢复 */
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr[i];
    if (!e) continue;
    if (now - e.receivedAt > maxAgeMs) break;
    if (e.receivedAt > latest!.receivedAt && (e.videoRects?.length ?? 0) > 0) return false;
  }
  return true;
}

/** 跳过显式空包，取最新可绘制检测包 */
function pickFreshestDrawable(
  arr: BufferedDetectionEntry[],
  now: number,
): BufferedDetectionEntry | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr[i];
    if (!e) continue;
    if (now - e.receivedAt > DETECTION_ENTRY_STALE_MS) break;
    if (isExplicitEmptyEntry(e)) continue;
    if (e.videoRects?.length) return e;
  }
  return null;
}

function finiteFromDdsField(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") {
    const n = Number(v.valueOf());
    return Number.isFinite(n) ? n : undefined;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * syncHeader 匹配（与 base-vue 一致；32/48 字节时比对前 32 字节前缀见 headersMatch）。
 */
function pickBySyncHeader(
  arr: BufferedDetectionEntry[],
  syncHeader: Uint8Array,
  now: number,
): BufferedDetectionEntry | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr[i];
    if (!e) continue;
    if (now - e.receivedAt > DETECTION_ENTRY_STALE_MS) break;
    if (e.header && headersMatch(e.header, syncHeader)) return e;
  }
  return null;
}

/** 多包同 header 时取 receivedAt 最接近 hubWallMs + D 的一包（避免 200 缓冲里命中旧包） */
function pickBySyncHeaderForPresentation(
  arr: BufferedDetectionEntry[],
  syncHeader: Uint8Array,
  hubWallMs: number,
  detectionDelayMs: number,
  now: number,
): BufferedDetectionEntry | null {
  if (detectionDelayMs <= 0) {
    return pickBySyncHeader(arr, syncHeader, now);
  }
  const targetReceivedAt = hubWallMs + detectionDelayMs;
  let best: BufferedDetectionEntry | null = null;
  let bestDelta = Infinity;
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr[i];
    if (!e) continue;
    if (now - e.receivedAt > DETECTION_ENTRY_STALE_MS) break;
    if (!e.header || !headersMatch(e.header, syncHeader)) continue;
    const delta = Math.abs(e.receivedAt - targetReceivedAt);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = e;
      if (delta <= 25) break;
    }
  }
  /** D 校准偏差时仍可能有 header 精确命中；回退最近一包避免单目标闪灭 */
  return best ?? pickBySyncHeader(arr, syncHeader, now);
}

/**
 * 按 receivedAt 最接近 targetWallMs 选检测包。
 * 这是核心对齐策略：编码帧入环 wallMs ≈ 检测包 receivedAt（两者在后端几乎同时产出）。
 */
function pickByReceivedAt(
  arr: BufferedDetectionEntry[],
  now: number,
  targetWallMs: number,
): BufferedDetectionEntry | null {
  let best: BufferedDetectionEntry | null = null;
  let bestDelta = Infinity;
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr[i];
    if (!e) continue;
    if (now - e.receivedAt > DETECTION_ENTRY_STALE_MS) break;
    const delta = Math.abs(e.receivedAt - targetWallMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = e;
      if (delta <= 20) break;
    }
  }
  return best;
}

/** 取最新的新鲜检测包 */
function pickFreshest(arr: BufferedDetectionEntry[], now: number): BufferedDetectionEntry | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr[i];
    if (!e) continue;
    if (now - e.receivedAt > DETECTION_ENTRY_STALE_MS) break;
    return e;
  }
  return null;
}

/** 相机运动时 header 易命中略旧包；单目标 interval tick 用 ws-latest，略放宽 fresh 优先 */
const MOTION_FRESH_SLACK_MS = 15;

function preferFresherOverHeaderHit(
  headerHit: BufferedDetectionEntry | null,
  arr: BufferedDetectionEntry[],
  now: number,
  slackMs = MOTION_FRESH_SLACK_MS,
): BufferedDetectionEntry | null {
  const fresh = pickFreshest(arr, now);
  if (!fresh?.videoRects?.length) return headerHit;
  if (!headerHit?.videoRects?.length) return fresh;
  if (fresh.receivedAt > headerHit.receivedAt + slackMs) return fresh;
  return headerHit;
}

function createUnifiedWsMatchState(): UnifiedWsMatchState {
  return {
    lastSuccess: null,
    failureCount: 0,
    maxFailures: WS_UNIFIED_MAX_FAILURES,
    isActive: false,
  };
}

function resetUnifiedWsMatchState(state: UnifiedWsMatchState): void {
  state.lastSuccess = null;
  state.failureCount = 0;
  state.isActive = false;
}

function snapshotHasMultiRects(snap: WsDetectionSnapshot): boolean {
  return (snap.boat?.videoRects?.length ?? 0) > 0 || (snap.plane?.videoRects?.length ?? 0) > 0;
}

function snapshotHasDrawableContent(snap: WsDetectionSnapshot): boolean {
  return snapshotHasMultiRects(snap) || entryHasDrawableSingleRects(snap.single);
}

function pickLatestUnifiedSnapshotAny(buf: WsDetectionSnapshot[], now: number): WsDetectionSnapshot | null {
  for (let i = buf.length - 1; i >= 0; i--) {
    const snap = buf[i]!;
    if (now - snap.receivedAt > DETECTION_ENTRY_STALE_MS) break;
    if (snapshotHasDrawableContent(snap)) return snap;
  }
  return null;
}

/** @deprecated 用 pickLatestUnifiedSnapshotAny；保留供诊断 */
function pickLatestUnifiedSnapshot(buf: WsDetectionSnapshot[], now: number): WsDetectionSnapshot | null {
  for (let i = buf.length - 1; i >= 0; i--) {
    const snap = buf[i]!;
    if (now - snap.receivedAt > DETECTION_ENTRY_STALE_MS) break;
    if (snapshotHasMultiRects(snap)) return snap;
  }
  return null;
}

/** 对齐 sei_poc_test processWsMatch：整包 WS 快照 header 匹配，失败则同 tick 可回退 ws-latest */
function matchUnifiedSnapshot(
  buf: WsDetectionSnapshot[],
  syncHeader: Uint8Array,
  state: UnifiedWsMatchState,
  now: number,
): WsDetectionSnapshot | null {
  if (!buf.length) {
    state.failureCount++;
    if (
      state.failureCount <= state.maxFailures &&
      state.lastSuccess &&
      snapshotHasDrawableContent(state.lastSuccess)
    ) {
      return state.lastSuccess;
    }
    state.isActive = false;
    return null;
  }
  for (let i = buf.length - 1; i >= 0; i--) {
    const snap = buf[i]!;
    if (now - snap.receivedAt > DETECTION_ENTRY_STALE_MS) break;
    for (const h of snap.headers) {
      if (!headersMatch(h, syncHeader)) continue;
      state.lastSuccess = snap;
      state.failureCount = 0;
      state.isActive = true;
      return snap;
    }
  }
  state.failureCount++;
  if (
    state.failureCount <= state.maxFailures &&
    state.lastSuccess &&
    snapshotHasDrawableContent(state.lastSuccess)
  ) {
    return state.lastSuccess;
  }
  state.isActive = false;
  return null;
}

function hasAnyHeader(arr: BufferedDetectionEntry[], now: number): boolean {
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr[i];
    if (!e) continue;
    if (now - e.receivedAt > DETECTION_ENTRY_STALE_MS) break;
    if (e.header) return true;
  }
  return false;
}

/** 单目标层是否含可绘制几何（与 base-vue `findSingleRect` 一致） */
function entryHasDrawableSingleRects(entry: BufferedDetectionEntry | null | undefined): boolean {
  if (!entry || isExplicitEmptyEntry(entry)) return false;
  for (const r of entry.videoRects) {
    if (!r || r.length < 4) continue;
    const w = Number(r[2]);
    const h = Number(r[3]);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return true;
  }
  return false;
}

function isRecentDrawableSingle(
  entry: BufferedDetectionEntry | null | undefined,
  now: number,
  maxAgeMs = DETECTION_ENTRY_STALE_MS,
): boolean {
  if (!entryHasDrawableSingleRects(entry)) return false;
  return now - entry!.receivedAt <= maxAgeMs;
}

function createDetectionMatchState(): MatchState {
  return { lastSuccess: null, failureCount: 0, maxFailures: MAX_HEADER_MISS, isActive: false };
}

function resetDetectionMatchState(state: MatchState): void {
  state.lastSuccess = null;
  state.failureCount = 0;
  state.isActive = false;
}

function resetDetectionSyncForPresentationRecovery(state: {
  singleMatchState: MatchState;
  boatMatchState: MatchState;
  planeMatchState: MatchState;
  multiNoneSyncTick: { current: number };
  singleNoneSyncTick: { current: number };
  headerDiag: { current: string };
  detectionDelaySamples: { current: number };
}): void {
  resetDetectionMatchState(state.singleMatchState);
  resetDetectionMatchState(state.boatMatchState);
  resetDetectionMatchState(state.planeMatchState);
  state.multiNoneSyncTick.current = 0;
  state.singleNoneSyncTick.current = 0;
  state.headerDiag.current = "";
  /** 保留 detectionDelayMs，但允许重新采样校准 */
  state.detectionDelaySamples.current = 0;
}

/**
 * 对齐 base-vue `processDetectionType`：每层独立 sync + lastSuccess 滞回（不 splice 缓冲）。
 */
function resolveLayerForDisplay(
  arr: BufferedDetectionEntry[],
  syncHeader: Uint8Array | null,
  state: MatchState,
  now: number,
  explicitlyCleared: boolean,
  _hubWallMs?: number,
  _detectionDelayMs = 0,
): BufferedDetectionEntry | null {
  if (explicitlyCleared) {
    resetDetectionMatchState(state);
    return null;
  }
  if (!syncHeader) {
    const fresh = pickFreshestDrawable(arr, now);
    if (fresh) {
      state.lastSuccess = fresh;
      state.failureCount = 0;
      state.isActive = true;
      return fresh;
    }
  }
  if (syncHeader) {
    /** 与 sei_poc_test processWsMatch 一致：按 header 直匹配最新 WS 包，不用 hubWallMs+D 选旧包 */
    const hit = pickBySyncHeader(arr, syncHeader, now);
    if (hit) {
      if (isExplicitEmptyEntry(hit)) {
        state.lastSuccess = hit;
        state.failureCount = 0;
        state.isActive = true;
        return hit;
      }
      state.lastSuccess = hit;
      state.failureCount = 0;
      state.isActive = true;
      return hit;
    }
  }
  state.failureCount++;
  if (
    state.failureCount <= state.maxFailures &&
    state.lastSuccess &&
    !isExplicitEmptyEntry(state.lastSuccess)
  ) {
    const fresh = pickFreshest(arr, now);
    if (fresh?.videoRects?.length && fresh.receivedAt > state.lastSuccess.receivedAt + MOTION_FRESH_SLACK_MS) {
      state.lastSuccess = fresh;
      state.failureCount = 0;
      state.isActive = true;
      return fresh;
    }
    return state.lastSuccess;
  }
  state.isActive = false;
  return null;
}

function extractRvfcRtpTimestamp(meta?: VideoFrameCallbackMetadata): number | null {
  if (!meta) return null;
  const rtp = (meta as unknown as Record<string, unknown>).rtpTimestamp;
  return typeof rtp === "number" && Number.isFinite(rtp) ? rtp : null;
}

function resolvePresentationSyncHeader(
  encodedSyncHub: EoEncodedSyncHub,
  rtpTimestamp: number | null,
): {
  syncHeader: Uint8Array | null;
  wallMs: number | null;
  mode: "rtp" | "latest" | "none";
} {
  if (rtpTimestamp != null && rtpTimestamp !== 0) {
    const snap = encodedSyncHub.snapshotByRtpTimestamp(rtpTimestamp, EO_RTP_MAX_NEAR_TICKS);
    if (snap) return { syncHeader: snap.syncHeader, wallMs: snap.wallMs, mode: "rtp" };
  }
  const latestSnap = encodedSyncHub.snapshotForPresentation(0);
  if (latestSnap) {
    return { syncHeader: latestSnap.syncHeader, wallMs: latestSnap.wallMs, mode: "latest" };
  }
  return { syncHeader: null, wallMs: null, mode: "none" };
}

function pickPresentationRtpTimestamp(
  wcTs: number | null,
  rvfcTs: number | null,
  preferWebCodecsTs: boolean,
): number | null {
  if (preferWebCodecsTs) return wcTs ?? rvfcTs;
  return rvfcTs ?? wcTs;
}

/** Canvas 正在出画时，检测应对齐 WebCodecs 帧而非 hidden `<video>` rvfc（双解码时硬件常快 1s+） */
function isWebCodecsCanvasPresenting(
  ref: React.MutableRefObject<EoWebCodecsPresentation> | undefined,
): boolean {
  const p = ref?.current;
  return Boolean(p?.active && p.lastRenderedRtpTimestamp > 0);
}

function singleBoxGeometryEqual(a: EoDetectionBox[], b: EoDetectionBox[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h) return false;
    if (x.frameWidth !== y.frameWidth || x.frameHeight !== y.frameHeight) return false;
  }
  return true;
}

const WS_LABEL = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"] as const;
const EMPTY_DETECTION_BOXES: EoDetectionBox[] = [];

export interface UseEoEntityDetectionOptions {
  entityId: string | undefined;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  encodedSyncHub?: EoEncodedSyncHub;
  videoReceiverRef?: React.MutableRefObject<RTCRtpReceiver | null>;
  enabled: boolean;
  onDiagnostic?: (line: string, hoverDetail?: string) => void;
  /** 与 Qt 放大画面类似：为 true 时标签主文案改为航迹信息；圆内类型字不变 */
  expandedMode?: boolean;
  /** 读 DDS `trackAlias` 的相机实体 id（与底部任务条 `cameraDdsEntityId` 一致；缺省用 detection entityId） */
  ddsCameraEntityId?: string;
  /** WebCodecs Canvas 主画面 intrinsic（`<video>` 常为 0×0 时用于像素框归一化） */
  presentationWidth?: number;
  presentationHeight?: number;
  webCodecsPresentationRef?: React.MutableRefObject<EoWebCodecsPresentation>;
  /** 每帧 processAt 完成后同步调用（用于 canvas 与视频同帧绘制，避免 React→RAF 额外延迟） */
  onPresentFrame?: (boxes: EoDetectionBox[]) => void;
}

export function useEoEntityDetection({
  entityId,
  videoRef,
  encodedSyncHub,
  enabled,
  onDiagnostic,
  expandedMode = false,
  ddsCameraEntityId,
  presentationWidth = 0,
  presentationHeight = 0,
  webCodecsPresentationRef,
  onPresentFrame,
}: UseEoEntityDetectionOptions): { boxes: EoDetectionBox[]; diag: string } {
  const [boxes, setBoxes] = useState<EoDetectionBox[]>([]);
  const [diag, setDiag] = useState("");
  const boatBuf = useRef<BufferedDetectionEntry[]>([]);
  const planeBuf = useRef<BufferedDetectionEntry[]>([]);
  const singleBuf = useRef<BufferedDetectionEntry[]>([]);
  const unifiedBuf = useRef<WsDetectionSnapshot[]>([]);
  const tickingRef = useRef(false);
  const processRerunRef = useRef(false);
  const lastRvfcMetaRef = useRef<VideoFrameCallbackMetadata | undefined>(undefined);
  const processAtRef = useRef<(rvfcMeta?: VideoFrameCallbackMetadata) => void>(() => {});
  const captureToDisplayOffsetMsRef = useRef(0);
  const hasCaptureTsRef = useRef(false);
  const lastJitterUpdateMsRef = useRef(0);
  const lastJitterTargetMsRef = useRef(-1);

  const headerEverMatchedRef = useRef(false);

  const syncDiagRef = useRef({ headerOk: 0, headerFail: 0, wallMs: 0, freshest: 0 });
  const headerDiagRef = useRef("");
  /** 对齐 C++ `m_lastSingleRectType`：当前帧缺类型时沿用最近一次可判定类型 */
  const lastSingleTypeRef = useRef<"空" | "海" | null>(null);
  /**
   * 检测延迟 D（ms）= 最新检测包 receivedAt - 编码帧环最新帧 wallMs。
   * 后端先推编码帧（wallMs），经过检测算法后才推检测结果（receivedAt），差值就是 D。
   * 渲染时：当前显示帧 wallMs + D ≈ 对应检测包的 receivedAt。
   */
  const detectionDelayMsRef = useRef(0);
  const detectionDelaySamplesRef = useRef(0);
  const lastDiagEmitMsRef = useRef(0);
  const lastHeaderDiagAtRef = useRef(0);
  const lastDiagLineRef = useRef("");
  /** 对齐 Qt `m_lastSingleRect` + `m_nNoneSingleTagTick` */
  const lastSingleBoxesRef = useRef<EoDetectionBox[]>([]);
  const singleNoneSyncTickRef = useRef(0);
  /** 对齐 Qt `m_vLastRect` + `m_nNoneTagTick`（多目标） */
  const lastMultiBoxesRef = useRef<EoDetectionBox[]>([]);
  const multiNoneSyncTickRef = useRef(0);
  /** 对齐 base-vue matchingState：各层独立 sync 滞回，单目标优先时不画多目标 */
  const singleMatchStateRef = useRef<MatchState>(createDetectionMatchState());
  const boatMatchStateRef = useRef<MatchState>(createDetectionMatchState());
  const planeMatchStateRef = useRef<MatchState>(createDetectionMatchState());
  const unifiedMatchStateRef = useRef<UnifiedWsMatchState>(createUnifiedWsMatchState());
  const lastBoxesRef = useRef<EoDetectionBox[]>([]);
  const lastPresentationEpochRef = useRef(0);
  const prevSingleTrackModeRef = useRef(false);
  /** 相机双击跟踪 / WS 出现 singleRect 后锁单目标层，直到丢失或显式清除（防与 boat 多目标交替） */
  const singleEngagedRef = useRef(false);
  /** 最近一次收到可绘制 singleRect 的时间（latch 滞回用） */
  const singleLastFeedAtRef = useRef(0);
  const singleLastPresentAtRef = useRef(0);
  const singleEngageCooldownUntilRef = useRef(0);
  const singleDdsMissTicksRef = useRef(0);
  const singleIgnoreWsUntilRef = useRef(0);
  const displayLayerRef = useRef<"single" | "multi" | null>(null);

  const onDiagnosticRef = useRef(onDiagnostic);
  const onPresentFrameRef = useRef(onPresentFrame);
  const expandedModeRef = useRef(expandedMode);
  const ddsLookupIdRef = useRef("");
  const ddsTrackIdForUiRef = useRef<number | null>(null);
  const ddsAliasStrRef = useRef("");
  const singleTrackOverlayTitleRef = useRef<string | null>(null);
  const encodedSyncHubRef = useRef(encodedSyncHub);
  const webCodecsPresentationRefRef = useRef(webCodecsPresentationRef);

  const presentationSizeRef = useRef({ w: 0, h: 0 });
  presentationSizeRef.current = {
    w: presentationWidth > 0 ? presentationWidth : 0,
    h: presentationHeight > 0 ? presentationHeight : 0,
  };

  const id = entityId?.trim() ? canonicalEntityId(entityId.trim()) : "";

  const ddsLookupId = useMemo(() => {
    const raw = (ddsCameraEntityId ?? entityId)?.trim();
    if (!raw) return "";
    return canonicalEntityId(raw);
  }, [ddsCameraEntityId, entityId]);

  /** 与右下角任务条同源 3s 滞回，避免单目标标牌航迹号随 DDS 抖动 */
  const heldDdsTrackUi = useEoCameraDdsHeldTrackUi(ddsLookupId);
  const ddsTrackIdForUi = heldDdsTrackUi.trackId;
  const ddsAliasStrMemo = heldDdsTrackUi.trackAlias;
  const singleTrackOverlayTitle = heldDdsTrackUi.overlayTitle;

  onDiagnosticRef.current = onDiagnostic;
  onPresentFrameRef.current = onPresentFrame;
  expandedModeRef.current = expandedMode;
  ddsLookupIdRef.current = ddsLookupId;
  ddsTrackIdForUiRef.current = ddsTrackIdForUi;
  ddsAliasStrRef.current = ddsAliasStrMemo;
  singleTrackOverlayTitleRef.current = singleTrackOverlayTitle;
  encodedSyncHubRef.current = encodedSyncHub;
  webCodecsPresentationRefRef.current = webCodecsPresentationRef;

  useEffect(() => {
    boatBuf.current = [];
    planeBuf.current = [];
    singleBuf.current = [];
    unifiedBuf.current = [];
    captureToDisplayOffsetMsRef.current = 0;
    hasCaptureTsRef.current = false;
    headerEverMatchedRef.current = false;
    syncDiagRef.current = { headerOk: 0, headerFail: 0, wallMs: 0, freshest: 0 };
    headerDiagRef.current = "";
    lastSingleTypeRef.current = null;
    lastDiagEmitMsRef.current = 0;
    lastDiagLineRef.current = "";
    lastSingleBoxesRef.current = [];
    singleNoneSyncTickRef.current = 0;
    lastMultiBoxesRef.current = [];
    multiNoneSyncTickRef.current = 0;
    resetDetectionMatchState(singleMatchStateRef.current);
    resetDetectionMatchState(boatMatchStateRef.current);
    resetDetectionMatchState(planeMatchStateRef.current);
    resetUnifiedWsMatchState(unifiedMatchStateRef.current);
    lastBoxesRef.current = [];
    lastPresentationEpochRef.current = 0;
    prevSingleTrackModeRef.current = false;
    singleEngagedRef.current = false;
    singleLastFeedAtRef.current = 0;
    singleLastPresentAtRef.current = 0;
    singleEngageCooldownUntilRef.current = 0;
    singleDdsMissTicksRef.current = 0;
    singleIgnoreWsUntilRef.current = 0;
    clearEoSingleTrackUserLatch(id);
    setBoxes([]);
    setDiag("");
  }, [id]);

  useEffect(() => {
    if (!enabled || !id) return;
    const mgr = getEoDetectionWebSocketManager();
    return mgr.subscribe(id, (data) => {
      const cleared = ingestEntityDetectionPayload(
        data,
        boatBuf.current,
        planeBuf.current,
        singleBuf.current,
        unifiedBuf.current,
      );
      if (cleared.clearedSingle) {
        lastSingleBoxesRef.current = [];
        lastBoxesRef.current = lastBoxesRef.current.filter((b) => b.variant !== "singleTrack");
        singleNoneSyncTickRef.current = 0;
        resetDetectionMatchState(singleMatchStateRef.current);
      }
      if (cleared.clearedBoat || cleared.clearedPlane) {
        lastMultiBoxesRef.current = lastMultiBoxesRef.current.filter((b) => {
          if (cleared.clearedBoat && b.id.startsWith("boat-")) return false;
          if (cleared.clearedPlane && b.id.startsWith("plane-")) return false;
          return true;
        });
        multiNoneSyncTickRef.current = MAX_HEADER_MISS;
      }
      /** 单目标层已锁时 WS 一到即刷新 */
      if (singleEngagedRef.current) {
        const lastSingle = singleBuf.current[singleBuf.current.length - 1];
        if (lastSingle && entryHasDrawableSingleRects(lastSingle) && Date.now() - lastSingle.receivedAt < 8) {
          queueMicrotask(() => processAtRef.current(lastRvfcMetaRef.current));
        }
      }
    });
  }, [enabled, id]);

  useEffect(() => {
    return () => {
      lastJitterUpdateMsRef.current = 0;
      lastJitterTargetMsRef.current = -1;
    };
  }, [id]);

  useEffect(() => {
    if (!enabled || !id) return;

    const processAt = (rvfcMeta?: VideoFrameCallbackMetadata) => {
      processAtRef.current = processAt;
      if (tickingRef.current) {
        processRerunRef.current = true;
        if (rvfcMeta !== undefined) lastRvfcMetaRef.current = rvfcMeta;
        return;
      }
      tickingRef.current = true;
      const video = videoRef.current;
      const ddsTrackIdForUi = ddsTrackIdForUiRef.current;
      const ddsLookupId = ddsLookupIdRef.current;
      const ddsAliasStrMemo = ddsAliasStrRef.current;
      const singleTrackOverlayTitle = singleTrackOverlayTitleRef.current;
      const expandedMode = expandedModeRef.current;
      const encodedSyncHub = encodedSyncHubRef.current;
      const mgr = getEoDetectionWebSocketManager();
      const rs = mgr.getWsReadyState();
      const wsName = rs >= 0 && rs < 4 ? WS_LABEL[rs] : "?";
      const wsDbg = mgr.getLastWsInboundDebugForUi();

      let out: EoDetectionBox[] = [];
      let syncMode = "none";
      let syncHdrPickMode = "none";
      let presentationClk = "int";
      let explicitClearDisplay = false;
      let singleTargetLost = false;
      let ddsSingleTrackActive = false;
      let displayLayer: "single" | "multi" = "multi";
      let userSingleLatch = false;
      try {
        const next: EoDetectionBox[] = [];
        const now = Date.now();

        const ddsRow = ddsLookupId
          ? useEoCameraDdsStatusStore.getState().byEntityId[ddsLookupId]
          : undefined;
        /** 仅 EXECUTING 跟踪态锁单目标层；ddsTrackIdForUi 3s 滞回只影响标牌，不 gate 画框 */
        ddsSingleTrackActive = isCameraSingleTrackDetectionActive(ddsRow);

        const ddsTrackJustEnded = prevSingleTrackModeRef.current && !ddsSingleTrackActive;
        if (ddsTrackJustEnded) {
          lastSingleBoxesRef.current = [];
          singleBuf.current = [];
          resetDetectionMatchState(singleMatchStateRef.current);
          resetDetectionMatchState(boatMatchStateRef.current);
          resetDetectionMatchState(planeMatchStateRef.current);
          multiNoneSyncTickRef.current = 0;
          singleEngagedRef.current = false;
          singleLastFeedAtRef.current = 0;
          singleLastPresentAtRef.current = 0;
          singleNoneSyncTickRef.current = 0;
          singleDdsMissTicksRef.current = 0;
          singleIgnoreWsUntilRef.current = now + SINGLE_IGNORE_WS_AFTER_END_MS;
          singleEngageCooldownUntilRef.current = now + SINGLE_DISENGAGE_COOLDOWN_MS;
          if (id) clearEoSingleTrackUserLatch(id);
        }
        const ddsWasActiveLastFrame = prevSingleTrackModeRef.current;
        prevSingleTrackModeRef.current = ddsSingleTrackActive;

        const ignoreSingleWs = now < singleIgnoreWsUntilRef.current;
        userSingleLatch = id ? isEoSingleTrackUserLatchActive(id, now) : false;
        const freshSingleEntry = ignoreSingleWs
          ? null
          : pickFreshestDrawable(singleBuf.current, now);
        const recentSingle = isRecentDrawableSingle(freshSingleEntry, now);
        if (recentSingle && freshSingleEntry) {
          singleLastFeedAtRef.current = Math.max(
            singleLastFeedAtRef.current,
            freshSingleEntry.receivedAt,
          );
        }

        /**
         * 单/多硬互斥（对齐 Qt）：仅 DDS EXECUTING 或界面双击 latch 可进单目标层。
         * ❌ 禁止 WS 出现 singleRect 即在 dds=0 时自动 engage（camServer 会 boat/single 分包交替广播）。
         */
        if (ddsSingleTrackActive) {
          singleEngagedRef.current = true;
          singleDdsMissTicksRef.current = 0;
          if (id) clearEoSingleTrackUserLatch(id);
        } else if (
          singleEngagedRef.current &&
          ddsWasActiveLastFrame &&
          singleDdsMissTicksRef.current < SINGLE_DDS_MISS_MAX_TICKS
        ) {
          singleEngagedRef.current = true;
          singleDdsMissTicksRef.current++;
        } else if (
          userSingleLatch &&
          !ignoreSingleWs &&
          now >= singleEngageCooldownUntilRef.current
        ) {
          singleEngagedRef.current = true;
        } else {
          singleEngagedRef.current = false;
          singleDdsMissTicksRef.current = 0;
        }

        const singleExplicitlyCleared =
          !singleEngagedRef.current &&
          isLayerExplicitlyCleared(singleBuf.current, now);
        if (singleExplicitlyCleared) {
          explicitClearDisplay = true;
          singleLastFeedAtRef.current = 0;
        }

        if (!singleEngagedRef.current) {
          singleLastFeedAtRef.current = 0;
          singleNoneSyncTickRef.current = 0;
        }

        const wcPres = webCodecsPresentationRefRef.current?.current;
        const presentationEpoch = wcPres?.presentationEpoch ?? 0;
        if (presentationEpoch !== lastPresentationEpochRef.current) {
          lastPresentationEpochRef.current = presentationEpoch;
          resetDetectionSyncForPresentationRecovery({
            singleMatchState: singleMatchStateRef.current,
            boatMatchState: boatMatchStateRef.current,
            planeMatchState: planeMatchStateRef.current,
            multiNoneSyncTick: multiNoneSyncTickRef,
            singleNoneSyncTick: singleNoneSyncTickRef,
            headerDiag: headerDiagRef,
            detectionDelaySamples: detectionDelaySamplesRef,
          });
        }

        const boatExplicitlyCleared = isLayerExplicitlyCleared(boatBuf.current, now);
        const planeExplicitlyCleared = isLayerExplicitlyCleared(planeBuf.current, now);

        if (boatExplicitlyCleared || planeExplicitlyCleared) {
          explicitClearDisplay = true;
          lastMultiBoxesRef.current = lastMultiBoxesRef.current.filter((b) => {
            if (boatExplicitlyCleared && b.id.startsWith("boat-")) return false;
            if (planeExplicitlyCleared && b.id.startsWith("plane-")) return false;
            return true;
          });
          multiNoneSyncTickRef.current = MAX_HEADER_MISS;
        }

        const boxesFromEntry = (
          entry: BufferedDetectionEntry | null,
          idPrefix: "boat" | "plane" | "single",
        ): EoDetectionBox[] => {
          if (!entry?.videoRects?.length) return [];
          const pres = presentationSizeRef.current;
          const presentationW = pres.w > 0 ? pres.w : 0;
          const presentationH = pres.h > 0 ? pres.h : 0;
          const { w: vw, h: vh } = resolveDetectionFrameSize(entry.videoRects, {
            entryW: entry.videoWidth,
            entryH: entry.videoHeight,
            presentationW,
            presentationH,
            videoW: video?.videoWidth ?? 0,
            videoH: video?.videoHeight ?? 0,
          });
          return detectionRectsToEoBoxes(entry.videoRects, vw, vh, idPrefix).map((b) => ({
            ...b,
            frameWidth: vw,
            frameHeight: vh,
          }));
        };

        const mapSingleEntryToBoxes = (singleEntry: BufferedDetectionEntry): EoDetectionBox[] => {
          const singleBoxesRaw = boxesFromEntry(singleEntry, "single");
          if (!singleBoxesRaw.length) return [];
          const ddAz = finiteFromDdsField(ddsRow?.azimuth);
          const ddCourse = finiteFromDdsField(ddsRow?.course);
          const ddSpeed = finiteFromDdsField(ddsRow?.speed);
          const ddDist = finiteFromDdsField(ddsRow?.distance);
          const meta = singleEntry.singleDisplayMeta;
          const ex = expandedMode;
          return singleBoxesRaw.map((b) => {
            const inferTypeFromTracks = (trackId: number | null | undefined): "空" | "海" | null => {
              if (trackId == null || !Number.isFinite(trackId)) return null;
              const tid = String(Math.trunc(trackId));
              const all = useTrackStore.getState().tracks;
              const hit = all.find((t) => t.showID === tid || t.trackId === tid || t.uniqueID === tid);
              if (!hit) return null;
              if (hit.isAirTrack || hit.type === "air") return "空";
              if (hit.type === "sea" || hit.type === "underwater") return "海";
              return null;
            };
            const nameTypeHint = (() => {
              const nm = String(meta?.trackName ?? "").toLowerCase();
              if (/plane|air|bird|uav|drone|空|机|鸟|aircraft/.test(nm)) return "空";
              if (/ship|boat|vessel|buoy|海|船|浮|surface/.test(nm)) return "海";
              return "";
            })();
            const rawT = (String(meta?.typeShort ?? nameTypeHint).trim().slice(0, 1) || "").slice(0, 1);
            const byRectType = inferEoSurfaceShortFromRectTypeId(b.rectTypeId);
            const byTrack =
              inferTypeFromTracks(ddsTrackIdForUi) ??
              inferTypeFromTracks(b.ddsTrackId) ??
              inferTypeFromTracks(b.trackId);
            const tagFallback =
              b.singleTagShort === "空" || b.singleTagShort === "海" ? b.singleTagShort : undefined;
            const ts: "空" | "海" =
              rawT === "空"
                ? "空"
                : rawT === "海"
                  ? "海"
                  : byRectType ?? byTrack ?? lastSingleTypeRef.current ?? tagFallback ?? "海";
            lastSingleTypeRef.current = ts;
            const nmWs = (meta?.trackName ?? "").trim();
            const displayName = ddsAliasStrMemo || nmWs;
            const wsTid = b.trackId;
            const targetName =
              displayName ||
              (ddsTrackIdForUi != null ? `T${ddsTrackIdForUi}` : wsTid != null ? `T${wsTid}` : "目标");
            const titleText = ex
              ? ddsTrackIdForUi != null
                ? `航迹 ${ddsTrackIdForUi} 号${displayName ? ` · ${displayName}` : ""}`
                : displayName || "航迹"
              : targetName;
            const singleTrackDetail: NonNullable<EoDetectionBox["singleTrackDetail"]> = {};
            const az = ddAz ?? meta?.azimuthDeg;
            const distM = ddDist ?? meta?.distanceM;
            const spd = ddSpeed ?? meta?.speedMps;
            const cog = ddCourse ?? meta?.courseDeg;
            if (az != null && Number.isFinite(az)) singleTrackDetail.azimuthDeg = az;
            if (distM != null && Number.isFinite(distM)) singleTrackDetail.distanceM = distM;
            if (spd != null && Number.isFinite(spd)) singleTrackDetail.speedMps = spd;
            if (cog != null && Number.isFinite(cog)) singleTrackDetail.courseDeg = cog;
            return {
              ...b,
              variant: "singleTrack" as const,
              singleTagShort: ts,
              label: titleText,
              singleTrackDetail,
              singleTrackOverlayTitle,
              ...(ddsTrackIdForUi != null ? { ddsTrackId: ddsTrackIdForUi } : {}),
            };
          });
        };

        const appendMultiFromEntries = (
          boatEntry: BufferedDetectionEntry | null,
          planeEntry: BufferedDetectionEntry | null,
        ) => {
          if (!boatExplicitlyCleared && boatEntry) {
            next.push(...boxesFromEntry(boatEntry, "boat"));
          }
          if (!planeExplicitlyCleared && planeEntry) {
            next.push(...boxesFromEntry(planeEntry, "plane"));
          }
        };

        const pickMultiOnly = (
          picker: (arr: BufferedDetectionEntry[]) => BufferedDetectionEntry | null,
        ): { boat: BufferedDetectionEntry | null; plane: BufferedDetectionEntry | null } => ({
          boat: boatExplicitlyCleared ? null : picker(boatBuf.current),
          plane: planeExplicitlyCleared ? null : picker(planeBuf.current),
        });

        let headerMatchedThisTick = false;
        /** cross≈0：header 从未命中 → 多目标走 ws-latest（各层 pickFreshest） */
        let wsLatestMulti = false;

        const bufHasHeader =
          hasAnyHeader(boatBuf.current, now) ||
          hasAnyHeader(planeBuf.current, now) ||
          hasAnyHeader(singleBuf.current, now);

        const hubSnapForWallMs = encodedSyncHub?.snapshotForPresentation(0) ?? null;

      let syncHdr: Uint8Array | null = null;
      let syncHubWallMs: number | null = null;
      /** 40ms 定时 tick 与 sei_poc_test overlayTimer 一致：不传 rtp，用 hub 最新 + ws-latest */
      const intervalTick = rvfcMeta === undefined;
        if (encodedSyncHub && bufHasHeader) {
          const wc = webCodecsPresentationRefRef.current?.current;
          const wcTs =
            wc && wc.lastRenderedRtpTimestamp > 0 ? wc.lastRenderedRtpTimestamp : null;
          const rvfcTs = extractRvfcRtpTimestamp(rvfcMeta);
          const canvasPresenting = isWebCodecsCanvasPresenting(webCodecsPresentationRefRef.current);
          const videoFallbackActive = Boolean(wc?.videoFallbackActive);
          /** 仅 Canvas 正在出画且未 fallback 时用 WebCodecs RTP；否则 rvfc / hub lag */
          const preferWebCodecsTs = canvasPresenting && !videoFallbackActive;
          presentationClk =
            preferWebCodecsTs && wcTs != null ? "wc" : rvfcTs != null ? "rvfc" : "int";
          const pickTs = pickPresentationRtpTimestamp(wcTs, rvfcTs, preferWebCodecsTs);
          const altTs =
            wcTs != null &&
            rvfcTs != null &&
            wcTs !== rvfcTs
              ? pickTs === rvfcTs
                ? wcTs
                : rvfcTs
              : null;

          let resolved = resolvePresentationSyncHeader(encodedSyncHub, pickTs);
          syncHdr = resolved.syncHeader;
          syncHubWallMs = resolved.wallMs;
          syncHdrPickMode = resolved.mode;

          const pickLayerHit = (hdr: Uint8Array) => {
            const pickArr = (arr: BufferedDetectionEntry[]) => pickBySyncHeader(arr, hdr, now);
            return (
              pickArr(singleBuf.current) ??
              pickArr(boatBuf.current) ??
              pickArr(planeBuf.current)
            );
          };

          let layerHit = syncHdr ? pickLayerHit(syncHdr) : null;

          if (!layerHit && altTs != null) {
            const altResolved = resolvePresentationSyncHeader(encodedSyncHub, altTs);
            if (altResolved.syncHeader) {
              const altHit = pickLayerHit(altResolved.syncHeader);
              if (altHit) {
                resolved = altResolved;
                syncHdr = altResolved.syncHeader;
                syncHubWallMs = altResolved.wallMs;
                syncHdrPickMode = altResolved.mode;
                layerHit = altHit;
              }
            }
          }

          if (
            !layerHit &&
            !intervalTick &&
            (headerEverMatchedRef.current || syncDiagRef.current.headerFail < 60)
          ) {
            for (const lag of HEADER_MATCH_LAG_FRAMES) {
              const snap = encodedSyncHub.snapshotForPresentation(lag);
              if (!snap?.syncHeader) continue;
              const lagHit = pickLayerHit(snap.syncHeader);
              if (!lagHit) continue;
              syncHdr = snap.syncHeader;
              syncHubWallMs = snap.wallMs;
              syncHdrPickMode = `lag${lag}`;
              layerHit = lagHit;
              break;
            }
          }

          if (syncHdr) {
            if (layerHit) {
              headerMatchedThisTick = true;
              headerEverMatchedRef.current = true;
              syncDiagRef.current.headerOk++;
              if (syncHubWallMs != null) {
                const sampleD = layerHit.receivedAt - syncHubWallMs;
                if (sampleD > 0 && sampleD < 3000) {
                  const alpha = 0.12;
                  const n = detectionDelaySamplesRef.current;
                  if (n === 0) {
                    detectionDelayMsRef.current = sampleD;
                  } else {
                    detectionDelayMsRef.current =
                      alpha * sampleD + (1 - alpha) * detectionDelayMsRef.current;
                  }
                  detectionDelaySamplesRef.current = n + 1;
                } else if (sampleD <= 0) {
                  const allBufs = [...singleBuf.current, ...boatBuf.current, ...planeBuf.current];
                  let latestRa = 0;
                  for (const e of allBufs) {
                    if (now - e.receivedAt > DETECTION_ENTRY_STALE_MS) continue;
                    if (e.receivedAt > latestRa) latestRa = e.receivedAt;
                  }
                  const estD = latestRa > 0 ? latestRa - syncHubWallMs : 0;
                  if (estD > 80 && estD < 3000) {
                    const alpha = 0.08;
                    const n = detectionDelaySamplesRef.current;
                    if (n === 0) {
                      detectionDelayMsRef.current = estD;
                    } else {
                      detectionDelayMsRef.current =
                        alpha * estD + (1 - alpha) * detectionDelayMsRef.current;
                    }
                    detectionDelaySamplesRef.current = n + 1;
                  }
                }
              }
            } else {
              syncDiagRef.current.headerFail++;
            }

            if (now - lastHeaderDiagAtRef.current >= DIAG_EMIT_INTERVAL_MS) {
              lastHeaderDiagAtRef.current = now;
              const hex = (u: Uint8Array) =>
                Array.from(u.slice(0, 8))
                  .map((b) => b.toString(16).padStart(2, "0"))
                  .join("");
              const allBufs = [...boatBuf.current, ...planeBuf.current, ...singleBuf.current];
              const wsHeaders = allBufs.filter((e) => e.header).map((e) => e.header!);
              const crossStats = computeSyncHeaderCrossStats(
                encodedSyncHub.getAllSyncHeaders(),
                wsHeaders,
              );
              if (layerHit && crossStats.cross > 0) {
                headerDiagRef.current = `cross=${crossStats.cross}/${crossStats.hubLen}h×${crossStats.wsLen}w OK`;
              } else if (!layerHit) {
                const hubHex = `hub(${syncHdr.length})=${hex(syncHdr)}`;
                const wsTail = wsHeaders.length > 0 ? wsHeaders[wsHeaders.length - 1]! : null;
                const wsHex = wsTail ? `ws(${wsTail.length})=${hex(wsTail)}` : "ws=null";
                const sizeHint =
                  crossStats.hubSize != null && crossStats.wsSize != null
                    ? ` pktHub=${crossStats.hubSize} pktWs=${crossStats.wsSize}`
                    : "";
                const prefixHint =
                  crossStats.cross === 0 && crossStats.bestPrefix > 0
                    ? ` bestPx=${crossStats.bestPrefix}/32`
                    : "";
                headerDiagRef.current = `${hubHex} ${wsHex} cross=${crossStats.cross}/${crossStats.hubLen}h×${crossStats.wsLen}w${sizeHint}${prefixHint}`;
              }
            }
          }

          if (
            WS_LATEST_MULTI_AFTER_HEADER_NEVER_MATCHED &&
            !headerMatchedThisTick &&
            (!headerEverMatchedRef.current ||
              syncDiagRef.current.headerFail > syncDiagRef.current.headerOk)
          ) {
            wsLatestMulti = true;
          }
        }

        const pushHeldOrMappedSingle = (
          mapped: EoDetectionBox[],
          mode: string,
        ): boolean => {
          if (mapped.length === 0) return false;
          next.push(...mapped);
          lastSingleBoxesRef.current = mapped;
          singleNoneSyncTickRef.current = 0;
          singleLastFeedAtRef.current = now;
          singleLastPresentAtRef.current = now;
          syncMode = mode;
          return true;
        };

        const pushSingleHold = (): boolean => {
          if (lastSingleBoxesRef.current.length === 0) return false;
          if (
            !ddsSingleTrackActive &&
            singleNoneSyncTickRef.current >= SINGLE_NONE_RECT_MAX_TICKS
          ) {
            return false;
          }
          next.push(...lastSingleBoxesRef.current);
          if (!ddsSingleTrackActive) {
            singleNoneSyncTickRef.current++;
          }
          syncMode = ddsSingleTrackActive
            ? `single-dds-hold(${singleNoneSyncTickRef.current})`
            : `single-hold(${singleNoneSyncTickRef.current})`;
          return true;
        };

        /** 单/多硬互斥：eng=1 时绝不 append 多目标 */
        let useSingleLayer = singleEngagedRef.current;

        if (useSingleLayer) {
          let drawn = false;

          if (recentSingle && freshSingleEntry) {
            drawn = pushHeldOrMappedSingle(
              mapSingleEntryToBoxes(freshSingleEntry),
              "ws-latest-single",
            );
            singleNoneSyncTickRef.current = 0;
          }

          if (!drawn) {
            drawn = pushSingleHold();
          }

          if (!drawn && !ddsSingleTrackActive && !userSingleLatch) {
            singleTargetLost = true;
            singleEngagedRef.current = false;
            lastSingleBoxesRef.current = [];
            resetDetectionMatchState(singleMatchStateRef.current);
            singleLastFeedAtRef.current = 0;
            singleLastPresentAtRef.current = 0;
            useSingleLayer = false;
          } else if (!drawn) {
            syncMode = syncMode || "single-wait";
          }
        }

        if (!useSingleLayer) {
          lastSingleBoxesRef.current = [];
          resetDetectionMatchState(singleMatchStateRef.current);
          singleNoneSyncTickRef.current = 0;

          const boatEntry = resolveLayerForDisplay(
            boatBuf.current,
            syncHdr,
            boatMatchStateRef.current,
            now,
            boatExplicitlyCleared,
            syncHubWallMs ?? undefined,
            detectionDelayMsRef.current,
          );
          const planeEntry = resolveLayerForDisplay(
            planeBuf.current,
            syncHdr,
            planeMatchStateRef.current,
            now,
            planeExplicitlyCleared,
            syncHubWallMs ?? undefined,
            detectionDelayMsRef.current,
          );
          let boatDraw = boatEntry;
          let planeDraw = planeEntry;
          if (!boatExplicitlyCleared && !boatDraw?.videoRects?.length) {
            boatDraw = pickFreshestDrawable(boatBuf.current, now);
          }
          if (!planeExplicitlyCleared && !planeDraw?.videoRects?.length) {
            planeDraw = pickFreshestDrawable(planeBuf.current, now);
          }
          if (intervalTick) {
            if (!boatExplicitlyCleared) {
              boatDraw =
                preferFresherOverHeaderHit(boatDraw, boatBuf.current, now) ??
                boatDraw ??
                pickFreshestDrawable(boatBuf.current, now);
            }
            if (!planeExplicitlyCleared) {
              planeDraw =
                preferFresherOverHeaderHit(planeDraw, planeBuf.current, now) ??
                planeDraw ??
                pickFreshestDrawable(planeBuf.current, now);
            }
          }
          appendMultiFromEntries(boatDraw, planeDraw);
          if (next.length > 0) {
            syncMode = syncHdr ? "header-multi" : "multi-hold";
            multiNoneSyncTickRef.current = 0;
          }

          if (next.length === 0 && !syncHdr && hubSnapForWallMs && encodedSyncHub) {
            syncMode = "wallMs";
            syncDiagRef.current.wallMs++;
            let frameWallMs = hubSnapForWallMs.wallMs;
            const rvfcTs = extractRvfcRtpTimestamp(rvfcMeta);
            const wcTs = webCodecsPresentationRefRef.current?.current?.lastRenderedRtpTimestamp;
            const pickTs = wcTs != null && wcTs > 0 ? wcTs : rvfcTs;
            if (pickTs != null && pickTs !== 0) {
              const byRtp = encodedSyncHub.snapshotByRtpTimestamp(pickTs);
              if (byRtp) frameWallMs = byRtp.wallMs;
            }
            const targetReceivedAt = frameWallMs + detectionDelayMsRef.current;
            const wall = pickMultiOnly((arr) => pickByReceivedAt(arr, now, targetReceivedAt));
            appendMultiFromEntries(wall.boat, wall.plane);
          }

          if (next.length === 0 && !syncHdr && !headerMatchedThisTick) {
            if (syncMode === "none") syncMode = "freshest";
            else syncMode += "→fresh";
            syncDiagRef.current.freshest++;
            const fresh = pickMultiOnly((arr) => pickFreshestDrawable(arr, now));
            appendMultiFromEntries(fresh.boat, fresh.plane);
          }

          if (next.length === 0) {
            const fresh = pickMultiOnly((arr) => pickFreshestDrawable(arr, now));
            appendMultiFromEntries(fresh.boat, fresh.plane);
            if (next.length > 0) syncMode = syncMode || "layer-freshest";
          }

          if (next.length > 0) {
            lastMultiBoxesRef.current = next;
            explicitClearDisplay = false;
            singleTargetLost = false;
          } else if (
            !boatExplicitlyCleared &&
            !planeExplicitlyCleared &&
            lastMultiBoxesRef.current.length > 0 &&
            bufHasHeader
          ) {
            multiNoneSyncTickRef.current++;
            if (multiNoneSyncTickRef.current < MAX_HEADER_MISS) {
              next.push(...lastMultiBoxesRef.current);
              syncMode = `multi-last-hold(${multiNoneSyncTickRef.current})`;
            } else {
              lastMultiBoxesRef.current = [];
              syncMode = "multi-miss-clear";
            }
          }
        }

        displayLayer = useSingleLayer ? "single" : "multi";
        out =
          displayLayer === "single"
            ? next.filter((b) => b.variant === "singleTrack")
            : next.filter((b) => b.variant !== "singleTrack");
      } catch (drawErr) {
        out = [];
        syncMode = "draw-err";
        if (typeof console !== "undefined") {
          console.warn("[eo-detect] processAt failed", drawErr);
        }
      } finally {
        const jitterMs = lastJitterTargetMsRef.current >= 0 ? `jitter ${lastJitterTargetMsRef.current}ms · ` : "";
        const noTs = !hasCaptureTsRef.current ? " ⚠无captureTs" : "";
        const sd = syncDiagRef.current;
        const delayD = Math.round(detectionDelayMsRef.current);
        const syncInfo = `sync=${syncMode} pick=${syncHdrPickMode} clk=${presentationClk} hOk=${sd.headerOk} hF=${sd.headerFail} wMs=${sd.wallMs} fr=${sd.freshest} D=${delayD}ms`;
        const hdrDiag = headerDiagRef.current ? ` [${headerDiagRef.current}]` : "";
        const layerChanged =
          displayLayerRef.current != null && displayLayerRef.current !== displayLayer;
        displayLayerRef.current = displayLayer;
        const line = `检测 WS ${wsName} · buf ${boatBuf.current.length}/${planeBuf.current.length}/${singleBuf.current.length} u${unifiedBuf.current.length} · 框 ${out.length} · layer=${displayLayer} state=${lastBoxesRef.current.length} · eng=${singleEngagedRef.current ? 1 : 0} dds=${ddsSingleTrackActive ? 1 : 0} latch=${userSingleLatch ? 1 : 0} · ${jitterMs}${syncInfo}${hdrDiag}${noTs}${
          wsDbg.summary ? ` | ${wsDbg.summary}` : ""
        }`;
        const nowEmit = Date.now();
        const changed = line !== lastDiagLineRef.current;
        if (changed && nowEmit - lastDiagEmitMsRef.current >= DIAG_EMIT_INTERVAL_MS) {
          setDiag(line);
          const hover = [line, wsDbg.rawForTitle].filter(Boolean).join("\n\n");
          onDiagnosticRef.current?.(line, hover || undefined);
          lastDiagLineRef.current = line;
          lastDiagEmitMsRef.current = nowEmit;
        }
        if (out.length > 0) {
          const allSingleTrack =
            out.length > 0 &&
            out.every((b) => b.variant === "singleTrack") &&
            lastBoxesRef.current.length > 0 &&
            lastBoxesRef.current.every((b) => b.variant === "singleTrack");
          const skipSetState =
            allSingleTrack &&
            singleBoxGeometryEqual(out, lastBoxesRef.current) &&
            eoDetectionBoxesEqual(out, lastBoxesRef.current);
          if (!skipSetState || layerChanged) {
            lastBoxesRef.current = out;
            setBoxes(out);
          }
          onPresentFrameRef.current?.(out);
        } else if (explicitClearDisplay || singleTargetLost) {
          if (lastBoxesRef.current.length > 0) {
            lastBoxesRef.current = [];
            setBoxes([]);
          }
          onPresentFrameRef.current?.([]);
        } else if (layerChanged && lastBoxesRef.current.length > 0) {
          const synced =
            displayLayer === "single"
              ? lastBoxesRef.current.filter((b) => b.variant === "singleTrack")
              : lastBoxesRef.current.filter((b) => b.variant !== "singleTrack");
          if (!eoDetectionBoxesEqual(synced, lastBoxesRef.current)) {
            lastBoxesRef.current = synced;
            setBoxes(synced);
          }
        }
        tickingRef.current = false;
        if (processRerunRef.current) {
          processRerunRef.current = false;
          queueMicrotask(() => processAt(lastRvfcMetaRef.current));
        }
      }
    };

    const video = videoRef.current;
    let timer: number | null = null;
    let frameCbId: number | null = null;
    let rafId: number | null = null;
    let stopped = false;
    let lastWebCodecsRtpTs = 0;

    const runByFrame = (_now: DOMHighResTimeStamp, meta?: VideoFrameCallbackMetadata) => {
      if (stopped) return;
      const wallClockMs = Date.now();

      const newest =
        singleBuf.current[singleBuf.current.length - 1] ??
        boatBuf.current[boatBuf.current.length - 1] ??
        planeBuf.current[planeBuf.current.length - 1];
      if (newest?.captureTs && Number.isFinite(newest.captureTs)) {
        hasCaptureTsRef.current = true;
        const sample = wallClockMs - newest.captureTs;
        if (Number.isFinite(sample) && sample > 0 && sample < 8000) {
          captureToDisplayOffsetMsRef.current = captureToDisplayOffsetMsRef.current * 0.7 + sample * 0.3;
        }
      }

      processAt(meta);
      if (meta !== undefined) lastRvfcMetaRef.current = meta;
      const v = videoRef.current;
      if (!stopped && v && typeof v.requestVideoFrameCallback === "function") {
        frameCbId = v.requestVideoFrameCallback(runByFrame);
      }
    };

    const webCodecsSyncPath =
      isEoVideoWebCodecsCanvasEnabled() &&
      Boolean(encodedSyncHubRef.current) &&
      Boolean(webCodecsPresentationRefRef.current);

    const stopRvfc = () => {
      const v = videoRef.current;
      if (frameCbId != null && v && typeof v.cancelVideoFrameCallback === "function") {
        v.cancelVideoFrameCallback(frameCbId);
      }
      frameCbId = null;
    };

    const startRvfc = () => {
      if (stopped || frameCbId != null) return;
      const v = videoRef.current;
      if (!v || typeof v.requestVideoFrameCallback !== "function") return;
      frameCbId = v.requestVideoFrameCallback(runByFrame);
    };

    if (webCodecsSyncPath) {
      processAt(undefined);
      const tickPresentation = () => {
        if (stopped) return;
        const wc = webCodecsPresentationRefRef.current?.current;
        const canvasPresenting = isWebCodecsCanvasPresenting(webCodecsPresentationRefRef.current);
        const videoFallbackActive = Boolean(wc?.videoFallbackActive);

        if (canvasPresenting && !videoFallbackActive) {
          stopRvfc();
          const ts = wc!.lastRenderedRtpTimestamp;
          if (ts > 0 && ts !== lastWebCodecsRtpTs) {
            lastWebCodecsRtpTs = ts;
            processAt(undefined);
          }
        } else {
          startRvfc();
        }
        rafId = window.requestAnimationFrame(tickPresentation);
      };
      rafId = window.requestAnimationFrame(tickPresentation);
      /** Canvas 黑屏 / fallback 过渡期仍定时 processAt，便于 hub lag / freshest 引导 */
      timer = window.setInterval(() => processAt(), RENDER_MS);
    } else if (video && typeof video.requestVideoFrameCallback === "function") {
      frameCbId = video.requestVideoFrameCallback(runByFrame);
      /** 与 sei_poc_test overlayTimer(40ms) 一致：不传 rtp，用 hub 最新 sync + ws-latest */
      timer = window.setInterval(() => processAt(undefined), RENDER_MS);
    } else {
      timer = window.setInterval(() => processAt(), RENDER_MS);
    }

    return () => {
      stopped = true;
      if (timer != null) window.clearInterval(timer);
      if (rafId != null) window.cancelAnimationFrame(rafId);
      stopRvfc();
    };
  }, [enabled, id, videoRef, webCodecsPresentationRef]);

  return {
    boxes: enabled && id ? boxes : EMPTY_DETECTION_BOXES,
    diag: enabled && id ? diag : "",
  };
}
