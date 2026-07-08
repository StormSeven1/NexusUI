import { shouldCutEoVideoHardwarePassthrough } from "@/lib/eo-video/eoVideoHardwarePassthrough";
import { createSyncHeaderFromEncodedFrame } from "@/lib/eo-video/detectionSyncUtils";

/** 编码帧数据（从 Insertable Streams 拦截后拷贝） */
export interface EncodedFrameData {
  data: ArrayBuffer;
  timestamp: number;
  type: "key" | "delta";
  receivedAt: number;
}

export interface EoEncodedSyncSnapshot {
  syncHeader: Uint8Array;
  wallMs: number;
}

const RING_CAP = 128;
/** 与 sei_poc_test 一致：RTP 近邻失败时用环上最新帧，不再固定滞后 6 帧 */
const DEFAULT_PRESENTATION_LAG_FRAMES = 0;
const PRESENTATION_WALL_STALE_MS = 3000;
/** 90kHz 下 25fps 约 3600 tick/帧；近邻匹配不超过 2 帧 */
export const EO_RTP_TICKS_PER_FRAME = 3600;
export const EO_RTP_MAX_NEAR_TICKS = EO_RTP_TICKS_PER_FRAME * 2;

type RingEntry = { syncHeader: Uint8Array; wallMs: number; rtpTimestamp: number };

function rtpClockDelta(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 0x100000000 - raw);
}

export interface EoEncodedSyncHub {
  pushFromEncodedFrame(encodedFrame: RTCEncodedVideoFrame): void;
  snapshotForPresentation(lagFrames?: number): EoEncodedSyncSnapshot | null;
  snapshotByWallMs(targetWallMs: number, maxDeltaMs?: number): EoEncodedSyncSnapshot | null;
  snapshotByRtpTimestamp(rtpTimestamp: number, maxClockDelta?: number): EoEncodedSyncSnapshot | null;
  latestWallMs(): number | null;
  /** 诊断：返回环中所有 syncHeader */
  getAllSyncHeaders(): Uint8Array[];
  clear(): void;
}

export function createEoEncodedSyncHub(): EoEncodedSyncHub {
  const ring: RingEntry[] = [];

  return {
    pushFromEncodedFrame(encodedFrame) {
      try {
        const raw = encodedFrame.data;
        if (raw == null) return;
        const buf = raw instanceof ArrayBuffer ? raw : (raw as ArrayBufferView).buffer;
        const src = new Uint8Array(
          buf,
          raw instanceof ArrayBuffer ? 0 : (raw as ArrayBufferView).byteOffset,
          raw instanceof ArrayBuffer ? buf.byteLength : (raw as ArrayBufferView).byteLength,
        );
        if (!src.byteLength) return;

        const algoHeader = createSyncHeaderFromEncodedFrame({
          data: raw instanceof ArrayBuffer ? raw : (raw as ArrayBufferView),
          timestamp: encodedFrame.timestamp,
        });

        ring.push({
          syncHeader: algoHeader,
          wallMs: Date.now(),
          rtpTimestamp: encodedFrame.timestamp ?? 0,
        });
        while (ring.length > RING_CAP) ring.shift();
      } catch {
        /* ignore */
      }
    },
    snapshotForPresentation(lagFrames = DEFAULT_PRESENTATION_LAG_FRAMES) {
      if (!ring.length) return null;
      const lag = Math.min(lagFrames, Math.max(0, ring.length - 1));
      const e = ring[ring.length - 1 - lag]!;
      const age = Date.now() - e.wallMs;
      if (age > PRESENTATION_WALL_STALE_MS || age < -60_000) return null;
      return { syncHeader: e.syncHeader, wallMs: e.wallMs };
    },
    snapshotByWallMs(targetWallMs: number, maxDeltaMs = 1500): EoEncodedSyncSnapshot | null {
      if (!ring.length) return null;
      let best: RingEntry | null = null;
      let bestDelta = Infinity;
      for (const e of ring) {
        const delta = Math.abs(e.wallMs - targetWallMs);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = e;
        }
      }
      if (!best || bestDelta > maxDeltaMs) return null;
      const age = Date.now() - best.wallMs;
      if (age > PRESENTATION_WALL_STALE_MS || age < -60_000) return null;
      return { syncHeader: best.syncHeader, wallMs: best.wallMs };
    },
    snapshotByRtpTimestamp(rtpTimestamp: number, maxClockDelta = EO_RTP_MAX_NEAR_TICKS) {
      if (!ring.length) return null;
      /** 从环尾向前：优先精确 RTP（与 rvfc / Canvas 显示帧一致） */
      for (let i = ring.length - 1; i >= 0; i--) {
        const e = ring[i]!;
        if (e.rtpTimestamp === rtpTimestamp) {
          const age = Date.now() - e.wallMs;
          if (age > PRESENTATION_WALL_STALE_MS || age < -60_000) return null;
          return { syncHeader: e.syncHeader, wallMs: e.wallMs };
        }
      }
      let best: RingEntry | null = null;
      let bestDelta = Infinity;
      for (let i = ring.length - 1; i >= 0; i--) {
        const e = ring[i]!;
        const delta = rtpClockDelta(e.rtpTimestamp, rtpTimestamp);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = e;
          if (delta === 0) break;
        }
      }
      if (!best || bestDelta > maxClockDelta) {
        const latest = ring[ring.length - 1]!;
        const age = Date.now() - latest.wallMs;
        if (age > PRESENTATION_WALL_STALE_MS || age < -60_000) return null;
        return { syncHeader: latest.syncHeader, wallMs: latest.wallMs };
      }
      const age = Date.now() - best.wallMs;
      if (age > PRESENTATION_WALL_STALE_MS || age < -60_000) return null;
      return { syncHeader: best.syncHeader, wallMs: best.wallMs };
    },
    latestWallMs() {
      return ring.length ? ring[ring.length - 1]!.wallMs : null;
    },
    getAllSyncHeaders() {
      return ring.map(e => e.syncHeader);
    },
    clear() {
      ring.length = 0;
    },
  };
}

