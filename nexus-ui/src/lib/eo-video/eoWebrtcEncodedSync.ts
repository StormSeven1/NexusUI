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
const DEFAULT_PRESENTATION_LAG_FRAMES = 6;
const PRESENTATION_WALL_STALE_MS = 3000;

type RingEntry = { syncHeader: Uint8Array; wallMs: number; rtpTimestamp: number };

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
    snapshotByRtpTimestamp(rtpTimestamp: number, maxClockDelta = 9000): EoEncodedSyncSnapshot | null {
      if (!ring.length) return null;
      let best: RingEntry | null = null;
      let bestDelta = Infinity;
      for (const e of ring) {
        const raw = Math.abs(e.rtpTimestamp - rtpTimestamp);
        const delta = Math.min(raw, 0x100000000 - raw);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = e;
        }
      }
      if (!best || bestDelta > maxClockDelta) return null;
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

/**
 * WebRTC Insertable Streams：拦截编码帧，拷贝到 frameBuffer 回调（供 WebCodecs 解码），
 * **不再 passthrough**（因为我们用 WebCodecs+Canvas 自行解码，不再依赖 <video>）。
 * 同时写入 hub 的 syncHeader 环以备回退。
 */
export function attachEncodedVideoFrameSync(
  receiver: RTCRtpReceiver,
  hub: EoEncodedSyncHub,
  onEncodedFrame?: (frame: EncodedFrameData) => void,
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

  const transform = new TransformStream<RTCEncodedVideoFrame, RTCEncodedVideoFrame>({
    transform(encodedFrame, controller) {
      hub.pushFromEncodedFrame(encodedFrame);

      if (onEncodedFrame) {
        try {
          const raw = encodedFrame.data;
          if (raw != null) {
            const buf = raw instanceof ArrayBuffer ? raw : (raw as ArrayBufferView).buffer;
            const byteOffset = raw instanceof ArrayBuffer ? 0 : (raw as ArrayBufferView).byteOffset;
            const byteLength = raw instanceof ArrayBuffer ? buf.byteLength : (raw as ArrayBufferView).byteLength;
            const copied = buf.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
            onEncodedFrame({
              data: copied,
              timestamp: encodedFrame.timestamp ?? 0,
              type: (encodedFrame as unknown as { type?: string }).type === "key" ? "key" : "delta",
              receivedAt: Date.now(),
            });
          }
        } catch {
          /* ignore copy errors */
        }
      }

      // 仍然 passthrough，让 <video> 也能作为回退显示
      controller.enqueue(encodedFrame);
    },
  });

  const ac = new AbortController();
  void readable.pipeThrough(transform).pipeTo(writable, { signal: ac.signal }).catch(() => {
    /* abort / teardown */
  });

  return () => {
    ac.abort();
    hub.clear();
  };
}
