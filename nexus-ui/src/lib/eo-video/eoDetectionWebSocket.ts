import { canonicalEntityId } from "@/lib/camera-entity-id";
import type { EoCameraWsPayload } from "@/lib/eo-video/eoDetectionTypes";
import {
  normalizeWsCameraRow,
  summarizeWsInboundPayload,
  unwrapDetectionEnvelope,
} from "@/lib/eo-video/eoWsPayloadNormalize";

type Listener = (data: EoCameraWsPayload) => void;

async function fetchServerDerivedWsUrls(): Promise<string[]> {
  if (typeof window === "undefined") return [];
  try {
    const res = await fetch("/api/eo-detection-ws", { cache: "no-store" });
    if (!res.ok) return [];
    const j = (await res.json()) as { urls?: string[] };
    return Array.isArray(j.urls) ? j.urls.filter((u) => typeof u === "string" && u.length > 0) : [];
  } catch {
    return [];
  }
}

/** 与 base-vue websocketService.connectWithFallback 顺序对齐：公网 env → 后端推导 → 同源代理 */
async function wsUrlCandidates(): Promise<string[]> {
  if (typeof window === "undefined") return [];
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  const fromEnv = process.env.NEXT_PUBLIC_EO_DETECTION_WS_URL?.trim();
  const derived = await fetchServerDerivedWsUrls();
  const list = [...(fromEnv ? [fromEnv] : []), ...derived, `${proto}//${host}/ws`];
  return [...new Set(list)];
}

