"use client";

import { useEffect, useRef } from "react";
import { useAlertStore } from "@/stores/alert-store";

const WS_URL = (typeof window !== "undefined"
  ? `ws://${window.location.hostname}:8001/api/ws/alerts`
  : "");

const RECONNECT_DELAY_MS = 3000;

/**
 * WebSocket hook：连接后端告警引擎，接收实时告警，写入 alert-store。
 */
export function useAlertFeed() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addAlerts = useAlertStore((s) => s.addAlerts);

  useEffect(() => {
    if (!WS_URL) return;

    function connect() {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as {
            type: string;
            alerts?: Array<{
              id: string;
              severity: "critical" | "warning" | "info";
              message: string;
              timestamp: string;
              trackId?: string;
              lat?: number;
              lng?: number;
              type?: string;
            }>;
          };
          if (data.type === "alert_batch" && data.alerts?.length) {
            addAlerts(data.alerts);
          }
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [addAlerts]);
}
