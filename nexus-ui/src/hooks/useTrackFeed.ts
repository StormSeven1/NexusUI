"use client";

import { useEffect, useRef } from "react";
import { useTrackStore } from "@/stores/track-store";
import type { Track } from "@/lib/mock-data";

const WS_URL = (typeof window !== "undefined"
  ? `ws://${window.location.hostname}:8001/api/ws/tracks`
  : "");

const RECONNECT_DELAY_MS = 2000;

/**
 * WebSocket hook：连接后端模拟引擎，接收实时目标数据，写入 track-store。
 * 在 AppShell 中调用一次即可。
 */
export function useTrackFeed() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { setTracks, setConnected, setLastUpdate } = useTrackStore();

  useEffect(() => {
    if (!WS_URL) return;

    function connect() {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as {
            type: string;
            tracks: Track[];
            timestamp?: string;
          };
          if (data.type === "track_update" || data.type === "track_snapshot") {
            setTracks(data.tracks);
            if (data.timestamp) setLastUpdate(data.timestamp);
          }
        } catch {
          /* 忽略无法解析的消息 */
        }
      };

      ws.onclose = () => {
        setConnected(false);
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
  }, [setTracks, setConnected, setLastUpdate]);
}
