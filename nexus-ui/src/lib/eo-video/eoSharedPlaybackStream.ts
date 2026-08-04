/**
 * 放大窗复用小窗画面：优先 captureStream（不二次占用 WebRTC 轨），
 * 关闭放大后把小窗 video 从 PeerConnection 接收轨重新挂回。
 */

export function captureOrClonePlaybackStream(video: HTMLVideoElement | null): MediaStream | null {
  if (!video) return null;
  try {
    const capture = (
      video as HTMLVideoElement & {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
      }
    ).captureStream?.() ??
      (
        video as HTMLVideoElement & {
          mozCaptureStream?: () => MediaStream;
        }
      ).mozCaptureStream?.();
    if (capture && capture.getTracks().some((t) => t.readyState === "live")) {
      return capture;
    }
  } catch {
    /* captureStream 不可用或源未出画 */
  }
  const src = video.srcObject;
  if (!(src instanceof MediaStream)) return null;
  const live = src.getTracks().filter((t) => t.readyState === "live");
  if (!live.length) return null;
  return new MediaStream(live);
}

/** Peer 仍连通但 video 黑/空时，用 receiver 轨重建 srcObject 并 play */
export function reattachVideoFromPeer(
  video: HTMLVideoElement | null,
  pc: RTCPeerConnection | null,
): boolean {
  if (!video) return false;
  try {
    if (pc) {
      const live = pc
        .getReceivers()
        .map((r) => r.track)
        .filter((t): t is MediaStreamTrack => Boolean(t && t.readyState === "live"));
      if (live.length) {
        /**
         * 仅比较 video 轨：audio 轨 readyState 变化（如对端停推音频）不应触发 srcObject 替换，
         * 否则重设 srcObject 会导致 1-2 帧黑屏闪烁。
         */
        const videoLive = live.filter((t) => t.kind === "video");
        const cur = video.srcObject;
        const curVideoTracks = cur instanceof MediaStream ? cur.getVideoTracks() : [];
        const same =
          videoLive.length > 0 &&
          videoLive.length === curVideoTracks.length &&
          videoLive.every((t) => curVideoTracks.some((c) => c.id === t.id));
        if (!same && videoLive.length > 0) {
          video.srcObject = new MediaStream(videoLive);
        }
        video.muted = true;
        video.playsInline = true;
        void video.play().catch(() => {
          /* autoplay */
        });
        return true;
      }
    }
    if (video.srcObject instanceof MediaStream) {
      void video.play().catch(() => {
        /* autoplay */
      });
      return video.videoWidth > 0;
    }
  } catch {
    /* ignore */
  }
  return false;
}
