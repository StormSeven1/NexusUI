"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { EoHighSpeedBox, EoHighSpeedYuvStackHandle } from "@/components/eo-video/EoHighSpeedYuvStack";
import { parseThirdPartyWsFrame } from "@/lib/eo-video/thirdPartyCameraWsFrame";
import { useEoThirdPartyUdpDevStatusStore } from "@/stores/eo-third-party-udp-dev-status-store";
function resolveThirdPartyCameraWsUrl(): string {
  const explicit =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_EO_THIRD_PARTY_CAMERA_WS_URL?.trim() : "";
  if (explicit) return explicit;
  if (typeof window === "undefined") return "";
  const port = process.env.NEXT_PUBLIC_EO_THIRD_PARTY_CAMERA_WS_PORT?.trim() || "40777";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.hostname}:${port}`;
}

function normEntity(s: string | undefined): string {
  const i = (s ?? "").indexOf("\0");
  const t = i >= 0 ? (s ?? "").slice(0, i) : (s ?? "");
  return t.trim().toLowerCase();
}

/** 中继 `EoThirdPartyCameraRelay` 下发的 NXT1 帧 → WebGL2 栈（按当前 entity 过滤） */
export function useEoThirdPartyCameraWebSocket(
  enabled: boolean,
  entityId: string | undefined,
  /** 若传入，帧经 `applyLiveFrame` 直写 WebGL，避免每帧 `setState` 压垮刷新率 */
  stackRef?: RefObject<EoHighSpeedYuvStackHandle | null>,
) {
  const [videoWidth, setVideoWidth] = useState(1280);
  const [videoHeight, setVideoHeight] = useState(720);
  const [strideY, setStrideY] = useState(1280);
  const [yuv420, setYuv420] = useState<Uint8Array | null>(null);
  const [boxes, setBoxes] = useState<EoHighSpeedBox[]>([]);
  const [hint, setHint] = useState("");
  const [hasFrame, setHasFrame] = useState(false);
  const dimsRef = useRef({ w: 0, h: 0, sy: 0 });
  const frameSeenRef = useRef(false);
  const hintLogMsRef = useRef(0);
  /** 子组件晚于 WS 挂载时仍能读到最新 `stackRef`，且不把 `stackRef` 放进 effect 依赖避免无意义重连 */
  const stackRefBox = useRef(stackRef);
  stackRefBox.current = stackRef;
  useEffect(() => {
    if (!enabled) {
      setYuv420(null);
      setBoxes([]);
      setHint("");
      setHasFrame(false);
      dimsRef.current = { w: 0, h: 0, sy: 0 };
      frameSeenRef.current = false;
      return;
    }
    let ws: WebSocket | null = null;
    let closed = false;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const want = normEntity(entityId);

    const connect = () => {
      const url = resolveThirdPartyCameraWsUrl();
      if (!url) {
        setHint("未配置 WebSocket URL（中继未暴露或需在 .env 设置 NEXT_PUBLIC_EO_THIRD_PARTY_CAMERA_WS_URL）");
        return;
      }

      try {
        ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
      } catch {
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        retries = 0;
        setHint(`已连接 ${url} · 等待 UDP 帧…`);
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          try {
            const j = JSON.parse(ev.data) as unknown;
            if (!j || typeof j !== "object" || Array.isArray(j)) return;
            const rec = j as Record<string, unknown>;
            if (rec.kind !== "thirdPartyDevStatusBasic") return;
            useEoThirdPartyUdpDevStatusStore.getState().ingestDevStatusBasic(rec);
          } catch {
            /* 非 JSON 或无关文本 */
          }
          return;
        }
        if (!(ev.data instanceof ArrayBuffer)) return;
        const parsed = parseThirdPartyWsFrame(ev.data);
        if (!parsed) return;
        const from = normEntity(parsed.entityId);
        if (want && from !== want) return;

        const need = parsed.strideY * parsed.videoHeight + 2 * (parsed.strideY >> 1) * (parsed.videoHeight >> 1);
        if (parsed.yuv420.byteLength < need) return;

        const stack = stackRefBox.current?.current;
        if (stack?.applyLiveFrame) {
          stack.applyLiveFrame({
            yuv420: parsed.yuv420,
            videoWidth: parsed.videoWidth,
            videoHeight: parsed.videoHeight,
            strideY: parsed.strideY,
            boxes: parsed.boxes,
          });
          const d = dimsRef.current;
          if (d.w !== parsed.videoWidth || d.h !== parsed.videoHeight || d.sy !== parsed.strideY) {
            dimsRef.current = { w: parsed.videoWidth, h: parsed.videoHeight, sy: parsed.strideY };
            setVideoWidth(parsed.videoWidth);
            setVideoHeight(parsed.videoHeight);
            setStrideY(parsed.strideY);
          }
          if (!frameSeenRef.current) {
            frameSeenRef.current = true;
            setHasFrame(true);
          }
          const now = Date.now();
          if (now - hintLogMsRef.current > 1000) {
            hintLogMsRef.current = now;
            setHint(`直播 · ${parsed.entityId} · ${parsed.videoWidth}×${parsed.videoHeight}`);
          }
          return;
        }

        setVideoWidth(parsed.videoWidth);
        setVideoHeight(parsed.videoHeight);
        setStrideY(parsed.strideY);
        setYuv420(parsed.yuv420);
        setBoxes(parsed.boxes);
        setHasFrame(true);
        setHint(`直播 · ${parsed.entityId} · ${parsed.videoWidth}×${parsed.videoHeight}`);
      };
      ws.onerror = () => {
        if (!closed) setHint(`WebSocket 错误 ${url}`);
      };

      ws.onclose = () => {
        ws = null;
        if (!closed) scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (closed) return;
      retries++;
      const delay = Math.min(10_000, 500 + retries * 350);
      timer = setTimeout(() => connect(), delay);
      setHint(`已断开，约 ${(delay / 1000).toFixed(1)}s 后重连…`);
    };

    connect();

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, [enabled, entityId]);

  return { videoWidth, videoHeight, strideY, yuv420, boxes, hint, hasFrame };
}