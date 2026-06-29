"use client";

import { useEffect, useRef } from "react";
import { useEoEntityDetection } from "@/hooks/useEoEntityDetection";
import { eoDetectionBoxesEqual } from "@/lib/eo-video/detectionSyncUtils";
import type { EoEncodedSyncHub } from "@/lib/eo-video/eoWebrtcEncodedSync";
import type { EoWebCodecsPresentation } from "@/lib/eo-video/eoVideoWebCodecsCanvas";
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
  /** WebCodecs 呈现 ref：检测按 lastRenderedRtpTimestamp 与 hub 对齐 */
  webCodecsPresentationRef?: React.MutableRefObject<EoWebCodecsPresentation>;
  /** 与父级放大窗口一致：影响单目标跟踪框标签文案（航迹信息） */
  expandedMode?: boolean;
  /** 与 DDS `trackAlias` 对应的相机 entityId（可与 detection entityId 不同） */
  ddsCameraEntityId?: string;
  /** false：无人机等场景仅显示框，不拦截拖拽/瞄准 */
  interactive?: boolean;
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
  webCodecsPresentationRef,
  expandedMode = false,
  ddsCameraEntityId,
  interactive = true,
}: EoVideoDetectionLayerProps) {
  const { boxes } = useEoEntityDetection({
    entityId,
    videoRef,
    encodedSyncHub,
    videoReceiverRef,
    enabled,
    onDiagnostic,
    expandedMode,
    ddsCameraEntityId,
    presentationWidth: videoIntrinsicWidth,
    presentationHeight: videoIntrinsicHeight,
    webCodecsPresentationRef,
  });

  const onBoxesChangeRef = useRef(onBoxesChange);
  onBoxesChangeRef.current = onBoxesChange;
  const lastNotifiedBoxesRef = useRef(boxes);

  useEffect(() => {
    if (eoDetectionBoxesEqual(lastNotifiedBoxesRef.current, boxes)) return;
    lastNotifiedBoxesRef.current = boxes;
    onBoxesChangeRef.current?.(boxes);
  }, [boxes]);

  return (
    <EoDetectionOverlay
      containerRef={containerRef}
      videoRef={videoRef}
      boxes={boxes}
      detectionEntityId={entityId}
      ddsCameraEntityId={ddsCameraEntityId}
      expandedMode={expandedMode}
      selectedBoxId={selectedBoxId}
      onSelectBox={onSelectBox}
      onDoubleClickPoint={onDoubleClickPoint}
      videoObjectFit={videoObjectFit}
      videoIntrinsicWidth={videoIntrinsicWidth}
      videoIntrinsicHeight={videoIntrinsicHeight}
      interactive={interactive}
    />
  );
}