/** 检测框 WebSocket：多相机共连，按 canonical entityId 分发 */
class EoDetectionWebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly reconnectDelayMs = 5000;
  private readonly heartbeatIntervalMs = 30000;
  private readonly connectTimeoutMs = 8000;
  private isConnecting = false;
  private isDestroyed = false;
  private lastHeartbeatTime = 0;
  private subscriberCount = 0;
  private readonly listeners = new Map<string, Listener>();
  /** 最近一条入站业务帧（不含 pong）摘要，便于现场对照后端 JSON */
  private lastWsInboundSummary = "";
  private lastWsInboundRaw = "";
  private lastWsInboundAt = 0;

  subscribe(entityId: string, listener: Listener): () => void {
    const id = canonicalEntityId(entityId);
    if (!id) return () => undefined;
    const existed = this.listeners.has(id);
    this.listeners.set(id, listener);
    if (!existed) {
      this.subscriberCount++;
      if (this.subscriberCount === 1 && !this.isDestroyed) {
        void this.connectWithFallback();
      }
    }
    return () => {
      if (this.listeners.get(id) !== listener) return;
      this.listeners.delete(id);
      this.subscriberCount = Math.max(0, this.subscriberCount - 1);
      if (this.subscriberCount === 0) {
        this.teardownConnection();
      }
    };
  }

  private teardownConnection() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.isConnecting = false;
  }

  private tryConnect(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(url);
        let settled = false;
        let t: ReturnType<typeof setTimeout>;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          resolve(ok);
        };

        t = setTimeout(() => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          finish(false);
        }, this.connectTimeoutMs);

        ws.onopen = () => {
          this.ws = ws;
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.lastHeartbeatTime = Date.now();
          ws.onmessage = (ev) => {
            void this.dispatchRawMessage(ev.data);
          };
          ws.onclose = () => this.handleClose();
          ws.onerror = () => {
            /* 已连接后错误由 onclose 处理 */
          };
          this.lastHeartbeatTime = Date.now();
          this.startHeartbeat();
          finish(true);
        };

        ws.onerror = () => finish(false);
      } catch {
        resolve(false);
      }
    });
  }

  private async connectWithFallback() {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) return;
    this.isConnecting = true;
    this.teardownConnection();

    const urls = await wsUrlCandidates();
    for (const url of urls) {
      const ok = await this.tryConnect(url);
      if (ok) {
        this.isConnecting = false;
        return;
      }
    }
    this.isConnecting = false;
    this.scheduleReconnect();
  }

  private recordWsInboundObservation(summary: string, rawText?: string) {
    this.lastWsInboundSummary = summary.slice(0, 560);
    this.lastWsInboundRaw = (rawText ?? "").slice(0, 900);
    this.lastWsInboundAt = Date.now();
  }

  /** 工具条诊断行追加用；`rawForTitle` 适合放在 title 悬停里看原始 JSON 片段 */
  getLastWsInboundDebugForUi(): { summary: string; rawForTitle: string } {
    if (!this.lastWsInboundSummary) return { summary: "", rawForTitle: "" };
    const ageSec = Math.max(0, Math.floor((Date.now() - this.lastWsInboundAt) / 1000));
    return {
      summary: `${ageSec}s ${this.lastWsInboundSummary}`,
      rawForTitle: this.lastWsInboundRaw ? `RAW(≤900B)\n${this.lastWsInboundRaw}` : "",
    };
  }

  private _debugLoggedOnce = false;

  private async dispatchRawMessage(raw: unknown) {
    this.lastHeartbeatTime = Date.now();
    let text: string;
    if (typeof raw === "string") text = raw;
    else if (raw instanceof Blob) text = await raw.text();
    else if (raw instanceof ArrayBuffer) text = new TextDecoder("utf-8").decode(raw);
    else return;

    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      if (data.type === "pong") return;

      // 【调试】只打印一次原始包结构，帮助确认字段名
      if (!this._debugLoggedOnce) {
        this._debugLoggedOnce = true;
        const sample = Array.isArray(data.cameraArray)
          ? (data.cameraArray as unknown[])[0]
          : data;
        console.log("[eo-detect] WS raw sample:", JSON.stringify(sample).slice(0, 600));
      }

      const routed = unwrapDetectionEnvelope(data);
      const listenerKeys = [...this.listeners.keys()];
      this.recordWsInboundObservation(summarizeWsInboundPayload(routed, { listenerKeys }), text);

      if (Array.isArray(routed.cameraArray)) {
        for (const row of routed.cameraArray as unknown[]) {
          const p = normalizeWsCameraRow(row);
          if (p) this.processCameraData(p);
        }
        return;
      }
      if (routed.entityId != null || routed.entity_id != null) {
        const p = normalizeWsCameraRow(routed);
        if (p) this.processCameraData(p);
        return;
      }
    } catch (e) {
      this.recordWsInboundObservation(
        `JSON.parse err: ${e instanceof Error ? e.message : String(e)}`,
        text.slice(0, 400),
      );
    }
  }

  private processCameraData(cameraData: EoCameraWsPayload) {
    if (cameraData?.entityId == null) return;
    const key = canonicalEntityId(cameraData.entityId);
    const fn = this.listeners.get(key);
    if (fn) fn(cameraData);
  }

  private handleClose() {
    this.ws = null;
    this.stopHeartbeat();
    if (!this.isDestroyed && this.subscriberCount > 0) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.isDestroyed || this.subscriberCount === 0) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempts++;
    let delay = this.reconnectDelayMs;
    if (this.reconnectAttempts > 5) delay *= 2;
    if (this.reconnectAttempts > this.maxReconnectAttempts) delay *= 1.5;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectWithFallback();
    }, delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const gap = Date.now() - this.lastHeartbeatTime;
      if (gap > this.heartbeatIntervalMs * 2) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        return;
      }
      try {
        ws.send(JSON.stringify({ type: "ping" }));
        this.lastHeartbeatTime = Date.now();
      } catch {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  destroy() {
    this.isDestroyed = true;
    this.listeners.clear();
    this.subscriberCount = 0;
    this.teardownConnection();
  }

  /** WebSocket.CONNECTING=0 … CLOSED=3，未建连视为 CLOSED */
  getWsReadyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }
}

let instance: EoDetectionWebSocketManager | null = null;

export function getEoDetectionWebSocketManager(): EoDetectionWebSocketManager {
  if (!instance) instance = new EoDetectionWebSocketManager();
  return instance;
}