type ReceiverWithStreams = RTCRtpReceiver & {
  createEncodedStreams?: () => {
    readable: ReadableStream<RTCEncodedVideoFrame>;
    writable: WritableStream<RTCEncodedVideoFrame>;
  };
};

function pushEncodedFrameSideEffects(
  encodedFrame: RTCEncodedVideoFrame,
  hub: EoEncodedSyncHub,
  onEncodedFrame?: (frame: EncodedFrameData) => void,
): void {
  hub.pushFromEncodedFrame(encodedFrame);
  if (!onEncodedFrame) return;
  try {
    const raw = encodedFrame.data;
    if (raw == null) return;
    const buf = raw instanceof ArrayBuffer ? raw : (raw as ArrayBufferView).buffer;
    const byteOffset = raw instanceof ArrayBuffer ? 0 : (raw as ArrayBufferView).byteOffset;
    const byteLength = raw instanceof ArrayBuffer ? buf.byteLength : (raw as ArrayBufferView).byteLength;
    const copied = buf.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
    const payload: EncodedFrameData = {
      data: copied,
      timestamp: encodedFrame.timestamp ?? 0,
      type: (encodedFrame as unknown as { type?: string }).type === "key" ? "key" : "delta",
      receivedAt: Date.now(),
    };
    /** 先拷贝再异步投递 WebCodecs，避免 transform 内同步 decode 调度阻塞 writable */
    queueMicrotask(() => {
      try {
        onEncodedFrame(payload);
       } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore copy errors */
  }
}

/**
 * WebRTC Insertable Streams：拦截编码帧写入 hub 的 syncHeader 环，并可选拷贝到 `onEncodedFrame`（WebCodecs Canvas）。
 * 默认仍将帧 enqueue 到 writable（`<video>` 硬件解码）；`NEXT_PUBLIC_EO_VIDEO_HARDWARE_PASSTHROUGH=false` 且 WebCodecs 时仅读环、不写 writable。
 *
 * 注意：hub syncHeader 来自浏览器 WebRTC 收到的编码 AU（ZLM 重打包），WS header 来自 camServer RTSP `avpkt`
 *（见 startplaybyffmpeg.cpp / DealTrackRect）。两路 bitstream 包界不同 → 诊断 cross 常为 0，需 wallMs/SEI/captureTs 对齐。
 */
export function attachEncodedVideoFrameSync(
  receiver: RTCRtpReceiver,
  hub: EoEncodedSyncHub,
  onEncodedFrame?: (frame: EncodedFrameData) => void,
  forceVideoPassthrough = false,
): () => void {
  const r = receiver as ReceiverWithStreams;
  if (typeof r.createEncodedStreams !== "function") {
    return () => {
      hub.clear();
    };
  }

  let readable: ReadableStream<RTCEncodedVideoFrame>;
  let writable: WritableStream<RTCEncodedVideoFrame>;
  try {
    const streams = r.createEncodedStreams();
    readable = streams.readable;
    writable = streams.writable;
  } catch {
    return () => {
      hub.clear();
    };
  }

  const cutPassthrough =
    shouldCutEoVideoHardwarePassthrough(Boolean(onEncodedFrame)) && !forceVideoPassthrough;
  const ac = new AbortController();

  if (cutPassthrough) {
    void (async () => {
      const reader = readable.getReader();
      try {
        while (!ac.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          pushEncodedFrameSideEffects(value, hub, onEncodedFrame);
        }
      } catch {
        /* abort / teardown */
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      ac.abort();
      hub.clear();
    };
  }

  const transform = new TransformStream<RTCEncodedVideoFrame, RTCEncodedVideoFrame>({
    transform(encodedFrame, controller) {
      /** 先 passthrough 给 `<video>` 解码，再写 sync 环（对齐 sei_poc_test，减少观感延迟） */
      controller.enqueue(encodedFrame);
      pushEncodedFrameSideEffects(encodedFrame, hub, onEncodedFrame);
    },
  });

  void readable.pipeThrough(transform).pipeTo(writable, { signal: ac.signal }).catch(() => {
    /* abort / teardown */
  });

  return () => {
    ac.abort();
    hub.clear();
  };
}
