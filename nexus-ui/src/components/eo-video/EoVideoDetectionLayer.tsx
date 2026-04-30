"use client";

import { useEffect } from "react";
import { useEoEntityDetection } from "@/hooks/useEoEntityDetection";
import type { EoEncodedSyncHub } from "@/lib/eo-video/eoWebrtcEncodedSync";
import type { EoDetectionBox } from "@/lib/eo-video/types";
import { EoDetectionOverlay } from "./EoDetectionOverlay";

export interface EoVideoDetectionLayerProps {
  entityId: string | undefined;
  enabled: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  selectedBoxId?: string | null;
  onSelectBox?: (boxId: string | null) => void;
  onDoubleClickPoint?: (payload: {
    normalizedX: number;
    normalizedY: number;
    hitBoxId: string | null;
    hitBox: EoDetectionBox | null;
  }) => void;
  onDiagnostic?: (line: string, hoverDetail?: string) => void;
  encodedSyncHub?: EoEncodedSyncHub;
  videoReceiverRef?: React.MutableRefObject<RTCRtpReceiver | null>;
  onBoxesChange?: (boxes: EoDetectionBox[]) => void;
  videoObjectFit?: "contain" | "cover";
  videoIntrinsicWidth?: number;
  videoIntrinsicHeight?: number;
}

/**
 * 实体相机：WebSocket 检测框 + 与 WebRTC 显示帧对齐（Insertable Streams 环 + syncHeader 匹配），
 * 叠在视频上，支持点击选框、双击发跟踪任务。
 */
export function EoVideoDetectionLayer({
  entityId,
  enabled,
  containerRef,
  videoRef,
  selectedBoxId,
  onSelectBox,
  onDoubleClickPoint,
  onDiagnostic,
  encodedSyncHub,
  videoReceiverRef,
  onBoxesChange,
  videoObjectFit,
  videoIntrinsicWidth,
  videoIntrinsicHeight,
}: EoVideoDetectionLayerProps) {
  const { boxes } = useEoEntityDetection({
    entityId,
    videoRef,
    encodedSyncHub,
    videoReceiverRef,
    enabled,
    onDiagnostic,
  });

  useEffect(() => {
    onBoxesChange?.(boxes);
  }, [boxes, onBoxesChange]);

  return (
    <EoDetectionOverlay
      containerRef={containerRef}
      videoRef={videoRef}
      boxes={boxes}
      selectedBoxId={selectedBoxId}
      onSelectBox={onSelectBox}
      onDoubleClickPoint={onDoubleClickPoint}
      videoObjectFit={videoObjectFit}
      videoIntrinsicWidth={videoIntrinsicWidth}
      videoIntrinsicHeight={videoIntrinsicHeight}
    />
  );
}
