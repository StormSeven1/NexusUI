export function buildCaptureFileName(streamLabel: string, kind: "snapshot" | "record", ext: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const label = streamLabel.trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_") || "stream";
  return `${label}_${kind}_${stamp}.${ext}`;
}

export function pickRecordMimeAndExtension(): { mimeType?: string; ext: "mp4" | "webm" } {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return { ext: "webm" };
  }
  const mp4Candidates = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4;codecs=avc1.640028",
    "video/mp4",
  ];
  for (const candidate of mp4Candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return { mimeType: candidate, ext: "mp4" };
  }
  const webmCandidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const candidate of webmCandidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return { mimeType: candidate, ext: "webm" };
  }
  return { ext: "webm" };
}

export function capturePlaybackToPngBlob(
  video: HTMLVideoElement | null,
  canvas: HTMLCanvasElement | null,
): Promise<Blob> {
  if (video && video.videoWidth > 0 && video.videoHeight > 0) {
    const output = document.createElement("canvas");
    output.width = video.videoWidth;
    output.height = video.videoHeight;
    const context = output.getContext("2d");
    if (!context) return Promise.reject(new Error("Canvas is not available"));
    context.drawImage(video, 0, 0, output.width, output.height);
    return new Promise((resolve, reject) => {
      output.toBlob((blob) => {
        if (!blob) reject(new Error("Failed to encode snapshot"));
        else resolve(blob);
      }, "image/png", 0.95);
    });
  }
  if (canvas && canvas.width > 0 && canvas.height > 0) {
    const output = document.createElement("canvas");
    output.width = canvas.width;
    output.height = canvas.height;
    const context = output.getContext("2d");
    if (!context) return Promise.reject(new Error("Canvas is not available"));
    context.drawImage(canvas, 0, 0);
    return new Promise((resolve, reject) => {
      output.toBlob((blob) => {
        if (!blob) reject(new Error("Failed to encode snapshot"));
        else resolve(blob);
      }, "image/png", 0.95);
    });
  }
  return Promise.reject(new Error("Video is not ready for snapshot"));
}

export async function saveCaptureBlobToServer(
  blob: Blob,
  captureSaveUrl: string,
  args: { kind: "snapshot" | "record"; streamLabel: string; fileName: string },
): Promise<string> {
  if (!captureSaveUrl.trim()) {
    throw new Error("Missing captureSaveUrl in EO video config");
  }
  const url = new URL(captureSaveUrl);
  url.searchParams.set("kind", args.kind);
  url.searchParams.set("streamLabel", args.streamLabel);
  url.searchParams.set("fileName", args.fileName);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: blob,
  });
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; path?: string; detail?: string; error?: string } | null;
  if (!response.ok || !payload?.ok || !payload.path) {
    throw new Error(payload?.detail || payload?.error || `Capture save failed: HTTP ${response.status}`);
  }
  return payload.path;
}

export type EoVideoRecordController = {
  start: () => void;
  stop: () => void;
  isRecording: () => boolean;
};

export function createVideoRecorder({
  video,
  fileName,
  mimeType,
  onSaveBlob,
  onError,
  onStarted,
  onStopped,
}: {
  video: HTMLVideoElement;
  fileName: string;
  mimeType?: string;
  onSaveBlob: (blob: Blob, fileName: string) => void | Promise<void>;
  onError?: (message: string) => void;
  onStarted?: () => void;
  onStopped?: () => void;
}): EoVideoRecordController {
  const captureStream = (video as HTMLVideoElement & { captureStream?: (frameRate?: number) => MediaStream }).captureStream;
  if (typeof captureStream !== "function") {
    return {
      start: () => onError?.("Current browser does not support video.captureStream"),
      stop: () => {},
      isRecording: () => false,
    };
  }
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];

  return {
    start() {
      if (recorder && recorder.state === "recording") return;
      if (!video.videoWidth || !video.videoHeight) {
        onError?.("Video is not ready for recording");
        return;
      }
      const stream = captureStream.call(video, 30);
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = (event) => {
        const error = (event as { error?: DOMException }).error;
        onError?.(error?.message || "MediaRecorder failed");
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder?.mimeType || mimeType || "video/webm" });
        recorder = null;
        chunks = [];
        void Promise.resolve(onSaveBlob(blob, fileName)).finally(() => onStopped?.());
      };
      recorder.start(250);
      onStarted?.();
    },
    stop() {
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
    },
    isRecording() {
      return Boolean(recorder && recorder.state === "recording");
    },
  };
}
