/**
 * disposal-ws-client — 处置方案 WebSocket 客户端
 *
 * 【作用】接收后端自动推送的处置方案（`disposal_plans_required` 消息），
 *   由 ChatPanel 挂载时启动，硬编码常连。
 *
 * 【数据流】
 *   WS 连接 disposalPlanWsUrl（ws://192.168.18.103:8000/api/v1/ws/workflow-stream）
 *   → 接收消息 → normalizeDisposalPayload 归一化
 *   → handlers.onPlanReady(normalized) → disposalPlanStore.appendFromNormalized(_, "ws")
 *   → DisposalPlanFeed UI 展示
 *
 * 【连接管理】
 *   - 自动重连（reconnectAttempts 递增，指数退避）
 *   - 连接超时（autoDisposalWsConnectTimeoutMs，默认 10s）
 *   - 主动关闭时（intentionalClose=true）不重连
 *
 * 【与手动方案的区别】
 *   - ws 来源：后端自动推送（如告警触发自动处置）
 *   - http 来源：用户手动点击「一键处置」
 *   两者最终都走 disposalPlanStore.appendFromNormalized，只是 source 标记不同
 */

import { getHttpChatConfig } from "@/lib/map-app-config";
import type { NormalizedDisposalPlans } from "./disposal-types";
import { normalizeDisposalPayload } from "./normalize-disposal-plans";

export type DisposalWsHandlers = {
  onPlanReady?: (normalized: NormalizedDisposalPlans) => void;
  onConnect?: () => void;
  onDisconnect?: (intentional: boolean) => void;
  onConnectTimeout?: () => void;
  onRawMessage?: (payload: unknown) => void;
};

export class DisposalPlanWsClient {
  private wsUrl: string;
  private handlers: DisposalWsHandlers;
  private connectTimeoutMs: number;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private reconnectAttempts = 0;
  private intentionalClose = false;

  constructor(options: { wsUrl?: string; connectTimeoutMs?: number; handlers?: DisposalWsHandlers } = {}) {
    const cfg = getHttpChatConfig();
    this.wsUrl = options.wsUrl ?? cfg.disposalPlanWsUrl;
    this.connectTimeoutMs = options.connectTimeoutMs ?? cfg.autoDisposalWsConnectTimeoutMs ?? 10000;
    this.handlers = options.handlers ?? {};
  }

  start() {
    this.active = true;
    this.intentionalClose = false;
    this.connect();
  }

  stop() {
    this.active = false;
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* noop */
      }
      this.ws = null;
    }
  }

  private connect() {
    if (!this.active) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(this.wsUrl);
      if (this.connectTimer) clearTimeout(this.connectTimer);
      this.connectTimer = setTimeout(() => {
        if (!this.active || !this.ws || this.ws.readyState === WebSocket.OPEN) return;
        this.handlers.onConnectTimeout?.();
        try {
          this.ws.close();
        } catch {
          /* noop */
        }
      }, this.connectTimeoutMs);

      this.ws.onopen = () => {
        if (this.connectTimer) {
          clearTimeout(this.connectTimer);
          this.connectTimer = null;
        }
        this.reconnectAttempts = 0;
        this.handlers.onConnect?.();
      };

      this.ws.onmessage = (event) => {
        void this.handleMessage(event);
      };

      this.ws.onclose = () => {
        if (this.connectTimer) {
          clearTimeout(this.connectTimer);
          this.connectTimer = null;
        }
        const intentional = this.intentionalClose;
        this.intentionalClose = false;
        this.ws = null;
        this.handlers.onDisconnect?.(intentional);
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        /* onclose 统一处理 */
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (!this.active) return;
    if (this.reconnectTimer) return;
    const delay = Math.min(10000, 1000 * Math.pow(2, this.reconnectAttempts));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private async handleMessage(event: MessageEvent) {
    try {
      const raw = typeof event.data === "string" ? event.data : "";
      if (!raw) return;
      const payload = JSON.parse(raw) as Record<string, unknown>;
      this.handlers.onRawMessage?.(payload);
      /* 两种消息格式：
       *   1) { type: "disposal_plans_required", data: {...} }  — 标准格式
       *   2) { target_info, disposal_schemes, task_id }        — 无 type 字段，顶层直传
       */
      const hasType = payload?.type === "disposal_plans_required";
      const hasSchemes = Array.isArray((payload?.data as Record<string, unknown>)?.disposal_schemes) || Array.isArray(payload?.disposal_schemes);
      if (!hasType && !hasSchemes) return;
      console.log("[DisposalPlanWsClient] received disposal message, payload keys:", Object.keys(payload));
      const normalized = normalizeDisposalPayload(payload);
      if (!normalized?.items?.length) {
        console.warn("[DisposalPlanWsClient] normalizeDisposalPayload returned no items", normalized);
        return;
      }
      /* 若后端返回 detail（如"未生成有效的处置方案"），写入第一个 item 的 noPlansReason */
      const detail = String((payload?.data as Record<string, unknown>)?.detail ?? payload?.detail ?? "").trim();
      if (detail && normalized.items[0] && !normalized.items[0].noPlansReason) {
        normalized.items[0].noPlansReason = detail;
      }
      console.log("[DisposalPlanWsClient] normalized items:", normalized.items.length, "taskId:", normalized.taskId);
      this.handlers.onPlanReady?.(normalized);
    } catch (e) {
      console.error("[DisposalPlanWsClient] handleMessage:", e);
    }
  }
}
