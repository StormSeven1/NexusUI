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

export type ThirdPartyCameraFrameTick = {
  entityId: string;
  videoWidth: number;
  videoHeight: number;
  strideY: number;
  yuvBytes: number;
  /** Y 平面抽样均值 0–255；无有效样点为 -1 */
  yMean: number;
  /** 自订阅以来累计完整帧数 */
  frameIndex: number;
  /** 距上一 tick 回调间隔内的帧数（约 1s） */
  framesInWindow: number;
};

function sampleYPlaneMean(yuv: Uint8Array, w: number, h: number, strideY: number): number {
  if (w <= 0 || h <= 0 || strideY < w || yuv.byteLength < strideY * h) return -1;
  let sum = 0;
  let n = 0;
  const rowStep = Math.max(1, Math.floor(h / 24));
  const colStep = Math.max(1, Math.floor(w / 32));
  for (let row = 0; row < h; row += rowStep) {
    const rowOff = row * strideY;
    for (let col = 0; col < w; col += colStep) {
      sum += yuv[rowOff + col] ?? 0;
      n++;
    }
  }
  return n > 0 ? sum / n : -1;
}

/** 中继 `EoThirdPartyCameraRelay` 下发的 NXT1 帧 → WebGL2 栈（按当前 entity 过滤） */
export function useEoThirdPartyCameraWebSocket(
  enabled: boolean,
  entityId: string | undefined,
  /** 若传入，帧经 `applyLiveFrame` 直写 WebGL，避免每帧 `setState` 压垮刷新率 */
  stackRef?: RefObject<EoHighSpeedYuvStackHandle | null>,
  /** 约每秒一次帧更新摘要（放大调试面板等） */
  onFrameTick?: (tick: ThirdPartyCameraFrameTick) => void,
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
  const frameIndexRef = useRef(0);
  const windowFramesRef = useRef(0);
  const tickMsRef = useRef(0);
  /** 子组件晚于 WS 挂载时仍能读到最新 `stackRef`，且不把 `stackRef` 放进 effect 依赖避免无意义重连 */
  const stackRefBox = useRef(stackRef);
  stackRefBox.current = stackRef;
  const onFrameTickRef = useRef(onFrameTick);
  onFrameTickRef.current = onFrameTick;

  useEffect(() => {
    if (!enabled) {
      setYuv420(null);
      setBoxes([]);
      setHint("");
      setHasFrame(false);
      dimsRef.current = { w: 0, h: 0, sy: 0 };
      frameSeenRef.current = false;
      frameIndexRef.current = 0;
      windowFramesRef.current = 0;
      tickMsRef.current = 0;
      return;
    }

    const want = normThirdPartyEntityId(entityId);
    const url = resolveThirdPartyCameraWsUrl();
    if (!url) {
      setHint("未配置 WebSocket URL（中继未暴露或需在 .env 设置 NEXT_PUBLIC_EO_THIRD_PARTY_CAMERA_WS_URL）");
      return;
    }

    setHint(`已连接 ${url} · 等待 UDP 帧…`);
    frameIndexRef.current = 0;
    windowFramesRef.current = 0;
    tickMsRef.current = 0;
    frameSeenRef.current = false;
    setHasFrame(false);

    // 切换相机时立即清除上一路的帧缓存，让占位提示重新可见（避免 livePresent 遗留导致黑屏无提示）
    stackRefBox.current?.current?.clearLiveFrame?.();

    const unsub = subscribeThirdPartyCameraWsHub({
      onDevStatusBasic: (rec) => {
        useEoThirdPartyUdpDevStatusStore.getState().ingestDevStatusBasic(rec);
      },
      onBinaryFrameVideo: (parsed) => {
        const from = normThirdPartyEntityId(parsed.entityId);
        if (want && from !== want) return;
        recordThirdPartyCameraReceived(parsed.entityId || undefined);

        const need = parsed.strideY * parsed.videoHeight + 2 * (parsed.strideY >> 1) * (parsed.videoHeight >> 1);
        if (parsed.yuv420.byteLength < need) return;

        frameIndexRef.current += 1;
        windowFramesRef.current += 1;
        const now = Date.now();
        if (tickMsRef.current === 0) tickMsRef.current = now;
        if (now - tickMsRef.current >= 1000) {
          const yMean = sampleYPlaneMean(
            parsed.yuv420,
            parsed.videoWidth,
            parsed.videoHeight,
            parsed.strideY,
          );
          onFrameTickRef.current?.({
            entityId: parsed.entityId,
            videoWidth: parsed.videoWidth,
            videoHeight: parsed.videoHeight,
            strideY: parsed.strideY,
            yuvBytes: parsed.yuv420.byteLength,
            yMean,
            frameIndex: frameIndexRef.current,
            framesInWindow: windowFramesRef.current,
          });
          windowFramesRef.current = 0;
          tickMsRef.current = now;
        }

        const stack = stackRefBox.current?.current;
        if (stack?.applyLiveFrame) {
          stack.applyLiveFrame({
            yuv420:
              parsed.yuv420.byteOffset === 0 && parsed.yuv420.byteLength === parsed.yuv420.buffer.byteLength
                ? parsed.yuv420
                : parsed.yuv420.slice(),
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
