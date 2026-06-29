"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { canonicalEntityId } from "@/lib/camera-entity-id";
import {
  shouldCutEoVideoHardwarePassthrough,
} from "@/lib/eo-video/eoVideoHardwarePassthrough";
import { isEoVideoWebCodecsCanvasEnabled } from "@/lib/eo-video/eoVideoWebCodecsCanvas";
import type { EoWebCodecsPresentation } from "@/lib/eo-video/eoVideoWebCodecsCanvas";
import type { BufferedDetectionEntry, MatchState } from "@/lib/eo-video/eoDetectionTypes";
import type { EoEncodedSyncHub } from "@/lib/eo-video/eoWebrtcEncodedSync";
import { EO_RTP_MAX_NEAR_TICKS } from "@/lib/eo-video/eoWebrtcEncodedSync";
import {
  eoDetectionBoxesEqual,
  headersMatch,
  detectionRectsToEoBoxes,
  resolveDetectionFrameSize,
} from "@/lib/eo-video/detectionSyncUtils";
import { getEoDetectionWebSocketManager } from "@/lib/eo-video/eoDetectionWebSocket";
import { ingestEntityDetectionPayload } from "@/lib/eo-video/entityDetectionIngest";
import { useEoCameraDdsHeldTrackUi } from "@/lib/eo-video/eoCameraDdsUiHold";
import type { EoDetectionBox } from "@/lib/eo-video/types";
import { useTrackStore } from "@/stores/track-store";
import { useEoCameraDdsStatusStore } from "@/stores/eo-camera-dds-status-store";

const RENDER_MS = 40;
const DETECTION_ENTRY_STALE_MS = 2000;
/**
 * 连续 sync 未命中则清框。约 40ms/tick，25≈1s；
 * 对齐 Qt `m_nNoneSingleTagTick >= 5`（@50ms）但 Web 链路抖动更大，取 1s。
 */
const SINGLE_TRACK_SYNC_MISS_CLEAR_TICKS = 25;
/** WS 显式空框后，该窗口内忽略 syncHeader 命中的旧有框包（告警清除） */
const EXPLICIT_CLEAR_HONOR_MS = 400;
/** 多目标 sync 短暂失败沿用上一帧（对齐 base-vue maxFailures=20 / Qt m_nNoneTagTick=15） */
const MAX_HEADER_MISS = 20;
const DIAG_EMIT_INTERVAL_MS = 260;

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
  return isExplicitEmptyEntry(latestBufferEntry(arr, now, maxAgeMs));
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
  return best;
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

function createDetectionMatchState(): MatchState {
  return { lastSuccess: null, failureCount: 0, maxFailures: MAX_HEADER_MISS, isActive: false };
}

function resetDetectionMatchState(state: MatchState): void {
  state.lastSuccess = null;
  state.failureCount = 0;
  state.isActive = false;
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
  hubWallMs?: number,
  detectionDelayMs = 0,
): BufferedDetectionEntry | null {
  if (explicitlyCleared) {
    resetDetectionMatchState(state);
    return null;
  }
  if (syncHeader) {
    const hit =
      hubWallMs != null
        ? pickBySyncHeaderForPresentation(
            arr,
            syncHeader,
            hubWallMs,
            detectionDelayMs,
            now,
          )
        : pickBySyncHeader(arr, syncHeader, now);
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
    return state.lastSuccess;
  }
  resetDetectionMatchState(state);
  return null;
}

/**
 * 对齐 base-vue `frameBuffer.length > 6 ? [6] : [0]`：固定滞后，不在多 lag 间跳动。
 * 硬件 `<video>` / WebCodecs 优先用 rtpTimestamp 查 hub；失败再回退 lag=6。
 */
