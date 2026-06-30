import { createSyncHeaderFromEncodedFrame } from "@/lib/eo-video/detectionSyncUtils";

/**
 * Encoded-frame 同步中心。
 *
 * 这个文件不负责播放视频，也不负责画检测框。
 * 它只负责维护“视频帧同步头缓存”，是 `EoVideoViewport` 内联播放逻辑 和
 * `useEoSyncedDetections` 之间的桥梁。
 *
 * 调用关系：
 * - `EoVideoModal` 创建 `encodedSyncHub`
 * - `EoVideoViewport` 在收到 encoded video frame 后，把同步头写入这个 hub
 * - `useEoSyncedDetections` 在决定当前该显示哪一批检测框时，
 *   再从这个 hub 里取“当前展示帧附近”的同步头
 *
 * 作用：
 * - 从 WebRTC 编码帧中抽取一个轻量同步头
 * - 用 ring buffer 暂存最近若干帧的同步头
 * - 给检测框同步逻辑提供一个“当前应该参考哪一帧”的候选头信息
 */

export interface EncodedFrameData {
  data: ArrayBuffer;
  timestamp: number;
  type: "key" | "delta";
  receivedAt: number;
}

type RingEntry = {
  syncHeader: Uint8Array;
  wallMs: number;
  rtpTimestamp: number;
};

export interface EoEncodedSyncSnapshot {
  syncHeader: Uint8Array;
  wallMs: number;
}

export interface EoEncodedSyncHub {
  pushFromEncodedFrame(encodedFrame: RTCEncodedVideoFrame): void;
  snapshotForPresentation(lagFrames?: number): EoEncodedSyncSnapshot | null;
  latestWallMs(): number | null;
  clear(): void;
}

const RING_CAP = 128;
const DEFAULT_PRESENTATION_LAG_FRAMES = 6;

export function createEoEncodedSyncHub(): EoEncodedSyncHub {
  const ring: RingEntry[] = [];
  return {
    pushFromEncodedFrame(encodedFrame) {
      const raw = encodedFrame.data;
      if (!raw) return;
      const header = createSyncHeaderFromEncodedFrame({
        data: raw instanceof ArrayBuffer ? raw : (raw as ArrayBufferView),
        timestamp: encodedFrame.timestamp,
      });
      ring.push({
        syncHeader: header,
        wallMs: Date.now(),
        rtpTimestamp: encodedFrame.timestamp ?? 0,
      });
      while (ring.length > RING_CAP) ring.shift();
    },
    snapshotForPresentation(lagFrames = DEFAULT_PRESENTATION_LAG_FRAMES) {
      if (!ring.length) return null;
      const lag = Math.min(lagFrames, Math.max(0, ring.length - 1));
      const item = ring[ring.length - 1 - lag];
      return item ? { syncHeader: item.syncHeader, wallMs: item.wallMs } : null;
    },
    latestWallMs() {
      return ring.length ? ring[ring.length - 1]?.wallMs ?? null : null;
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

export function attachEncodedVideoFrameSync(
  receiver: RTCRtpReceiver,
  hub: EoEncodedSyncHub,
  onEncodedFrame?: (frame: EncodedFrameData) => void,
): () => void {
  const typedReceiver = receiver as ReceiverWithStreams;
  if (typeof typedReceiver.createEncodedStreams !== "function") {
    return () => {
      hub.clear();
    };
  }
  const streams = typedReceiver.createEncodedStreams();
  const abortController = new AbortController();
  const transform = new TransformStream<RTCEncodedVideoFrame, RTCEncodedVideoFrame>({
    transform(encodedFrame, controller) {
      hub.pushFromEncodedFrame(encodedFrame);
      if (onEncodedFrame) {
        const raw = encodedFrame.data;
        if (raw) {
          const view = raw as ArrayBuffer | ArrayBufferView;
          const buffer =
            view instanceof ArrayBuffer
              ? view.slice(0)
              : view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
          onEncodedFrame({
            data: buffer as ArrayBuffer,
            timestamp: encodedFrame.timestamp ?? 0,
            type: (encodedFrame as unknown as { type?: string }).type === "key" ? "key" : "delta",
            receivedAt: Date.now(),
          });
        }
      }
      controller.enqueue(encodedFrame);
    },
  });
  void streams.readable.pipeThrough(transform).pipeTo(streams.writable, { signal: abortController.signal }).catch(() => {});
  return () => {
    abortController.abort();
    hub.clear();
  };
}
