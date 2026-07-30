"use client";

import { useEffect, useRef } from "react";
import { publishTaskStatusChatPayload, resolveTaskStatusSseUrl } from "@/lib/task-status-chat-feed-bus";
import type { TaskStatusChatPayload } from "@/lib/task-status-types";
import { recordTaskStatusSseReceived } from "@/stores/network-stats-store";
import { appendAccessTokenToUrl } from "@/lib/auth/auth-fetch";
import { ensureFreshToken } from "@/lib/auth/keycloak-client";

/**
 * 在布局根常驻一条 EventSource，与右侧是否挂载 ChatPanel 无关。
 */
export function TaskStatusChatSseHost() {
  const reconnectAttempt = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NEXT_PUBLIC_TASK_STATUS_CHAT_FEED === "false") return;

    let cancelled = false;
    let es: EventSource | null = null;
    let reconnectTimer: number | null = null;

    const scheduleReconnect = () => {
      if (cancelled) return;
      const n = reconnectAttempt.current;
      const delayMs = Math.min(30_000, 1000 * 2 ** Math.min(n, 5));
      reconnectAttempt.current = n + 1;
      reconnectTimer = window.setTimeout(() => { void open(); }, delayMs);
    };

    const open = async () => {
      if (cancelled) return;
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      es?.close();
      await ensureFreshToken(30);
      const url = appendAccessTokenToUrl(resolveTaskStatusSseUrl());
      const next = new EventSource(url);
      es = next;
      next.onopen = () => {
        reconnectAttempt.current = 0;
      };
      next.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as
            | { type: "connected"; t: number }
            | { type: "task_status"; payload: TaskStatusChatPayload };
          if (msg.type !== "task_status" || !msg.payload) return;
          recordTaskStatusSseReceived();
          publishTaskStatusChatPayload(msg.payload);
        } catch (e) {
          if (process.env.NODE_ENV === "development") {
            console.warn("[task-status-sse] message parse", e);
          }
        }
      };
      next.onerror = () => {
        if (cancelled) return;
        if (next.readyState === EventSource.CLOSED) {
          if (es === next) es = null;
          scheduleReconnect();
        }
      };
    };

    open();
    return () => {
      cancelled = true;
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []);

  return null;
}
