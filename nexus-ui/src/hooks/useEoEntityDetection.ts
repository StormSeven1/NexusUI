"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { canonicalEntityId } from "@/lib/camera-entity-id";
import {
  shouldCutEoVideoHardwarePassthrough,
} from "@/lib/eo-video/eoVideoHardwarePassthrough";
import { isEoVideoWebCodecsCanvasEnabled } from "@/lib/eo-video/eoVideoWebCodecsCanvas";
import type { BufferedDetectionEntry } from "@/lib/eo-video/eoDetectionTypes";
import type { EoEncodedSyncHub } from "@/lib/eo-video/eoWebrtcEncodedSync";
import {
  eoDetectionBoxesEqual,
  headersMatch,
  detectionRectsToEoBoxes,
  resolveDetectionFrameSize,
} from "@/lib/eo-video/detectionSyncUtils";
import { getEoDetectionWebSocketManager } from "@/lib/eo-video/eoDetectionWebSocket";
import { ingestEntityDetectionPayload } from "@/lib/eo-video/entityDetectionIngest";
import {
  EO_CAMERA_DDS_EXECUTING_HOLD_MS,
  useEoCameraDdsHeldTrackUi,
} from "@/lib/eo-video/eoCameraDdsUiHold";
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
/** 非跟踪态 / 无 DDS 航迹时的单目标 WS 包有效年龄 */
const SINGLE_TRACK_STALE_MS = 480;
/** WS 显式空框后，该窗口内忽略 syncHeader 命中的旧有框包（告警清除） */
const EXPLICIT_CLEAR_HONOR_MS = 400;
/** 单目标 sync 仅扫描最近几帧 hub header，对齐 Qt 只用当前显示帧 index 匹配 */
const SINGLE_HEADER_MATCH_LAG_FRAMES = [0, 1, 2, 3] as const;
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
  const lastBoxesRef = useRef<EoDetectionBox[]>([]);

  const onDiagnosticRef = useRef(onDiagnostic);
  const expandedModeRef = useRef(expandedMode);
  const ddsLookupIdRef = useRef("");
  const ddsTrackIdForUiRef = useRef<number | null>(null);
  const ddsAliasStrRef = useRef("");
  const singleTrackOverlayTitleRef = useRef<string | null>(null);
  const encodedSyncHubRef = useRef(encodedSyncHub);

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
      try {
        const next: EoDetectionBox[] = [];
        const now = Date.now();
        const singleTrackMode = ddsTrackIdForUi != null;
        const singleExplicitlyCleared = isLayerExplicitlyCleared(singleBuf.current, now);
        const boatExplicitlyCleared = isLayerExplicitlyCleared(boatBuf.current, now);
        const planeExplicitlyCleared = isLayerExplicitlyCleared(planeBuf.current, now);

        if (singleExplicitlyCleared) {
          lastSingleBoxesRef.current = [];
          singleNoneSyncTickRef.current = SINGLE_TRACK_SYNC_MISS_CLEAR_TICKS;
        } else if (!singleTrackMode) {
          lastSingleBoxesRef.current = [];
          singleNoneSyncTickRef.current = 0;
        }

        if (boatExplicitlyCleared || planeExplicitlyCleared) {
          lastMultiBoxesRef.current = lastMultiBoxesRef.current.filter((b) => {
            if (boatExplicitlyCleared && b.id.startsWith("boat-")) return false;
            if (planeExplicitlyCleared && b.id.startsWith("plane-")) return false;
            return true;
          });
          multiNoneSyncTickRef.current = MAX_HEADER_MISS;
        }

        /** 跟踪态（含 DDS 3s 滞回）：单目标包与上一帧框均可保留至 3s，避免 sync 抖动误清 */
        const singleEntryMaxAgeMs = singleTrackMode
          ? EO_CAMERA_DDS_EXECUTING_HOLD_MS
          : SINGLE_TRACK_STALE_MS;

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

        const buildBoxes = (
          picker: (arr: BufferedDetectionEntry[]) => BufferedDetectionEntry | null,
        ) => {
          const ddsRow = ddsLookupId
            ? useEoCameraDdsStatusStore.getState().byEntityId[ddsLookupId]
            : undefined;
          const ddAz = finiteFromDdsField(ddsRow?.azimuth);
          const ddCourse = finiteFromDdsField(ddsRow?.course);
          const ddSpeed = finiteFromDdsField(ddsRow?.speed);
          const ddDist = finiteFromDdsField(ddsRow?.distance);

          let pickedSingle = picker(singleBuf.current);
          if (
            singleExplicitlyCleared &&
            pickedSingle &&
            !isExplicitEmptyEntry(pickedSingle)
          ) {
            pickedSingle = null;
          }
          let singleEntry: BufferedDetectionEntry | null = null;
          if (pickedSingle && !isExplicitEmptyEntry(pickedSingle)) {
            const age = now - pickedSingle.receivedAt;
            if (age <= singleEntryMaxAgeMs) {
              singleEntry = pickedSingle;
            } else if (singleTrackMode && age <= DETECTION_ENTRY_STALE_MS) {
              singleEntry = pickedSingle;
            }
          }
          const singleBoxesRaw = boxesFromEntry(singleEntry, "single", "", "accent");
          const ex = expandedMode;
          const mapSingleBoxes =
            singleBoxesRaw.length > 0
              ? singleBoxesRaw.map((b) => {
                  const meta = singleEntry?.singleDisplayMeta;
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
                    rawT === "空"
                      ? "空"
                      : rawT === "海"
                        ? "海"
                        : byTrack ?? lastSingleTypeRef.current ?? "海";
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
                })
              : [];
          const singleBoxes = mapSingleBoxes;
          if (singleBoxes.length > 0) {
            next.push(...singleBoxes);
            lastSingleBoxesRef.current = singleBoxes;
          } else if (singleTrackMode) {
            if (lastSingleBoxesRef.current.length > 0) {
              next.push(...lastSingleBoxesRef.current);
            }
          } else {
            const pickLayer = (
              arr: BufferedDetectionEntry[],
              prefix: "boat" | "plane",
              cleared: boolean,
            ): BufferedDetectionEntry | null => {
              const picked = picker(arr);
              if (cleared && picked && !isExplicitEmptyEntry(picked)) return null;
              if (picked && isExplicitEmptyEntry(picked)) return null;
              return picked;
            };
            if (!boatExplicitlyCleared) {
              next.push(...boxesFromEntry(pickLayer(boatBuf.current, "boat", boatExplicitlyCleared), "boat", "海", "friendly"));
            }
            if (!planeExplicitlyCleared) {
              next.push(...boxesFromEntry(pickLayer(planeBuf.current, "plane", planeExplicitlyCleared), "plane", "空", "hostile"));
            }
          }
        };

        const bufHasHeader =
          hasAnyHeader(boatBuf.current, now) ||
          hasAnyHeader(planeBuf.current, now) ||
          hasAnyHeader(singleBuf.current, now);

        const hubSnapForWallMs =
          encodedSyncHub?.snapshotForPresentation(0) ??
          encodedSyncHub?.snapshotForPresentation(6) ??
          null;

        let headerMatchedThisTick = false;
        let singleHeaderMatchedThisTick = false;

        if (encodedSyncHub && bufHasHeader && (headerEverMatchedRef.current || syncDiagRef.current.headerFail < 60)) {
          const HEADER_MATCH_LAG_FRAMES = singleTrackMode
            ? SINGLE_HEADER_MATCH_LAG_FRAMES
            : ([0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15] as const);
          for (const lag of HEADER_MATCH_LAG_FRAMES) {
            const snap = encodedSyncHub.snapshotForPresentation(lag);
            if (!snap?.syncHeader) continue;
            const hdr = snap.syncHeader;
            const tryMatch = (arr: BufferedDetectionEntry[]): BufferedDetectionEntry | null =>
              pickBySyncHeader(arr, hdr, now);
            const testHit = singleTrackMode
              ? tryMatch(singleBuf.current)
              : tryMatch(boatBuf.current) ?? tryMatch(planeBuf.current) ?? tryMatch(singleBuf.current);
            if (
              testHit &&
              (!singleTrackMode || !isExplicitEmptyEntry(testHit))
            ) {
              headerMatchedThisTick = true;
              if (singleTrackMode) singleHeaderMatchedThisTick = true;
              headerEverMatchedRef.current = true;
              syncMode = singleTrackMode ? "header-single" : "header";
              syncDiagRef.current.headerOk++;
              if (singleTrackMode) singleNoneSyncTickRef.current = 0;
              if (!singleTrackMode) multiNoneSyncTickRef.current = 0;
              buildBoxes(tryMatch);
              break;
            }
          }

          if (!headerMatchedThisTick) {
            syncDiagRef.current.headerFail++;
            if (!headerDiagRef.current) {
              const hex = (u: Uint8Array) => Array.from(u.slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join("");
              const snapDiag = encodedSyncHub.snapshotForPresentation(0) ?? encodedSyncHub.snapshotForPresentation(6);
              const currentSyncHeader = snapDiag?.syncHeader ?? null;
              const hubHex = currentSyncHeader ? `hub(${currentSyncHeader.length})=${hex(currentSyncHeader)}` : "hub=∅";
              const allBufs = [...boatBuf.current, ...planeBuf.current, ...singleBuf.current];
              const wsEntry = allBufs.find((e) => e.header);
              const wsHex = wsEntry?.header ? `ws(${wsEntry.header.length})=${hex(wsEntry.header)}` : "ws=null";

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

        /**
         * 单目标跟踪：优先 syncHeader；未对齐时先用 3s 内 WS 包 / 上一帧框兜底，
         * 连续多 tick 仍无有效单目标且 sync 持续失败才清框（相机运动场景）。
         */
        if (singleTrackMode && !singleHeaderMatchedThisTick && !singleExplicitlyCleared) {
          if (next.length === 0) {
            buildBoxes((arr) => {
              const fresh = pickFreshest(arr, now);
              if (!fresh || isExplicitEmptyEntry(fresh)) return null;
              const age = now - fresh.receivedAt;
              return age <= EO_CAMERA_DDS_EXECUTING_HOLD_MS ? fresh : null;
            });
            if (next.length > 0) {
              singleNoneSyncTickRef.current = 0;
              syncMode = "single-fresh-fallback";
            }
          }

          if (next.length === 0 && lastSingleBoxesRef.current.length > 0) {
            next.push(...lastSingleBoxesRef.current);
            syncMode = "single-last-hold";
          }

          if (next.length === 0) {
            const canSyncSingle =
              Boolean(encodedSyncHub) && hasAnyHeader(singleBuf.current, now);
            if (canSyncSingle) {
              singleNoneSyncTickRef.current++;
              if (singleNoneSyncTickRef.current >= SINGLE_TRACK_SYNC_MISS_CLEAR_TICKS) {
                singleNoneSyncTickRef.current = 0;
                lastSingleBoxesRef.current = [];
                syncMode = "single-miss-clear";
              } else {
                syncMode = `single-miss-wait(${singleNoneSyncTickRef.current})`;
              }
            }
          } else {
            singleNoneSyncTickRef.current = 0;
          }
        } else if (!singleTrackMode && !headerMatchedThisTick && hubSnapForWallMs) {
          syncMode = "wallMs";
          syncDiagRef.current.wallMs++;

          const latestHub = encodedSyncHub?.latestWallMs() ?? null;
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
          if (rvfcMeta && typeof (rvfcMeta as unknown as Record<string, unknown>).rtpTimestamp === "number") {
            const rtpTs = (rvfcMeta as unknown as Record<string, unknown>).rtpTimestamp as number;
            const byRtp = encodedSyncHub?.snapshotByRtpTimestamp(rtpTs);
            if (byRtp) frameWallMs = byRtp.wallMs;
          }

          const targetReceivedAt = frameWallMs + detectionDelayMsRef.current;
          buildBoxes((arr) => pickByReceivedAt(arr, now, targetReceivedAt));
        }

        if (!singleTrackMode && next.length === 0 && !headerMatchedThisTick) {
          if (syncMode === "none") syncMode = "freshest";
          else syncMode += "→fresh";
          syncDiagRef.current.freshest++;
          buildBoxes((arr) => pickFreshest(arr, now));
        }

        if (!singleTrackMode) {
          if (next.length > 0) {
            lastMultiBoxesRef.current = next;
            multiNoneSyncTickRef.current = 0;
          } else if (
            !boatExplicitlyCleared &&
            !planeExplicitlyCleared &&
            lastMultiBoxesRef.current.length > 0
          ) {
            const canSyncMulti =
              Boolean(encodedSyncHub) && bufHasHeader;
            if (canSyncMulti) {
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
        }

        out = next;
      } catch {
        out = [];
      } finally {
        const jitterMs = lastJitterTargetMsRef.current >= 0 ? `jitter ${lastJitterTargetMsRef.current}ms · ` : "";
        const noTs = !hasCaptureTsRef.current ? " ⚠无captureTs" : "";
        const sd = syncDiagRef.current;
        const delayD = Math.round(detectionDelayMsRef.current);
        const syncInfo = `sync=${syncMode} hOk=${sd.headerOk} hF=${sd.headerFail} wMs=${sd.wallMs} fr=${sd.freshest} D=${delayD}ms`;
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
    let stopped = false;

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

    const useVideoFrameClock =
      !shouldCutEoVideoHardwarePassthrough(
        isEoVideoWebCodecsCanvasEnabled() && Boolean(encodedSyncHubRef.current),
      ) &&
      video &&
      typeof video.requestVideoFrameCallback === "function";

    if (useVideoFrameClock) {
      frameCbId = video!.requestVideoFrameCallback(runByFrame);
    } else {
      timer = window.setInterval(() => processAt(), RENDER_MS);
    }

    return () => {
      stopped = true;
      if (timer != null) window.clearInterval(timer);
      if (frameCbId != null && video && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(frameCbId);
      }
    };
  }, [enabled, id, videoRef]);

  return {
    boxes: enabled && id ? boxes : EMPTY_DETECTION_BOXES,
    diag: enabled && id ? diag : "",
  };
}
