"use client";

import { parseThirdPartyWsFrame } from "@/lib/eo-video/thirdPartyCameraWsFrame";

export function resolveThirdPartyCameraWsUrl(): string {
  const explicit =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_EO_THIRD_PARTY_CAMERA_WS_URL?.trim() : "";
  if (explicit) return explicit;
  if (typeof window === "undefined") return "";
  const port = process.env.NEXT_PUBLIC_EO_THIRD_PARTY_CAMERA_WS_PORT?.trim() || "40777";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.hostname}:${port}`;
}

export function normThirdPartyEntityId(s: string | undefined): string {
  const i = (s ?? "").indexOf("\0");
  const t = i >= 0 ? (s ?? "").slice(0, i) : (s ?? "");
  return t.trim().toLowerCase();
}

type HubListener = {
  onDevStatusBasic?: (payload: Record<string, unknown>) => void;
  onBinaryFrame?: (frame: NonNullable<ReturnType<typeof parseThirdPartyWsFrame>>) => void;
};

type HubState = {
  ws: WebSocket | null;
  closed: boolean;
  retries: number;
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<HubListener>;
};

const hub: HubState = {
  ws: null,
  closed: false,
  retries: 0,
  timer: null,
  listeners: new Set(),
};

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
    const parsed = parseThirdPartyWsFrame(ev.data);
    if (!parsed) return;
    for (const l of hub.listeners) l.onBinaryFrame?.(parsed);
  };

  ws.onclose = () => {
    hub.ws = null;
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
  hub.ws?.close();
  hub.ws = null;
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
