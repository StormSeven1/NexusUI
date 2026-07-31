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
        const cur = video.srcObject;
        const same =
          cur instanceof MediaStream &&
          cur.getTracks().length === live.length &&
          live.every((t) => cur.getTracks().some((c) => c.id === t.id));
        if (!same) {
          video.srcObject = new MediaStream(live);
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
