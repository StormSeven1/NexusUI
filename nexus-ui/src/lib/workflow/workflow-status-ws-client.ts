/**
 * workflow-status-ws-client — 快捷工作流状态 WebSocket 客户端
 *
 * 【作用】执行快捷工作流后连接，接收后端推送的工作流执行状态。
 *   完全独立，不复用 disposal WS。
 *
 * 【连接时机】仅在工作流执行成功后连接；收到终态（completed/failed/interrupted）后自动断开。
 *
 * 【WS 消息格式】
 *   topic: workflow_status
 *   {
 *     "type": "workflow_status",
 *     "thread_id": "area_track_vertification_workflow_c3f42b011c9c",
 *     "main_thread_id": "quick_1777348243110_potlw7hoj",  ← 与 POST 的 thread_id 匹配
 *     "timestamp": "2026-04-28T11:51:49.265941",
 *     "data": {
 *       "status": "starting|completed|failed|interrupted",
 *       "result": { "message": "相机/无人机子任务监控完成", ... },
 *       "error": null
 *     }
 *   }
 *   只处理 main_thread_id 与当前工作流 threadId 匹配的消息。
 */

import { getHttpChatConfig } from "@/lib/map-app-config";
import type { WorkflowStatus } from "@/stores/workflow-status-store";
import { useWorkflowStatusStore } from "@/stores/workflow-status-store";

export type WorkflowStatusWsHandlers = {
  onStatusUpdate?: (threadId: string, status: WorkflowStatus, message: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (err: string) => void;
};

/**
 * 解析 WS 消息，按 main_thread_id 匹配当前工作流。
 * 返回 null 表示不匹配或格式无效。
 */
function parseWorkflowStatusMessage(
  payload: Record<string, unknown>,
  matchThreadIds: Set<string>,
): { threadId: string; status: WorkflowStatus; message: string } | null {
  // 只处理 workflow_status 类型
  const type = String(payload.type ?? "");
  if (type !== "workflow_status") return null;
  console.log("parseWorkflowStatusMessage:",payload)

  // 按 main_thread_id 匹配
  const mainThreadId = String(payload.main_thread_id ?? "");
  if (!mainThreadId || !matchThreadIds.has(mainThreadId)) return null;

  // 解析 data.status
  const data = payload.data as Record<string, unknown> | undefined;
  const rawStatus = String(data?.status ?? "").toLowerCase();
  const validStatuses: WorkflowStatus[] = ["starting", "completed", "failed", "interrupted", "cancelled"];
  const status = validStatuses.includes(rawStatus as WorkflowStatus)
    ? (rawStatus as WorkflowStatus)
    : "starting";

  // 优先取 data.result.message，没有则用默认文案
  const result = data?.result as Record<string, unknown> | undefined;
  const resultMessage = String(result?.message ?? "").trim();
  const message = resultMessage || "";

  return { threadId: mainThreadId, status, message };
}

export class WorkflowStatusWsClient {
  private wsUrl: string;
  private handlers: WorkflowStatusWsHandlers;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private active = false;
  private intentionalClose = false;

  constructor(options: { wsUrl?: string; handlers?: WorkflowStatusWsHandlers } = {}) {
    const cfg = getHttpChatConfig();
    this.wsUrl = options.wsUrl ?? cfg.quickWorkflowStatusWsUrl;
    this.handlers = options.handlers ?? {};
  }

  /** 连接 WS（执行工作流后调用） */
  start() {
    this.active = true;
    this.intentionalClose = false;
    this.connect();
  }

  /** 主动断开（终态后或手动关闭时调用） */
  stop() {
    this.active = false;
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch { /* noop */ }
      this.ws = null;
    }
  }

  private connect() {
    if (!this.active) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.handlers.onConnect?.();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event);
      };

      this.ws.onclose = () => {
        const wasIntentional = this.intentionalClose;
        this.intentionalClose = false;
        this.ws = null;
        if (!wasIntentional) {
          this.handlers.onDisconnect?.();
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        this.handlers.onError?.("WebSocket connection error");
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (!this.active) return;
    if (this.reconnectTimer) return;
    const delay = Math.min(8000, 1000 * Math.pow(2, this.reconnectAttempts));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleMessage(event: MessageEvent) {
    try {
      const raw = typeof event.data === "string" ? event.data : "";
      if (!raw) return;
      const payload = JSON.parse(raw) as Record<string, unknown>;

      // 从 store 获取当前活跃的 threadId 集合用于匹配
      const store = useWorkflowStatusStore.getState();
      const matchThreadIds = new Set(store.entries.map((e) => e.threadId));
      if (matchThreadIds.size === 0) return;

      const parsed = parseWorkflowStatusMessage(payload, matchThreadIds);
      if (!parsed) return;

      // 写入 store
      store.updateStatus(parsed.threadId, parsed.status, parsed.message);

      // 通知 handlers
      this.handlers.onStatusUpdate?.(parsed.threadId, parsed.status, parsed.message);

      // 终态：自动断开 WS
      if (parsed.status === "completed" || parsed.status === "failed" || parsed.status === "interrupted" || parsed.status === "cancelled") {
        this.stop();
      }
    } catch (e) {
      console.error("[WorkflowStatusWsClient] handleMessage:", e);
    }
  }
}
