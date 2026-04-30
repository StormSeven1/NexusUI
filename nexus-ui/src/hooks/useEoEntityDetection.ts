"use client";

import { useEffect, useRef, useState } from "react";
import { canonicalEntityId } from "@/lib/camera-entity-id";
import type { BufferedDetectionEntry } from "@/lib/eo-video/eoDetectionTypes";
import type { EoEncodedSyncHub } from "@/lib/eo-video/eoWebrtcEncodedSync";
import { headersMatch, detectionRectsToEoBoxes } from "@/lib/eo-video/detectionSyncUtils";
import { getEoDetectionWebSocketManager } from "@/lib/eo-video/eoDetectionWebSocket";
import { ingestEntityDetectionPayload } from "@/lib/eo-video/entityDetectionIngest";
import type { EoDetectionBox } from "@/lib/eo-video/types";

const RENDER_MS = 40;
const DETECTION_ENTRY_STALE_MS = 2000;
const MAX_HEADER_MISS = 20;

/**
 * syncHeader 精确匹配（与 base-vue headersMatch 一致）。
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

export interface UseEoEntityDetectionOptions {
  entityId: string | undefined;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  encodedSyncHub?: EoEncodedSyncHub;
  videoReceiverRef?: React.MutableRefObject<RTCRtpReceiver | null>;
  enabled: boolean;
  onDiagnostic?: (line: string, hoverDetail?: string) => void;
}

export function useEoEntityDetection({
  entityId,
  videoRef,
  encodedSyncHub,
  videoReceiverRef,
  enabled,
  onDiagnostic,
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

  const headerMissRef = useRef<{
    boat: { last: BufferedDetectionEntry | null; fails: number };
    plane: { last: BufferedDetectionEntry | null; fails: number };
    single: { last: BufferedDetectionEntry | null; fails: number };
  }>({
    boat: { last: null, fails: 0 },
    plane: { last: null, fails: 0 },
    single: { last: null, fails: 0 },
  });
  const headerEverMatchedRef = useRef(false);

  const syncDiagRef = useRef({ headerOk: 0, headerFail: 0, wallMs: 0, freshest: 0 });
  const headerDiagRef = useRef("");
  /**
   * 检测延迟 D（ms）= 最新检测包 receivedAt - 编码帧环最新帧 wallMs。
   * 后端先推编码帧（wallMs），经过检测算法后才推检测结果（receivedAt），差值就是 D。
   * 渲染时：当前显示帧 wallMs + D ≈ 对应检测包的 receivedAt。
   */
  const detectionDelayMsRef = useRef(0);
  const detectionDelaySamplesRef = useRef(0);

  const id = entityId?.trim() ? canonicalEntityId(entityId.trim()) : "";

  useEffect(() => {
    boatBuf.current = [];
    planeBuf.current = [];
    singleBuf.current = [];
    captureToDisplayOffsetMsRef.current = 0;
    hasCaptureTsRef.current = false;
    headerMissRef.current = {
      boat: { last: null, fails: 0 },
      plane: { last: null, fails: 0 },
      single: { last: null, fails: 0 },
    };
    headerEverMatchedRef.current = false;
    syncDiagRef.current = { headerOk: 0, headerFail: 0, wallMs: 0, freshest: 0 };
    headerDiagRef.current = "";
    setBoxes([]);
    setDiag("");
  }, [id]);

  useEffect(() => {
    if (!enabled || !id) return;
    const mgr = getEoDetectionWebSocketManager();
    return mgr.subscribe(id, (data) => {
      ingestEntityDetectionPayload(data, boatBuf.current, planeBuf.current, singleBuf.current);
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
      const mgr = getEoDetectionWebSocketManager();
      const rs = mgr.getWsReadyState();
      const wsName = rs >= 0 && rs < 4 ? WS_LABEL[rs] : "?";
      const wsDbg = mgr.getLastWsInboundDebugForUi();

      let out: EoDetectionBox[] = [];
      let syncMode = "none";
      try {
        const next: EoDetectionBox[] = [];
        const now = Date.now();

        const boxesFromEntry = (
          entry: BufferedDetectionEntry | null,
          idPrefix: "boat" | "plane" | "single",
          label: string,
          color: "friendly" | "hostile" | "accent",
        ): EoDetectionBox[] => {
          if (!entry?.videoRects?.length) return [];
          const vw = entry.videoWidth || video?.videoWidth || 0;
          const vh = entry.videoHeight || video?.videoHeight || 0;
          return detectionRectsToEoBoxes(entry.videoRects, vw, vh, idPrefix, label, color);
        };

        const buildBoxes = (
          picker: (arr: BufferedDetectionEntry[]) => BufferedDetectionEntry | null,
        ) => {
          const singleEntry = picker(singleBuf.current);
          const singleBoxesRaw = boxesFromEntry(singleEntry, "single", "跟踪", "accent");
          const singleBoxes = singleBoxesRaw.map((b) => ({ ...b, variant: "singleTrack" as const }));
          if (singleBoxes.length > 0) {
            next.push(...singleBoxes);
          } else {
            next.push(...boxesFromEntry(picker(boatBuf.current), "boat", "海", "friendly"));
            next.push(...boxesFromEntry(picker(planeBuf.current), "plane", "空", "hostile"));
          }
        };

        /**
         * 策略优先级：
         * 1. syncHeader 逐字节匹配（最精确，与 base-vue 完全一致）
         * 2. 编码帧环 wallMs 时间对齐（hub 有数据但 header 不兼容时）
         * 3. 取最新包（都不可用时）
         */

        // —— 策略 1：syncHeader 匹配
        const snapshot = encodedSyncHub?.snapshotForPresentation();
        const currentSyncHeader = snapshot?.syncHeader ?? null;
        const bufHasHeader =
          hasAnyHeader(boatBuf.current, now) ||
          hasAnyHeader(planeBuf.current, now) ||
          hasAnyHeader(singleBuf.current, now);

        let headerMatchedThisTick = false;

        if (currentSyncHeader && bufHasHeader && (headerEverMatchedRef.current || syncDiagRef.current.headerFail < 60)) {
          const tryMatch = (arr: BufferedDetectionEntry[]): BufferedDetectionEntry | null => {
            return pickBySyncHeader(arr, currentSyncHeader, now);
          };
          const testHit =
            tryMatch(boatBuf.current) ?? tryMatch(planeBuf.current) ?? tryMatch(singleBuf.current);
          if (testHit) {
            headerMatchedThisTick = true;
            headerEverMatchedRef.current = true;
            syncMode = "header";
            syncDiagRef.current.headerOk++;
            buildBoxes(tryMatch);
          } else {
            syncDiagRef.current.headerFail++;
            if (!headerDiagRef.current) {
              const hex = (u: Uint8Array) => Array.from(u.slice(0, 8)).map(b => b.toString(16).padStart(2, "0")).join("");
              const hubHex = currentSyncHeader ? `hub(${currentSyncHeader.length})=${hex(currentSyncHeader)}` : "hub=∅";
              const allBufs = [...boatBuf.current, ...planeBuf.current, ...singleBuf.current];
              const wsEntry = allBufs.find(e => e.header);
              const wsHex = wsEntry?.header ? `ws(${wsEntry.header.length})=${hex(wsEntry.header)}` : "ws=null";

              // 暴力交叉匹配诊断：hub 环中任意帧 vs WS 缓冲中任意条
              let crossHit = 0;
              const allHubHeaders = encodedSyncHub?.getAllSyncHeaders() ?? [];
              const wsHeaders = allBufs.filter(e => e.header).map(e => e.header!);
              for (const hh of allHubHeaders) {
                for (const wh of wsHeaders) {
                  if (headersMatch(hh, wh)) { crossHit++; break; }
                }
                if (crossHit > 0) break;
              }

              headerDiagRef.current = `${hubHex} ${wsHex} cross=${crossHit}/${allHubHeaders.length}h×${wsHeaders.length}w`;
            }
          }
        }

        // —— 策略 2：编码帧环 wallMs + 检测延迟补偿
        if (!headerMatchedThisTick && snapshot) {
          syncMode = "wallMs";
          syncDiagRef.current.wallMs++;

          // 估算检测延迟 D：最新检测包 receivedAt - 编码帧环最新帧 wallMs
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

          let frameWallMs = snapshot.wallMs;
          if (rvfcMeta && typeof (rvfcMeta as unknown as Record<string, unknown>).rtpTimestamp === "number") {
            const rtpTs = (rvfcMeta as unknown as Record<string, unknown>).rtpTimestamp as number;
            const byRtp = encodedSyncHub!.snapshotByRtpTimestamp(rtpTs);
            if (byRtp) frameWallMs = byRtp.wallMs;
          }

          // 核心：当前显示帧 wallMs + D ≈ 对应检测包的 receivedAt
          const targetReceivedAt = frameWallMs + detectionDelayMsRef.current;
          buildBoxes((arr) => pickByReceivedAt(arr, now, targetReceivedAt));
        }

        // —— 策略 3：取最新包
        if (next.length === 0 && !headerMatchedThisTick) {
          if (syncMode === "none") syncMode = "freshest";
          else syncMode += "→fresh";
          syncDiagRef.current.freshest++;
          buildBoxes((arr) => pickFreshest(arr, now));
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
        setDiag(line);
        setBoxes(out);
        const hover = [line, wsDbg.rawForTitle].filter(Boolean).join("\n\n");
        onDiagnostic?.(line, hover || undefined);
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

          if (videoReceiverRef) {
            const receiver = videoReceiverRef.current as (RTCRtpReceiver & { jitterBufferTarget?: number | null }) | null;
            if (receiver && typeof receiver.jitterBufferTarget !== "undefined") {
              const targetMs = Math.min(Math.max(0, Math.round(captureToDisplayOffsetMsRef.current) - 100), 3000);
              const changed = Math.abs(targetMs - lastJitterTargetMsRef.current) > 100;
              const cooldown = wallClockMs - lastJitterUpdateMsRef.current > 8000;
              if (changed && cooldown) {
                receiver.jitterBufferTarget = targetMs / 1000;
                lastJitterTargetMsRef.current = targetMs;
                lastJitterUpdateMsRef.current = wallClockMs;
              }
            }
          }
        }
      }

      processAt(meta);
      if (!stopped && video && typeof video.requestVideoFrameCallback === "function") {
        frameCbId = video.requestVideoFrameCallback(runByFrame);
      }
    };

    if (video && typeof video.requestVideoFrameCallback === "function") {
      frameCbId = video.requestVideoFrameCallback(runByFrame);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- encodedSyncHub 稳定引用，不影响逻辑
  }, [enabled, id, onDiagnostic, videoReceiverRef, videoRef]);

  return {
    boxes: enabled && id ? boxes : [],
    diag: enabled && id ? diag : "",
  };
}