function getPresentationSyncHeaderByLag(encodedSyncHub: EoEncodedSyncHub): Uint8Array | null {
  const ringLen = encodedSyncHub.getAllSyncHeaders().length;
  const lag = ringLen > 6 ? 6 : 0;
  return encodedSyncHub.snapshotForPresentation(lag)?.syncHeader ?? null;
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
  mode: "rtp" | "lag6" | "none";
} {
  if (rtpTimestamp != null && rtpTimestamp !== 0) {
    const snap = encodedSyncHub.snapshotByRtpTimestamp(rtpTimestamp, EO_RTP_MAX_NEAR_TICKS);
    if (snap) return { syncHeader: snap.syncHeader, wallMs: snap.wallMs, mode: "rtp" };
  }
  const lagSnap = encodedSyncHub.snapshotForPresentation(
    encodedSyncHub.getAllSyncHeaders().length > 6 ? 6 : 0,
  );
  if (lagSnap) {
    return { syncHeader: lagSnap.syncHeader, wallMs: lagSnap.wallMs, mode: "lag6" };
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

/** 仅比较框几何，跟踪态避免因 DDS 标牌数字抖动触发 setState */
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
}: UseEoEntityDetectionOptions): { boxes: EoDetectionBox[]; diag: string } {
  const [boxes, setBoxes] = useState<EoDetectionBox[]>([]);
  const [diag, setDiag] = useState("");
  const boatBuf = useRef<BufferedDetectionEntry[]>([]);
  const planeBuf = useRef<BufferedDetectionEntry[]>([]);
  const singleBuf = useRef<BufferedDetectionEntry[]>([]);
  const tickingRef = useRef(false);
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
  const lastBoxesRef = useRef<EoDetectionBox[]>([]);

  const onDiagnosticRef = useRef(onDiagnostic);
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
    lastBoxesRef.current = [];
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
      );
      if (cleared.clearedSingle) {
        lastSingleBoxesRef.current = [];
        singleNoneSyncTickRef.current = SINGLE_TRACK_SYNC_MISS_CLEAR_TICKS;
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
      if (tickingRef.current) return;
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
      let syncHdrPickMode: "rtp" | "lag6" | "none" = "none";
      let presentationClk = "int";
      try {
        const next: EoDetectionBox[] = [];
        const now = Date.now();

        const boatExplicitlyCleared = isLayerExplicitlyCleared(boatBuf.current, now);
        const planeExplicitlyCleared = isLayerExplicitlyCleared(planeBuf.current, now);

        if (boatExplicitlyCleared || planeExplicitlyCleared) {
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
          label: string,
          color: "friendly" | "hostile" | "accent",
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
          return detectionRectsToEoBoxes(entry.videoRects, vw, vh, idPrefix, label, color).map((b) => ({
            ...b,
            frameWidth: vw,
            frameHeight: vh,
          }));
        };

        const mapSingleEntryToBoxes = (singleEntry: BufferedDetectionEntry): EoDetectionBox[] => {
          const singleBoxesRaw = boxesFromEntry(singleEntry, "single", "", "accent");
          if (!singleBoxesRaw.length) return [];
          const ddsRow = ddsLookupId
            ? useEoCameraDdsStatusStore.getState().byEntityId[ddsLookupId]
            : undefined;
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
            const byTrack =
              inferTypeFromTracks(ddsTrackIdForUi) ??
              inferTypeFromTracks(b.ddsTrackId) ??
              inferTypeFromTracks(b.trackId);
            const ts: "空" | "海" =
              rawT === "空" ? "空" : rawT === "海" ? "海" : byTrack ?? lastSingleTypeRef.current ?? "海";
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
            next.push(...boxesFromEntry(boatEntry, "boat", "海", "friendly"));
          }
          if (!planeExplicitlyCleared && planeEntry) {
            next.push(...boxesFromEntry(planeEntry, "plane", "空", "hostile"));
          }
        };

        const pickMultiOnly = (
          picker: (arr: BufferedDetectionEntry[]) => BufferedDetectionEntry | null,
        ): { boat: BufferedDetectionEntry | null; plane: BufferedDetectionEntry | null } => ({
          boat: boatExplicitlyCleared ? null : picker(boatBuf.current),
          plane: planeExplicitlyCleared ? null : picker(planeBuf.current),
        });

        let headerMatchedThisTick = false;

        const bufHasHeader =
          hasAnyHeader(boatBuf.current, now) ||
          hasAnyHeader(planeBuf.current, now) ||
          hasAnyHeader(singleBuf.current, now);

        const hubSnapForWallMs =
          encodedSyncHub?.snapshotForPresentation(0) ??
          encodedSyncHub?.snapshotForPresentation(6) ??
          null;

        let syncHdr: Uint8Array | null = null;
        let syncHubWallMs: number | null = null;
        if (encodedSyncHub && bufHasHeader) {
          const wc = webCodecsPresentationRefRef.current?.current;
          const wcTs =
            wc && wc.lastRenderedRtpTimestamp > 0 ? wc.lastRenderedRtpTimestamp : null;
          const rvfcTs = extractRvfcRtpTimestamp(rvfcMeta);
          const canvasPresenting = isWebCodecsCanvasPresenting(webCodecsPresentationRefRef.current);
          const cutPassthrough = shouldCutEoVideoHardwarePassthrough(
            isEoVideoWebCodecsCanvasEnabled() && Boolean(encodedSyncHub),
          );
          const preferWebCodecsTs = cutPassthrough || canvasPresenting;
          presentationClk = preferWebCodecsTs && wcTs != null ? "wc" : rvfcTs != null ? "rvfc" : "int";
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
            const pickArr = (arr: BufferedDetectionEntry[]) =>
              syncHubWallMs != null
                ? pickBySyncHeaderForPresentation(
                    arr,
                    hdr,
                    syncHubWallMs,
                    detectionDelayMsRef.current,
                    now,
                  )
                : pickBySyncHeader(arr, hdr, now);
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
              if (!headerDiagRef.current) {
                const hex = (u: Uint8Array) =>
                  Array.from(u.slice(0, 8))
                    .map((b) => b.toString(16).padStart(2, "0"))
                    .join("");
                const hubHex = `hub(${syncHdr.length})=${hex(syncHdr)}`;
                const allBufs = [...boatBuf.current, ...planeBuf.current, ...singleBuf.current];
                const wsEntry = allBufs.find((e) => e.header);
                const wsHex = wsEntry?.header
                  ? `ws(${wsEntry.header.length})=${hex(wsEntry.header)}`
                  : "ws=null";
                let crossHit = 0;
                const allHubHeaders = encodedSyncHub.getAllSyncHeaders();
                const wsHeaders = allBufs.filter((e) => e.header).map((e) => e.header!);
                for (const hh of allHubHeaders) {
                  for (const wh of wsHeaders) {
                    if (headersMatch(hh, wh)) {
                      crossHit++;
                      break;
                    }
                  }
                  if (crossHit > 0) break;
                }
                headerDiagRef.current = `${hubHex} ${wsHex} cross=${crossHit}/${allHubHeaders.length}h×${wsHeaders.length}w`;
              }
            }
          }
        }

        /**
         * 对齐 base-vue drawDetectionBoxes：仅 sync 命中且有几何的单目标框才独占画面（findSingleRect）。
         * DDS 航迹号只影响标牌文案，不 gate 画框——画面双击 VisualTrackingTask 无 trackID 也应显示单框。
         */
        const singleEntry = resolveLayerForDisplay(
          singleBuf.current,
          syncHdr,
          singleMatchStateRef.current,
          now,
          false,
          syncHubWallMs ?? undefined,
          detectionDelayMsRef.current,
        );
        const findSingleRect =
          singleEntry != null && entryHasDrawableSingleRects(singleEntry);

        if (findSingleRect) {
          const mapped = mapSingleEntryToBoxes(singleEntry!);
          if (mapped.length > 0) {
            let displaySingle = lastSingleBoxesRef.current;
            if (
              displaySingle.length === 0 ||
              !singleBoxGeometryEqual(mapped, displaySingle)
            ) {
              displaySingle = mapped;
            }
            next.push(...displaySingle);
            lastSingleBoxesRef.current = displaySingle;
            singleNoneSyncTickRef.current = 0;
            syncMode = "header-single";
          }
        } else {
          lastSingleBoxesRef.current = [];
          resetDetectionMatchState(singleMatchStateRef.current);

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
          appendMultiFromEntries(boatEntry, planeEntry);
          if (next.length > 0) {
            syncMode = syncHdr ? "header-multi" : "multi-hold";
            multiNoneSyncTickRef.current = 0;
          }

          /**
           * wallMs / freshest 仅作 syncHeader 尚未命中时的 bootstrap（base-vue 无此路径）。
           */
          if (next.length === 0 && !syncHdr && hubSnapForWallMs && encodedSyncHub) {
            syncMode = "wallMs";
            syncDiagRef.current.wallMs++;
            const latestHub = encodedSyncHub.latestWallMs() ?? null;
            if (latestHub) {
              const allBufs = [...boatBuf.current, ...planeBuf.current, ...singleBuf.current];
              let latestReceivedAt = 0;
              for (const e of allBufs) {
                if (e.receivedAt > latestReceivedAt) latestReceivedAt = e.receivedAt;
              }
              if (latestReceivedAt > 0) {
                const sampleD = latestReceivedAt - latestHub;
                if (sampleD > 0 && sampleD < 10_000) {
                  const alpha = 0.1;
                  const n = detectionDelaySamplesRef.current;
                  if (n === 0) {
                    detectionDelayMsRef.current = sampleD;
                  } else {
                    detectionDelayMsRef.current =
                      alpha * sampleD + (1 - alpha) * detectionDelayMsRef.current;
                  }
                  detectionDelaySamplesRef.current = n + 1;
                }
              }
            }
            let frameWallMs = hubSnapForWallMs.wallMs;
            const rvfcTs = extractRvfcRtpTimestamp(rvfcMeta);
            const wcTs = webCodecsPresentationRefRef.current?.current?.lastRenderedRtpTimestamp;
            const pickTs =
              wcTs != null && wcTs > 0
                ? wcTs
                : rvfcTs;
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
            const fresh = pickMultiOnly((arr) => pickFreshest(arr, now));
            appendMultiFromEntries(fresh.boat, fresh.plane);
          }

          if (next.length > 0) {
            lastMultiBoxesRef.current = next;
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

        out = next;
      } catch {
        out = [];
      } finally {
        const jitterMs = lastJitterTargetMsRef.current >= 0 ? `jitter ${lastJitterTargetMsRef.current}ms · ` : "";
        const noTs = !hasCaptureTsRef.current ? " ⚠无captureTs" : "";
        const sd = syncDiagRef.current;
        const delayD = Math.round(detectionDelayMsRef.current);
        const syncInfo = `sync=${syncMode} pick=${syncHdrPickMode} clk=${presentationClk} hOk=${sd.headerOk} hF=${sd.headerFail} wMs=${sd.wallMs} fr=${sd.freshest} D=${delayD}ms`;
        const hdrDiag = headerDiagRef.current ? ` [${headerDiagRef.current}]` : "";
        const line = `检测 WS ${wsName} · buf ${boatBuf.current.length}/${planeBuf.current.length}/${singleBuf.current.length} · 框 ${out.length} · ${jitterMs}${syncInfo}${hdrDiag}${noTs}${
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
        if (!eoDetectionBoxesEqual(out, lastBoxesRef.current)) {
          lastBoxesRef.current = out;
          setBoxes(out);
        }
        tickingRef.current = false;
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
      if (!stopped && video && typeof video.requestVideoFrameCallback === "function") {
        frameCbId = video.requestVideoFrameCallback(runByFrame);
      }
    };

    const webCodecsSyncPath =
      isEoVideoWebCodecsCanvasEnabled() &&
      Boolean(encodedSyncHubRef.current) &&
      Boolean(webCodecsPresentationRefRef.current);
    const useWebCodecsPresentationClock = webCodecsSyncPath;

    const useVideoFrameClock =
      !useWebCodecsPresentationClock &&
      video &&
      typeof video.requestVideoFrameCallback === "function";

    if (useWebCodecsPresentationClock) {
      processAt(undefined);
      const tickWebCodecs = () => {
        if (stopped) return;
        const wc = webCodecsPresentationRefRef.current?.current;
        const ts = wc?.lastRenderedRtpTimestamp ?? 0;
        if (ts > 0 && ts !== lastWebCodecsRtpTs) {
          lastWebCodecsRtpTs = ts;
          processAt(undefined);
        }
        rafId = window.requestAnimationFrame(tickWebCodecs);
      };
      rafId = window.requestAnimationFrame(tickWebCodecs);
      /** reconfigure 黑屏期间 rAF 无新 ts，用定时器维持检测 */
      timer = window.setInterval(() => processAt(), RENDER_MS);
    } else if (useVideoFrameClock) {
      frameCbId = video!.requestVideoFrameCallback(runByFrame);
    } else {
      timer = window.setInterval(() => processAt(), RENDER_MS);
    }

    return () => {
      stopped = true;
      if (timer != null) window.clearInterval(timer);
      if (rafId != null) window.cancelAnimationFrame(rafId);
      if (frameCbId != null && video && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(frameCbId);
      }
    };
  }, [enabled, id, videoRef, webCodecsPresentationRef]);

  return {
    boxes: enabled && id ? boxes : EMPTY_DETECTION_BOXES,
    diag: enabled && id ? diag : "",
  };
}
