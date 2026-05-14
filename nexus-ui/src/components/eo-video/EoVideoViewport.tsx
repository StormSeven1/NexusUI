"use client";

import { cn } from "@/lib/utils";
import { isEoVideoDebugUiEnabled } from "@/lib/eo-video/eoVideoDebugUi";
import type { EoEncodedSyncHub } from "@/lib/eo-video/eoWebrtcEncodedSync";
import type { EoVideoIceServer } from "@/lib/eo-video/types";
import { useWebRtcPlayer } from "@/hooks/useWebRtcPlayer";

export interface EoVideoViewportProps {
  signalingUrl: string;
  iceServers: EoVideoIceServer[];
  enabled: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  peerConnectionRef?: React.MutableRefObject<RTCPeerConnection | null>;
  encodedSyncHub?: EoEncodedSyncHub;
  videoReceiverRef?: React.MutableRefObject<RTCRtpReceiver | null>;
  containerClassName?: string;
  streamLabel?: string;
  videoObjectFit?: "contain" | "cover";
}

/**
 * 画面始终由硬件 video 解码显示。检测同步仍可走 Insertable Streams → encodedSyncHub（useWebRtcPlayer 注入），
 * 不再叠 WebCodecs Canvas：部分环境下 invisible + canvas 会导致整区黑屏（相机常开检测时尤甚）。
 */
export function EoVideoViewport({
  signalingUrl,
  iceServers,
  enabled,
  videoRef,
  peerConnectionRef,
  encodedSyncHub,
  videoReceiverRef,
  containerClassName,
  streamLabel,
  videoObjectFit = "cover",
}: EoVideoViewportProps) {
  const showDebugOverlay = isEoVideoDebugUiEnabled();
  const { connectionState, iceConnectionState, error } = useWebRtcPlayer({
    signalingUrl,
    iceServers,
    videoRef,
    enabled,
    peerConnectionRef,
    encodedSyncHub,
    videoReceiverRef,
  });

  return (
    <>
      <video
        ref={videoRef}
        className={cn(
          "pointer-events-none absolute inset-0 z-0 h-full w-full",
          videoObjectFit === "contain" ? "object-contain" : "object-cover",
          containerClassName,
        )}
        playsInline
        muted
        autoPlay
        disablePictureInPicture
        controlsList="nopictureinpicture"
        disableRemotePlayback
      />

      {showDebugOverlay ? (
        <div className="pointer-events-none absolute left-2 top-2 z-20 flex max-w-[min(90%,280px)] flex-col gap-0.5 rounded border border-white/10 bg-black/70 px-2 py-1 font-mono text-[9px] text-nexus-text-secondary">
          {streamLabel ? <span className="text-nexus-text-primary">{streamLabel}</span> : null}
          <span>
            PC {connectionState} · ICE {iceConnectionState}
            {encodedSyncHub ? " · syncHub" : ""}
          </span>
          {error ? <span className="text-nexus-error">ERR {error}</span> : null}
        </div>
      ) : null}
    </>
  );
}
