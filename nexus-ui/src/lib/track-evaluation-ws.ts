/**
 * 航迹评估 C++ 数据服务 WebSocket（与 mapbox-vue2 `SystemConfig.websocket.dataServiceUrl` 同源，非 Nexus Custombackend）。
 *
 * 默认：ws://<host>:12600/ws/test-client
 * 环境变量：NEXT_PUBLIC_TRACK_EVAL_WS_URL
 */

import { rewriteWsUrlForHttpsPage } from "@/lib/wsHttpsRewrite";
import { recordTrackEvalReceived } from "@/stores/network-stats-store";

export const DEFAULT_TRACK_EVAL_WS_URL = "ws://127.0.0.1:12600/ws/test-client";

export function getTrackEvalWsUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_TRACK_EVAL_WS_URL?.trim();
  return fromEnv || DEFAULT_TRACK_EVAL_WS_URL;
}

/** 数据库查询 / 下载 */
export interface TrackEvalQueryPayload {
  type: "query" | "download";
  start_time: string;
  end_time: string;
  region_type: "" | "rect" | "polygon";
  batch_size?: number;
  bounding_box?: {
    min_longitude: number;
    max_longitude: number;
    min_latitude: number;
    max_latitude: number;
  };
  polygon?: {
    points: Array<{ longitude: number; latitude: number }>;
  };
  sensor_id?: number[];
}

export type TrackEvalOutboundMessage =
  | TrackEvalQueryPayload
  | { type: "cancel" }
  | { type: "startsend" }
  | { type: "stopsend" }
  | { type: "ping" };

/** 服务端常见 status 字段（与 mapbox-vue2 TrackFilterPanel 一致） */
export type TrackEvalInboundStatus =
  | "segment"
  | "data"
  | "complete"
  | "error"
  | "realtime"
  | "success";

export interface TrackEvalInboundMessage {
  type?: string;
  status?: TrackEvalInboundStatus;
  message?: string;
  data?: unknown[];
  total_count?: number;
  batch_index?: number;
  batch_count?: number;
  segment_index?: number;
  segment_count?: number;
  segment_start_time?: string;
  segment_end_time?: string;
  timestamp?: number;
}

export type TrackEvalConnectionState = "idle" | "connecting" | "open" | "closed" | "error";

function cleanInvalidJsonNumbers(raw: string): string {
  return raw
    .replace(/([:,\[])\s*NaN\s*([,}\]])/g, "$1 null$2")
    .replace(/([:,\[])\s*Infinity\s*([,}\]])/g, "$1 null$2")
    .replace(/([:,\[])\s*-Infinity\s*([,}\]])/g, "$1 null$2");
}

export function parseTrackEvalMessage(raw: string): TrackEvalInboundMessage | null {
  const trimmed = raw.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return null;
  try {
    return JSON.parse(cleanInvalidJsonNumbers(trimmed)) as TrackEvalInboundMessage;
  } catch {
    return null;
  }
}

export class TrackEvaluationWsClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 100;
  private readonly reconnectIntervalMs = 2000;
  private readonly heartbeatIntervalMs = 30_000;
  private intentionalClose = false;

  constructor(
    private readonly url: string,
    private readonly callbacks: {
      onState?: (state: TrackEvalConnectionState) => void;
      onMessage?: (msg: TrackEvalInboundMessage) => void;
      onRawError?: (err: Event) => void;
    },
  ) {}

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    if (typeof window === "undefined") return;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }
    this.intentionalClose = false;
    this.callbacks.onState?.("connecting");
    try {
      const ws = new WebSocket(rewriteWsUrlForHttpsPage(this.url));
      this.ws = ws;
      ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.callbacks.onState?.("open");
        this.startHeartbeat();
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") return;
        recordTrackEvalReceived();
        const parsed = parseTrackEvalMessage(ev.data);
        if (parsed) this.callbacks.onMessage?.(parsed);
      };
      ws.onerror = (ev) => {
        this.callbacks.onState?.("error");
        this.callbacks.onRawError?.(ev);
      };
      ws.onclose = () => {
        this.stopHeartbeat();
        this.ws = null;
        this.callbacks.onState?.("closed");
        if (!this.intentionalClose) this.scheduleReconnect();
      };
    } catch {
      this.callbacks.onState?.("error");
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.callbacks.onState?.("closed");
  }

  send(payload: TrackEvalOutboundMessage): boolean {
    if (!this.isOpen || !this.ws) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts += 1;
      this.connect();
    }, this.reconnectIntervalMs);
  }
}
