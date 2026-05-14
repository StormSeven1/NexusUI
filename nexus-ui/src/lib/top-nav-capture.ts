/**
 * 顶栏截屏 / 录屏：浏览器内使用屏幕共享 API（用户需授权），行为与 Qt 桌面抓屏不同但无需原生依赖。
 */

function pickMime(): string {
  const c = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  for (const m of c) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "video/webm";
}

let recorder: MediaRecorder | null = null;
let recordStream: MediaStream | null = null;
let recordChunks: Blob[] = [];

export function isTopNavScreenRecording(): boolean {
  return recorder != null && recorder.state === "recording";
}

/** 单帧截屏：用户选择要共享的画面后保存 PNG */
export async function captureScreenOnceToPng(): Promise<void> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  } as DisplayMediaStreamOptions);
  const video = document.createElement("video");
  video.playsInline = true;
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  await new Promise<void>((r) => {
    if (video.readyState >= 2) r();
    else video.onloadeddata = () => r();
  });
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("无法读取画面尺寸");
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("canvas 不可用");
  }
  ctx.drawImage(video, 0, 0, w, h);
  stream.getTracks().forEach((t) => t.stop());
  video.srcObject = null;

  await new Promise<void>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("生成图片失败"));
          return;
        }
        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `screenshot_${ts}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
        resolve();
      },
      "image/png",
      0.92,
    );
  });
}

export async function startTopNavScreenRecording(opts: {
  onError: (msg: string) => void;
  /** MediaRecorder 停止后调用（含用户从浏览器结束共享） */
  onStopped: () => void;
}): Promise<boolean> {
  if (recorder?.state === "recording") return true;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    } as DisplayMediaStreamOptions);
    recordStream = stream;
    recordChunks = [];
    const mime = pickMime();
    const mr = new MediaRecorder(stream, { mimeType: mime });
    recorder = mr;
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordChunks.push(e.data);
    };
    mr.onstop = () => {
      const blob = new Blob(recordChunks, { type: "video/webm" });
      recordChunks = [];
      recordStream?.getTracks().forEach((t) => t.stop());
      recordStream = null;
      recorder = null;
      if (blob.size > 0) {
        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `screen_${ts}.webm`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      opts.onStopped();
    };
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (mr.state === "recording") {
        try {
          mr.stop();
        } catch {
          /* ignore */
        }
      }
    });
    mr.start(250);
    return true;
  } catch (e) {
    opts.onError(e instanceof Error ? e.message : String(e));
    return false;
  }
}

export function stopTopNavScreenRecording(): void {
  if (!recorder || recorder.state !== "recording") return;
  try {
    recorder.stop();
  } catch {
    recordStream?.getTracks().forEach((t) => t.stop());
    recordStream = null;
    recorder = null;
  }
}
