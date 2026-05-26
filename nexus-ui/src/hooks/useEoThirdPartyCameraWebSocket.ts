"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { EoHighSpeedBox, EoHighSpeedYuvStackHandle } from "@/components/eo-video/EoHighSpeedYuvStack";
import {
  normThirdPartyEntityId,
  resolveThirdPartyCameraWsUrl,
  subscribeThirdPartyCameraWsHub,
} from "@/lib/eo-video/thirdPartyCameraWsHub";
import { useEoThirdPartyUdpDevStatusStore } from "@/stores/eo-third-party-udp-dev-status-store";
import { recordThirdPartyCameraReceived } from "@/stores/network-stats-store";

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

    const want = normThirdPartyEntityId(entityId);
  const url = resolveThirdPartyCameraWsUrl();
    if (!url) {
      setHint("未配置 WebSocket URL（中继未暴露或需在 .env 设置 NEXT_PUBLIC_EO_THIRD_PARTY_CAMERA_WS_URL）");
      return;
    }

    setHint(`已连接 ${url} · 等待 UDP 帧…`);

    const unsub = subscribeThirdPartyCameraWsHub({
      onDevStatusBasic: (rec) => {
        useEoThirdPartyUdpDevStatusStore.getState().ingestDevStatusBasic(rec);
      },
      onBinaryFrame: (parsed) => {
        const from = normThirdPartyEntityId(parsed.entityId);
        if (want && from !== want) return;
        recordThirdPartyCameraReceived(parsed.entityId || undefined);

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
      },
    });

    return () => {
      unsub();
    };
  }, [enabled, entityId]);

  return { videoWidth, videoHeight, strideY, yuv420, boxes, hint, hasFrame };
}
