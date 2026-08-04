"use client";

import { parseThirdPartyWsFrame } from "@/lib/eo-video/thirdPartyCameraWsFrame";
import { normThirdPartyEntityId } from "@/lib/eo-video/thirdPartyEntityId";

export { normThirdPartyEntityId } from "@/lib/eo-video/thirdPartyEntityId";

export function resolveThirdPartyCameraWsUrl(): string {
  const explicit =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_EO_THIRD_PARTY_CAMERA_WS_URL?.trim() : "";
  if (explicit) return explicit;
  if (typeof window === "undefined") return "";
  const port = process.env.NEXT_PUBLIC_EO_THIRD_PARTY_CAMERA_WS_PORT?.trim() || "40777";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.hostname}:${port}`;
}

type HubListener = {
  onDevStatusBasic?: (payload: Record<string, unknown>) => void;
  /** 仅需 entity / 检测框（地图、告警）；中继侧不拷贝 YUV */
  onBinaryFrameMeta?: (frame: NonNullable<ReturnType<typeof parseThirdPartyWsFrame>>) => void;
  /** 光电 UDP 画面：需 YUV，解析时拷贝一份（与 meta 监听互斥使用为宜） */
  onBinaryFrameVideo?: (frame: NonNullable<ReturnType<typeof parseThirdPartyWsFrame>>) => void;
  /** @deprecated 请用 onBinaryFrameMeta / onBinaryFrameVideo */
  onBinaryFrame?: (frame: NonNullable<ReturnType<typeof parseThirdPartyWsFrame>>) => void;
};

type HubState = {
  ws: WebSocket | null;
  closed: boolean;
  retries: number;
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<HubListener>;
  /** 主线程忙时按 entity 只保留最新一帧，避免 FIFO 播旧帧导致延迟越来越大 */
  pendingBinaryByEntity: Map<string, ArrayBuffer>;
  flushScheduled: boolean;
};

const hub: HubState = {
  ws: null,
  closed: false,
  retries: 0,
  timer: null,
  listeners: new Set(),
  pendingBinaryByEntity: new Map(),
  flushScheduled: false,
};

/** 轻量窥探 NXT1 entityId，不拷贝 YUV */
function peekNxt1EntityId(buf: ArrayBuffer): string {
  if (buf.byteLength < 6) return "";
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0x4e || u8[1] !== 0x58 || u8[2] !== 0x54 || u8[3] !== 0x31) return "";
  const dv = new DataView(buf);
  const elen = dv.getUint16(4, true);
  if (elen < 1 || 6 + elen > buf.byteLength) return "";
  return new TextDecoder("utf-8", { fatal: false }).decode(u8.subarray(6, 6 + elen)).trim().toLowerCase();
}

function dispatchBinaryFrame(buf: ArrayBuffer): void {
  let metaParsed: ReturnType<typeof parseThirdPartyWsFrame> = null;
  let videoParsed: ReturnType<typeof parseThirdPartyWsFrame> = null;
  let needsMetaOnly = false;
  let needsVideo = false;
  for (const l of hub.listeners) {
    if (l.onBinaryFrameMeta) needsMetaOnly = true;
    if (l.onBinaryFrameVideo || l.onBinaryFrame) needsVideo = true;
  }
  if (needsMetaOnly) {
    metaParsed = parseThirdPartyWsFrame(buf, { copyYuv: false });
    if (!metaParsed) return;
  }
  if (needsVideo) {
    videoParsed = parseThirdPartyWsFrame(buf, { copyYuv: true });
    if (!videoParsed) return;
  }
  for (const l of hub.listeners) {
    if (l.onBinaryFrameMeta && metaParsed) l.onBinaryFrameMeta(metaParsed);
    if (l.onBinaryFrameVideo && videoParsed) l.onBinaryFrameVideo(videoParsed);
    if (l.onBinaryFrame && videoParsed) l.onBinaryFrame(videoParsed);
  }
}

function flushPendingBinaryFrames(): void {
  hub.flushScheduled = false;
  if (hub.pendingBinaryByEntity.size === 0) return;
  const batch = [...hub.pendingBinaryByEntity.values()];
  hub.pendingBinaryByEntity.clear();
  for (const buf of batch) {
    dispatchBinaryFrame(buf);
  }
}

function enqueueBinaryFrame(buf: ArrayBuffer): void {
  const eid = peekNxt1EntityId(buf) || "__unknown__";
  hub.pendingBinaryByEntity.set(eid, buf);
  if (hub.flushScheduled) return;
  hub.flushScheduled = true;
  // rAF：跟显示节拍对齐；主线程卡顿时自然合并多帧 → 只播最新
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => flushPendingBinaryFrames());
  } else {
    queueMicrotask(() => flushPendingBinaryFrames());
  }
}

function scheduleReconnect() {
  if (hub.closed || hub.listeners.size === 0) return;
  hub.retries++;
  const delay = Math.min(10_000, 500 + hub.retries * 350);
  if (hub.timer) clearTimeout(hub.timer);
  hub.timer = setTimeout(() => connectHub(), delay);
}

function connectHub() {
  if (hub.closed || hub.listeners.size === 0) return;
  const url = resolveThirdPartyCameraWsUrl();
  if (!url) return;

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
  } catch {
    scheduleReconnect();
    return;
  }

  hub.ws = ws;
  hub.pendingBinaryByEntity.clear();
  hub.flushScheduled = false;

  ws.onopen = () => {
    hub.retries = 0;
  };

  ws.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      try {
        const j = JSON.parse(ev.data) as unknown;
        if (!j || typeof j !== "object" || Array.isArray(j)) return;
        const rec = j as Record<string, unknown>;
        if (rec.kind !== "thirdPartyDevStatusBasic") return;
        for (const l of hub.listeners) l.onDevStatusBasic?.(rec);
      } catch {
        /* ignore */
      }
      return;
    }
    if (!(ev.data instanceof ArrayBuffer)) return;
    enqueueBinaryFrame(ev.data);
  };

  ws.onclose = () => {
    hub.ws = null;
    hub.pendingBinaryByEntity.clear();
    hub.flushScheduled = false;
    if (!hub.closed) scheduleReconnect();
  };

  ws.onerror = () => {
    /* onclose handles reconnect */
  };
}

function ensureHubConnected() {
  hub.closed = false;
  if (hub.ws && (hub.ws.readyState === WebSocket.OPEN || hub.ws.readyState === WebSocket.CONNECTING)) return;
  connectHub();
}

function teardownHubIfIdle() {
  if (hub.listeners.size > 0) return;
  hub.closed = true;
  if (hub.timer) {
    clearTimeout(hub.timer);
    hub.timer = null;
  }
  hub.pendingBinaryByEntity.clear();
  hub.flushScheduled = false;
  hub.ws?.close();
  hub.ws = null;
}

/** 主动断开并重连共享第三方相机 WS（光电界面「重连」） */
export function forceReconnectThirdPartyCameraWsHub(): void {
  if (hub.listeners.size === 0) return;
  hub.closed = false;
  hub.retries = 0;
  if (hub.timer) {
    clearTimeout(hub.timer);
    hub.timer = null;
  }
  const ws = hub.ws;
  hub.ws = null;
  hub.pendingBinaryByEntity.clear();
  hub.flushScheduled = false;
  if (ws) {
    // 去掉 onclose，避免 close 后再 scheduleReconnect 与下面 connectHub 双重建连
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
  connectHub();
}

/** 全局共享第三方相机 WS；多订阅方复用单连接 */
export function subscribeThirdPartyCameraWsHub(listener: HubListener): () => void {
  hub.listeners.add(listener);
  ensureHubConnected();
  return () => {
    hub.listeners.delete(listener);
    teardownHubIfIdle();
  };
}
